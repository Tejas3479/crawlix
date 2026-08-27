import asyncio
import json
import os
import re
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify

from .log_filter import logger


def _extract_markdown_trafilatura(html: str, strip_links: bool) -> str | None:
    """Main-content aware markdown extraction via trafilatura.

    Returns None when trafilatura is unavailable or produced no content,
    so callers can fall back to the heuristic extractor.
    """
    try:
        import trafilatura
    except ImportError:
        return None
    try:
        text = trafilatura.extract(
            html,
            output_format="markdown",
            include_links=not strip_links,
            include_comments=False,
            include_tables=True,
        )
    except Exception as e:
        logger.warning(f"trafilatura extraction failed: {e}")
        return None
    return text or None


def _coerce_field(raw: Any, field_type: str | None) -> Any:
    """Coerce a raw DOM value to the requested field type."""
    if field_type in (None, "text", "string"):
        return raw
    try:
        if field_type == "integer":
            return int(re.sub(r"[^\d-]", "", str(raw)) or 0)
        if field_type == "number":
            return float(re.sub(r"[^\d.-]", "", str(raw)) or 0)
        if field_type == "boolean":
            return str(raw).strip().lower() in ("true", "1", "yes", "on")
        if field_type == "html":
            return raw
    except (TypeError, ValueError):
        pass
    return raw


def _extract_css(html: str, schema: dict) -> dict | list | None:
    """Selector-based JSON extraction without an LLM (Crawl4AI JsonCss parity).

    Schema shape (mirrors JsonCssExtractionStrategy):
      {"name": "...", "baseSelector": "div.product", "fields": [
          {"name": "title", "selector": "h2", "type": "text"},
          {"name": "link", "selector": "a", "type": "attribute", "attribute": "href"},
          {"name": "price", "selector": ".price", "type": "text"}
      ]}
    """
    if not isinstance(schema, dict) or "fields" not in schema:
        logger.warning("CSS extraction requires a schema with 'fields'.")
        return None

    fields = schema.get("fields") or []
    base_selector = (schema.get("baseSelector") or "").strip()
    try:
        soup = BeautifulSoup(html, "lxml")
        containers = soup.select(base_selector) if base_selector else [soup]
    except Exception as e:
        logger.warning(f"CSS extraction selector parse failed: {e}")
        return None

    items: list[dict] = []
    for container in containers:
        item: dict[str, Any] = {}
        for field in fields:
            name = field.get("name")
            if not name:
                continue
            selector = field.get("selector")
            field_type = field.get("type") or "text"
            attribute = field.get("attribute")
            transform = field.get("transform")
            fallback = field.get("fallback")

            raw: Any = None
            if selector:
                target = container.select_one(selector)
                if target is not None:
                    if field_type == "attribute":
                        raw = target.get(attribute) if attribute else None
                    elif field_type == "html":
                        raw = str(target)
                    else:
                        raw = target.get_text(strip=True)
            if raw is None and field_type in ("attribute", "text", "html"):
                raw = fallback

            if isinstance(raw, str):
                if transform == "strip":
                    raw = raw.strip()
                elif transform == "upper":
                    raw = raw.strip().upper()
                elif transform == "lower":
                    raw = raw.strip().lower()

            item[name] = _coerce_field(raw, field_type)
        items.append(item)

    if not items:
        return None
    if not base_selector and len(items) == 1:
        return items[0]
    return items


