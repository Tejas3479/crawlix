"""
Crawlix extraction eval harness against the WCXB benchmark.

Downloads pages + ground truth from the WCXB repo (GitHub), runs a chosen
extractor, and reports word-level P/R/F1 plus with/without snippet rates,
mirroring the official WCXB evaluation so results are comparable to the
leaderboard at webcontentextraction.org.

Usage:
    python scripts/eval_extraction.py --split dev --limit 120
    python scripts/eval_extraction.py --split test --limit -1 --extractor trafilatura
    python scripts/eval_extraction.py --split test --limit -1 --reuse
"""

import argparse
import gzip
import json
import random
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = "Murrough-Foley/web-content-extraction-benchmark"
BRANCH = "main"
API = f"https://api.github.com/repos/{REPO}/contents"
RAW = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ROOT / "data" / "wcxb"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PAGE_TYPES = [
    "article", "forum", "product", "collection", "listing", "documentation", "service",
]

UA = {"User-Agent": "crawlix-eval/1.0"}


# ---------------------------------------------------------------------------
# Download helpers (stdlib only, resumable via local cache)
# ---------------------------------------------------------------------------

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def list_dir(path: str) -> list[dict]:
    return json.loads(fetch(f"{API}/{path}"))


def ensure_cached(cache: Path, rel_path: str, binary: bool = True) -> Path:
    dest = cache / rel_path
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(fetch(f"{RAW}/{rel_path}"))
    return dest


# ---------------------------------------------------------------------------
# Metric (mirrors WCXB official evaluate.py)
# ---------------------------------------------------------------------------

def tokenize(text: str) -> list[str]:
    if not text:
        return []
    return re.findall(r"\w+", text.lower())


def word_f1(predicted: str, reference: str) -> tuple[float, float, float]:
    pred_tokens = tokenize(predicted)
    ref_tokens = tokenize(reference)
    if not ref_tokens:
        return (1.0, 1.0, 1.0) if not pred_tokens else (0.0, 0.0, 0.0)
    if not pred_tokens:
        return (0.0, 0.0, 0.0)
    pred_counts = Counter(pred_tokens)
    ref_counts = Counter(ref_tokens)
    overlap = sum((pred_counts & ref_counts).values())
    precision = overlap / len(pred_tokens)
    recall = overlap / len(ref_tokens)
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return (precision, recall, f1)


def snippet_check(text: str, snippets: list[str]) -> float:
    if not snippets:
        return 1.0
    text_lower = text.lower()
    found = sum(1 for s in snippets if s.lower() in text_lower)
    return found / len(snippets)


def get_page_type(data: dict) -> str:
    internal = data.get("_internal", {}) or {}
    pt_obj = internal.get("page_type", {})
    if isinstance(pt_obj, dict):
        pt = pt_obj.get("primary", "article")
    elif isinstance(pt_obj, str):
        pt = pt_obj
    else:
        pt = "article"
    return "collection" if pt == "category" else pt


# ---------------------------------------------------------------------------
# Extractors
# ---------------------------------------------------------------------------

def extract_crawlix(html: str, base_url: str) -> str:
    import asyncio

    from services.content import process_content

    res = asyncio.run(process_content(html, "markdown", base_url))
    return str(res) if not isinstance(res, str) else res


def extract_full_text(html: str, base_url: str) -> str:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    return soup.get_text("\n", strip=True)


def extract_trafilatura(html: str, base_url: str) -> str:
    import trafilatura
    return trafilatura.extract(
        html, include_comments=False, include_tables=True, include_links=False
    ) or ""


EXTRACTORS = {
    "crawlix": extract_crawlix,
    "full-text": extract_full_text,
    "trafilatura": extract_trafilatura,
}


# ---------------------------------------------------------------------------
# Sampling (stratified across page types for a representative baseline)
# ---------------------------------------------------------------------------

def sample_ids(gt_by_id: dict, limit: int, seed: int) -> list[str]:
    by_type: dict[str, list[str]] = defaultdict(list)
    for fid, gt in gt_by_id.items():
        by_type[gt["page_type"]].append(fid)
    rng = random.Random(seed)
    for ids in by_type.values():
        rng.shuffle(ids)
    types = sorted(by_type.keys())
    idx = {t: 0 for t in types}
    chosen: list[str] = []
    while len(chosen) < limit:
        progressed = False
        for t in types:
            if len(chosen) >= limit:
                break
            if idx[t] < len(by_type[t]):
                chosen.append(by_type[t][idx[t]])
                idx[t] += 1
                progressed = True
        if not progressed:
            break
    return chosen


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

def load_ground_truth(cache: Path, split: str, ids: list[str]) -> dict:
    gt_by_id = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {
            pool.submit(
                ensure_cached, cache, f"{split}/ground-truth/{fid}.json"
            ): fid
            for fid in ids
        }
        for fut in as_completed(futs):
            fid = futs[fut]
            try:
                path = fut.result()
            except Exception as e:
                print(f"  [warn] failed to download GT {fid}: {e}", file=sys.stderr)
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            gt = data.get("ground_truth", {})
            if not isinstance(gt, dict):
                continue
            gt_by_id[fid] = {
                "main_content": gt.get("main_content", "") or "",
                "with": gt.get("with", []) or [],
                "without": gt.get("without", []) or [],
                "title": gt.get("title", ""),
                "url": data.get("url", ""),
                "page_type": get_page_type(data),
            }
    return gt_by_id