def _validate_against_schema(data: Any, schema: Any, path: str = "root") -> list[str]:
    """Lightweight JSON-schema validator covering the common extraction shapes."""
    if not isinstance(schema, dict):
        return []
    errors: list[str] = []
    schema_type = schema.get("type")

    if schema_type == "object":
        if not isinstance(data, dict):
            errors.append(f"{path}: expected object, got {type(data).__name__}")
            return errors
        required = schema.get("required") or []
        for key in required:
            if key not in data:
                errors.append(f"{path}: missing required property '{key}'")
        properties = schema.get("properties") or {}
        for key, prop_schema in properties.items():
            if key in data:
                errors.extend(
                    _validate_against_schema(data[key], prop_schema, f"{path}.{key}")
                )
    elif schema_type == "array":
        if not isinstance(data, list):
            errors.append(f"{path}: expected array, got {type(data).__name__}")
        else:
            items_schema = schema.get("items")
            if isinstance(items_schema, dict):
                for i, element in enumerate(data):
                    errors.extend(
                        _validate_against_schema(element, items_schema, f"{path}[{i}]")
                    )
    elif schema_type == "string":
        if not isinstance(data, str):
            errors.append(f"{path}: expected string, got {type(data).__name__}")
    elif schema_type == "integer":
        if not isinstance(data, int) or isinstance(data, bool):
            errors.append(f"{path}: expected integer, got {type(data).__name__}")
    elif schema_type == "number":
        if not isinstance(data, (int, float)) or isinstance(data, bool):
            errors.append(f"{path}: expected number, got {type(data).__name__}")
    elif schema_type == "boolean":
        if not isinstance(data, bool):
            errors.append(f"{path}: expected boolean, got {type(data).__name__}")
    elif schema_type == "null":
        if data is not None:
            errors.append(f"{path}: expected null, got {type(data).__name__}")

    enum = schema.get("enum")
    if isinstance(enum, list) and data not in enum:
        errors.append(f"{path}: value not in enum {enum}")

    return errors[:10]


def _strip_json_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


async def _extract_llm_structured_text(
    provider: str,
    model: str,
    api_key: str,
    system: str,
    user: str,
    json_schema: dict | None,
    max_tokens: int,
    image_data: str | None = None,
) -> str:
    """Single LLM call with modern structured-output params per provider, including optional VLM support.

    Falls back to older params when the provider rejects the new ones.
    Returns the raw text payload (may contain JSON).
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        if provider == "openai":
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            
            user_content = user
            if image_data:
                user_content = [
                    {"type": "text", "text": user},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}}
                ]

            payload: dict[str, Any] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": max_tokens,
            }
            if json_schema:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "extracted_data",
                        "strict": True,
                        "schema": json_schema,
                    },
                }
            else:
                payload["response_format"] = {"type": "json_object"}
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            message = resp.json()["choices"][0]["message"]
            content = message.get("content")
            if content is None:
                refusal = message.get("refusal")
                raise RuntimeError(f"OpenAI refused to answer: {refusal or 'no content'}")
            return content

        if provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }
            
            user_content = [{"type": "text", "text": user}]
            if image_data:
                user_content.insert(0, {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": image_data}
                })

            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user_content}],
            }
            if json_schema:
                payload["output_config"] = {
                    "format": {"type": "json_schema", "schema": json_schema}
                }
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
            )
            if resp.status_code == 400 and json_schema and "output_config" in resp.text:
                # Older deployments may reject output_config; fall back to prompt-only.
                logger.info("Anthropic rejected output_config; retrying prompt-only.")
                del payload["output_config"]
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=payload,
                )
            resp.raise_for_status()
            content = resp.json()["content"]
            if isinstance(content, list):
                texts = [
                    block.get("text", "")
                    for block in content
                    if block.get("type") == "text"
                ]
                if texts:
                    return "".join(texts)
                if content and content[0].get("type") == "refusal":
                    raise RuntimeError("Anthropic refused to answer.")
            return str(content)

        if provider == "gemini":
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={api_key}"
            )
            headers = {"Content-Type": "application/json"}
            
            parts = []
            if image_data:
                parts.append({"inlineData": {"mimeType": "image/png", "data": image_data}})
            parts.append({"text": system + "\n\n" + (user if isinstance(user, str) else str(user))})
            
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"responseMimeType": "application/json"},
            }
            if json_schema:
                payload["response_format"] = {
                    "text": {"mime_type": "application/json", "schema": json_schema}
                }
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 400 and json_schema and "response_format" in resp.text:
                # responseSchema is the older, still-accepted path.
                logger.info("Gemini rejected response_format; retrying responseSchema.")
                del payload["response_format"]
                payload["generationConfig"]["responseSchema"] = json_schema
                resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            candidates = resp.json().get("candidates") or []
            if not candidates:
                raise RuntimeError("Gemini returned no candidates.")
            parts = candidates[0]["content"]["parts"]
            text = "".join(part.get("text", "") for part in parts)
            if not text:
                raise RuntimeError("Gemini returned an empty response.")
            return text

        raise RuntimeError(f"Unsupported provider: {provider}")


async def process_content(
    html: str,
    output_format: str,
    base_url: str,
    strip_links: bool = False,
    llm_api_key: str | None = None,
    llm_provider: str = "openai",
    json_schema: dict | None = None,
    css_selector: str | None = None,
    llm_model: str | None = None,
    extraction_prompt: str | None = None,
    image_data: str | None = None
) -> str | dict | list:
    # DOM Slicing (Pruning) if css_selector is provided
    if css_selector:
        logger.info(f"Applying DOM pruning with selector: {css_selector}")
        soup = BeautifulSoup(html, "lxml")
        selected_elements = soup.select(css_selector)
        if selected_elements:
            html = "".join(str(elem) for elem in selected_elements)
        else:
            logger.warning(f"CSS Selector '{css_selector}' not found in DOM.")
            html = "<!-- CSS Selector not found -->"

    if output_format == "html":
        return html

    if output_format == "markdown":
        # Prefer main-content aware extraction (much higher precision on
        # product/forum/listing pages). Fall back to the heuristic path.
        trafilatura_md = _extract_markdown_trafilatura(html, strip_links)
        if trafilatura_md is not None and trafilatura_md.strip():
            return trafilatura_md

        soup = BeautifulSoup(html, "lxml")

        # Remove structural tag elements
        for tag in soup(["script", "style", "noscript", "iframe", "svg", "canvas", "nav", "footer", "header", "aside", "form"]):
            tag.decompose()

        # Remove navigation/banner layout roles
        for tag in soup.find_all(attrs={"role": ["navigation", "banner", "complementary"]}):
            tag.decompose()

        # Clean specific layout/interaction attributes from remaining DOM tags
        for tag in soup.find_all(True):
            attrs_to_remove = []
            for attr in list(tag.attrs.keys()):
                if attr in ("class", "id", "style", "onclick") or attr.startswith("data-"):
                    attrs_to_remove.append(attr)
            for attr in attrs_to_remove:
                del tag[attr]

        markdown_text = markdownify(
            str(soup),
            heading_style="ATX",
            strip=["a"] if strip_links else []
        )
        return markdown_text

    # CSS selector-based extraction: no LLM required, deterministic and cheap.
    if output_format == "css":
        extracted = _extract_css(html, json_schema) if json_schema else None
        if extracted is None:
            return {"error": "css_extraction_failed", "error_message": "Schema missing or no elements matched. Provide a json_schema with 'fields' and a valid 'baseSelector'."}
        return extracted

    if output_format == "vlm":
        if not image_data:
            return {"error": "vlm_extraction_failed", "error_message": "No screenshot data available. VLM extraction requires a screenshot."}
        resolved_key = llm_api_key or os.getenv(f"{llm_provider.upper()}_API_KEY")
        if not resolved_key:
            return {"error": "api_key_missing", "error_message": f"An API key for {llm_provider} is required for VLM extraction."}
            
        system = "You are a Vision-Language Model data extractor. Extract the requested structured data purely from the provided screenshot. Return ONLY a valid JSON object matching the schema. No explanation, no markdown fences."
        if extraction_prompt:
            system += f"\n\nUSER INSTRUCTIONS:\n{extraction_prompt}"
            
        # Strip the data prefix if present for base64
        import re
        b64_data = re.sub(r"^data:image/[^;]+;base64,", "", image_data)
        
        try:
            raw_response = await _extract_llm_structured_text(
                provider=llm_provider,
                model=llm_model or ("gpt-4o" if llm_provider == "openai" else "claude-3-5-sonnet-20240620" if llm_provider == "anthropic" else "gemini-1.5-flash"),
                api_key=resolved_key,
                system=system,
                user="Extract data from this screenshot.",
                json_schema=json_schema,
                max_tokens=4000,
                image_data=b64_data
            )
            import json
            stripped = _strip_json_fences(raw_response)
            return json.loads(stripped)
        except Exception as e:
            logger.error(f"VLM extraction failed: {e}")
            return {"error": "vlm_extraction_failed", "error_message": str(e)}

    if output_format == "structured":
        # If the caller supplied a selector schema, prefer deterministic extraction.
        if json_schema and "fields" in json_schema and "baseSelector" in json_schema:
            extracted = _extract_css(html, json_schema)
            if extracted is not None:
                return extracted
            else:
                logger.info("CSS extraction failed. Triggering self-healing semantic extraction fallback.")
                import json
                properties = {}
                required = []
                for field in json_schema.get("fields", []):
                    fname = field.get("name")
                    if fname:
                        properties[fname] = {"type": "string", "description": f"Extracted from {field.get('selector', 'element')}"}
                        required.append(fname)
                
                new_schema = {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False
                }
                
                base_selector = json_schema.get("baseSelector")
                if base_selector:
                    # If there's a base selector, it usually means a list of items
                    new_schema = {
                        "type": "array",
                        "items": new_schema,
                        "description": f"List of items matching semantic structure of {base_selector}"
                    }
                
                json_schema = new_schema
                extraction_prompt = (extraction_prompt or "") + "\n\nSELF-HEALING: The CSS extraction failed. Please extract the semantic equivalent fields based on the provided schema."

        resolved_key = llm_api_key or os.getenv(f"{llm_provider.upper()}_API_KEY")

        if resolved_key is None:
            soup = BeautifulSoup(html, "lxml")

            title_tag = soup.find("title")
            title = title_tag.get_text().strip() if title_tag else ""

            meta_desc_tag = soup.find("meta", attrs={"name": "description"})
            meta_desc = meta_desc_tag.get("content", "").strip() if meta_desc_tag else ""

            meta_kw_tag = soup.find("meta", attrs={"name": "keywords"})
            meta_kw = meta_kw_tag.get("content", "").strip() if meta_kw_tag else ""

            h1_list = [h.get_text().strip() for h in soup.find_all("h1") if h.get_text().strip()]
            h2_list = [h.get_text().strip() for h in soup.find_all("h2") if h.get_text().strip()]
            h3_list = [h.get_text().strip() for h in soup.find_all("h3") if h.get_text().strip()]

            links = []
            seen_hrefs = set()
            for a in soup.find_all("a", href=True):
                href = a["href"].strip()
                resolved_href = urljoin(base_url, href)
                if resolved_href not in seen_hrefs:
                    seen_hrefs.add(resolved_href)
                    links.append({
                        "text": a.get_text().strip(),
                        "href": resolved_href
                    })

            images = []
            for img in soup.find_all("img", src=True):
                src = img["src"].strip()
                resolved_src = urljoin(base_url, src)
                images.append({
                    "alt": img.get("alt", "").strip(),
                    "src": resolved_src
                })

            tables = []
            for table in soup.find_all("table"):
                headers = []
                rows = []
                for th in table.find_all("th"):
                    headers.append(th.get_text().strip())
                for tr in table.find_all("tr"):
                    row_cells = []
                    tds = tr.find_all("td")
                    if tds:
                        for td in tds:
                            row_cells.append(td.get_text().strip())
                        rows.append(row_cells)
                tables.append({
                    "headers": headers,
                    "rows": rows
                })

            forms = []
            for form in soup.find_all("form"):
                inputs = []
                for inp in form.find_all("input"):
                    inputs.append({
                        "name": inp.get("name", ""),
                        "type": inp.get("type", "text"),
                        "placeholder": inp.get("placeholder", "")
                    })
                forms.append({
                    "action": urljoin(base_url, form.get("action", "")),
                    "method": form.get("method", "get").lower(),
                    "inputs": inputs
                })

            text_blocks = []
            for p in soup.find_all("p"):
                txt = p.get_text().strip()
                if txt:
                    text_blocks.append(txt)
                    if len(text_blocks) >= 50:
                        break

            return {
                "title": title,
                "meta_description": meta_desc,
                "meta_keywords": meta_kw,
                "h1": h1_list,
                "h2": h2_list,
                "h3": h3_list,
                "links": links,
                "images": images,
                "tables": tables,
                "forms": forms,
                "text_blocks": text_blocks
            }

        # LLM Structured Mapping Path with schema-validation retry loop.
        markdown_content = await process_content(
            html=html,
            output_format="markdown",
            base_url=base_url,
            strip_links=strip_links,
            css_selector=None  # Already cropped if css_selector was present
        )
        if not isinstance(markdown_content, str):
            markdown_content = str(markdown_content)
        truncated_markdown = markdown_content[:12000]

        system = "You are a data extractor. Extract data from the markdown and return ONLY a valid JSON object matching the schema. No explanation, no markdown fences, no preamble."
        if extraction_prompt:
            system += f" Extraction Instructions: {extraction_prompt}"

        schema_str = json.dumps(json_schema) if json_schema else "Return a structured JSON object reflecting the extracted data."
        user = f"Schema:\n{schema_str}\n\nContent:\n{truncated_markdown}"

        providers_to_try = [llm_provider]
        for p in ["openai", "gemini", "anthropic"]:
            if p != llm_provider:
                providers_to_try.append(p)

        default_model = {
            "openai": "gpt-5.6-luna",
            "anthropic": "claude-opus-5",
            "gemini": "gemini-3.6-flash",
        }
        last_err_msg = ""

        for current_provider in providers_to_try:
            current_key = (
                llm_api_key if current_provider == llm_provider
                else os.getenv(f"{current_provider.upper()}_API_KEY")
            )
            if not current_key:
                continue
            target_model = llm_model if (current_provider == llm_provider and llm_model) else default_model[current_provider]

            for attempt in range(2):
                prompt = user
                if attempt > 0:
                    prompt += (
                        "\n\nYour previous response failed validation or parsing. "
                        f"Details: {last_err_msg}\n"
                        "Return ONLY valid JSON that strictly matches the schema."
                    )
                try:
                    logger.info(
                        f"Requesting {current_provider} structured outputs using model: {target_model} (attempt {attempt + 1})"
                    )
                    raw = await _extract_llm_structured_text(
                        provider=current_provider,
                        model=target_model,
                        api_key=current_key,
                        system=system,
                        user=prompt,
                        json_schema=json_schema,
                        max_tokens=2000,
                    )
                except Exception as llm_err:
                    last_err_msg = str(llm_err)
                    if attempt < 1:
                        wait = 2.0 * (attempt + 1)
                        logger.warning(f"LLM API request ({current_provider}) failed: {llm_err}. Retrying in {wait}s...")
                        await asyncio.sleep(wait)
                        continue
                    logger.error(f"LLM API request ({current_provider}) failed after 2 attempts: {llm_err}")
                    break

                parsed = _strip_json_fences(raw)
                try:
                    data = json.loads(parsed)
                except Exception as parse_err:
                    last_err_msg = f"JSON parse failed: {parse_err}"
                    logger.error(last_err_msg)
                    if attempt < 1:
                        continue
                    return {"error": "llm_parse_failed", "raw": raw}

                if json_schema:
                    errors = _validate_against_schema(data, json_schema)
                    if errors:
                        last_err_msg = "Schema validation errors: " + "; ".join(errors)
                        logger.warning(f"{current_provider} output failed validation: {last_err_msg}")
                        if attempt < 1:
                            continue
                        return {"error": "llm_validation_failed", "error_message": last_err_msg, "raw": data}

                return data

        return {
            "error": "llm_api_failed",
            "error_message": f"All available LLM providers failed. Last error: {last_err_msg}"
        }

    # Fallback for unknown formats
    return html