def run_extraction(cache: Path, split: str, ids: list[str], extractor_name: str) -> dict:
    extractor = EXTRACTORS[extractor_name]
    predictions: dict[str, str] = {}
    errors: dict[str, str] = {}

    def one(fid: str):
        html_path = ensure_cached(cache, f"{split}/html/{fid}.html.gz")
        with gzip.open(html_path, "rb") as fh:
            html = fh.read().decode("utf-8", errors="replace")
        base_url = ""  # filled later from GT; markdown path uses it for links only
        try:
            text = extractor(html, base_url)
            return fid, text, None
        except Exception as e:
            return fid, "", f"{type(e).__name__}: {e}"

    print(f"  extracting {len(ids)} pages with extractor '{extractor_name}' ...")
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(one, fid) for fid in ids]
        for fut in as_completed(futs):
            fid, text, err = fut.result()
            if err:
                errors[fid] = err
            else:
                predictions[fid] = text
    if errors:
        print(f"  [warn] {len(errors)} pages failed:", file=sys.stderr)
        for fid, err in list(errors.items())[:5]:
            print(f"    {fid}: {err}", file=sys.stderr)
    return predictions


def evaluate_and_report(gt_by_id: dict, predictions: dict, label: str) -> list[dict]:
    results = []
    type_results: dict[str, list[dict]] = defaultdict(list)
    for fid, gt in sorted(gt_by_id.items()):
        predicted = predictions.get(fid, "")
        reference = gt["main_content"]
        p, r, f1 = word_f1(predicted, reference)
        with_rate = snippet_check(predicted, gt["with"])
        without_rate = snippet_check(predicted, gt["without"])
        result = {
            "file_id": fid,
            "page_type": gt["page_type"],
            "precision": p,
            "recall": r,
            "f1": f1,
            "with_rate": with_rate,
            "without_rate": without_rate,
            "pred_len": len(tokenize(predicted)),
            "ref_len": len(tokenize(reference)),
        }
        results.append(result)
        type_results[gt["page_type"]].append(result)

    n = len(results)
    if n == 0:
        print("No pages evaluated.")
        return results

    avg_p = sum(r["precision"] for r in results) / n
    avg_r = sum(r["recall"] for r in results) / n
    avg_f1 = sum(r["f1"] for r in results) / n
    avg_with = sum(r["with_rate"] for r in results) / n
    avg_without = sum(r["without_rate"] for r in results) / n

    print(f"\n== {label} == Overall ({n} pages):")
    print(f"  Precision:  {avg_p:.4f}")
    print(f"  Recall:     {avg_r:.4f}")
    print(f"  F1:         {avg_f1:.4f}")
    print(f"  With snippets:    {avg_with:.1%}")
    print(f"  Without snippets: {avg_without:.1%} (lower is better)")

    print("\nPer page type:")
    print(f"  {'Type':<16} {'N':>5} {'F1':>7} {'P':>7} {'R':>7}")
    print(f"  {'-'*44}")
    for pt in PAGE_TYPES:
        tr = type_results.get(pt, [])
        if not tr:
            continue
        tf1 = sum(r["f1"] for r in tr) / len(tr)
        tp = sum(r["precision"] for r in tr) / len(tr)
        tr_val = sum(r["recall"] for r in tr) / len(tr)
        print(f"  {pt:<16} {len(tr):>5} {tf1:>7.3f} {tp:>7.3f} {tr_val:>7.3f}")
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate web content extraction against WCXB"
    )
    parser.add_argument("--split", default="dev", choices=["dev", "test"])
    parser.add_argument("--limit", type=int, default=120, help="-1 for all pages")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--extractor", default="crawlix", choices=list(EXTRACTORS.keys()))
    parser.add_argument("--cache", default=str(DEFAULT_CACHE))
    parser.add_argument("--reuse", action="store_true", help="reuse cached predictions JSON")
    parser.add_argument("--out", default=None, help="dir for predictions/results JSON")
    args = parser.parse_args()

    cache = Path(args.cache)
    out_dir = Path(args.out) if args.out else cache / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    pred_file = out_dir / f"predictions_{args.split}_{args.extractor}_{args.limit}.json"

    print(f"Listing {args.split}/ground-truth from {REPO} ...")
    gt_entries = list_dir(f"{args.split}/ground-truth")
    all_ids = [e["name"].replace(".json", "") for e in gt_entries]
    all_ids = [fid for fid in all_ids if fid]
    print(f"  found {len(all_ids)} ground-truth files")

    print("Downloading ground-truth JSONs (cached) ...")
    gt_by_id = load_ground_truth(cache, args.split, all_ids)
    print(f"  loaded {len(gt_by_id)} usable ground-truth records")

    if args.limit == -1 or args.limit >= len(gt_by_id):
        ids = sorted(gt_by_id.keys())
    else:
        ids = sample_ids(gt_by_id, args.limit, args.seed)
    print(f"  evaluating {len(ids)} pages")

    if args.reuse and pred_file.exists():
        print(f"Reusing {pred_file.name} ...")
        predictions = json.loads(pred_file.read_text(encoding="utf-8"))
    else:
        predictions = run_extraction(cache, args.split, ids, args.extractor)
        pred_file.write_text(
            json.dumps(predictions, indent=2), encoding="utf-8"
        )
        print(f"  saved predictions -> {pred_file}")

    # Only evaluate the pages we actually have predictions for
    eval_gt = {fid: gt for fid, gt in gt_by_id.items() if fid in predictions}
    results = evaluate_and_report(eval_gt, predictions, f"WCXB {args.split} / {args.extractor}")

    detail_file = out_dir / f"detail_{args.split}_{args.extractor}_{args.limit}.json"
    detail_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nsaved per-page detail -> {detail_file}")


if __name__ == "__main__":
    main()