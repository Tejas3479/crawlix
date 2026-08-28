import React, { useState } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import {
  Layers,
  Play,
  Download,
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  RotateCw,
  Coffee,
} from 'lucide-react';

export function BatchView() {
  const { request } = useApi();
  const addToast = useCrawlStore((state) => state.addToast);

  const [urlsInput, setUrlsInput] = useState(
    'https://news.ycombinator.com\nhttps://lobste.rs\nhttps://github.com/trending'
  );
  const [concurrency, setConcurrency] = useState(5);
  const [renderJs, setRenderJs] = useState(false);
  const [stealth, setStealth] = useState(true);
  const [compressTokens, setCompressTokens] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');

  const handleStartBatch = async (e) => {
    e.preventDefault();
    const urls = urlsInput
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http://') || u.startsWith('https://'));

    if (urls.length === 0) {
      addToast({ type: 'warning', message: 'Please enter at least one valid URL.' });
      return;
    }

    setIsRunning(true);
    setBatchResult(null);

    try {
      const res = await request('/api/batch', {
        method: 'POST',
        body: JSON.stringify({
          urls,
          concurrency: Number(concurrency),
          options: {
            render_js: renderJs,
            stealth,
            compress_tokens: compressTokens,
            output_format: 'markdown',
          },
        }),
      });

      const batchId = res.batch_id || res.id;
      setBatchResult({
        ...res,
        batch_id: batchId,
        processed_urls: 0,
        total_urls: urls.length,
        results: [],
      });

      addToast({
        type: 'info',
        title: 'Batch Job Enqueued',
        message: `Processing ${urls.length} URLs in background...`,
      });

      // Poll status
      let isDone = false;
      let attempts = 0;
      while (!isDone && attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        try {
          const statusRes = await request(`/api/batch/${batchId}`);
          if (statusRes.status === 'completed' || statusRes.status === 'failed') {
            isDone = true;
            let loadedResults = [];
            try {
              const exportBlob = await request(`/api/batch/${batchId}/download`, { responseType: 'blob' });
              const text = await exportBlob.text();
              loadedResults = JSON.parse(text);
            } catch {
              // fallback
            }
            setBatchResult({
              ...statusRes,
              results: loadedResults,
              successful_count: loadedResults.filter((r) => !r.error).length,
            });
            if (statusRes.status === 'completed') {
              addToast({
                type: 'success',
                title: 'Batch Completed',
                message: `Successfully processed ${urls.length} URLs.`,
              });
            } else {
              addToast({
                type: 'error',
                title: 'Batch Failed',
                message: statusRes.error_message || 'Batch execution failed.',
              });
            }
          } else {
            setBatchResult((prev) => ({
              ...prev,
              ...statusRes,
            }));
          }
        } catch {
          // keep polling
        }
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Batch Failed', message: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportJsonl = () => {
    if (!batchResult || !batchResult.results) return;
    const jsonlContent = batchResult.results.map((r) => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonlContent], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-dataset-${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Exported Batch dataset to JSONL' });
  };

  const handleExportCsv = () => {
    if (!batchResult || !batchResult.results) return;
    const headers = ['URL', 'Status Code', 'Duration MS', 'Content'];
    const rows = batchResult.results.map((r) => [
      `"${r.url || ''}"`,
      r.status_code || 200,
      r.duration_ms || 0,
      `"${String(typeof r.content === 'object' ? JSON.stringify(r.content) : r.content || '').slice(0, 300).replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-dataset-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Exported Batch dataset to CSV' });
  };

  const filteredResults = (batchResult?.results || []).filter((r) =>
    r.url?.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Batch URL Input Form */}
      <div className="w-[480px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-espresso-900 dark:text-white mb-1">
            <Layers className="w-5 h-5 text-caramel-500" />
            <span>High-Throughput Batch Studio</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Scrape thousands of URLs in parallel with dynamic concurrency throttling, RAG token compression, and multi-format dataset exporters.
          </p>
        </div>

        <form onSubmit={handleStartBatch} className="p-5 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
              <span>Target URL List (One Per Line)</span>
              <span className="text-[10px] text-caramel-600 dark:text-caramel-400 font-mono">
                {urlsInput.split('\n').filter((u) => u.trim()).length} URLs
              </span>
            </label>
            <textarea
              rows={6}
              required
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              placeholder="https://example.com/page1&#10;https://example.com/page2"
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs font-mono leading-relaxed"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
              <span>Concurrency Workers</span>
              <span className="font-mono text-caramel-600 dark:text-caramel-400 text-xs font-bold">{concurrency} Threads</span>
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              className="w-full accent-caramel-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={stealth}
                onChange={(e) => setStealth(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Stealth Headers</span>
            </label>

            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={renderJs}
                onChange={(e) => setRenderJs(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Render JS</span>
            </label>

            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer col-span-2">
              <input
                type="checkbox"
                checked={compressTokens}
                onChange={(e) => setCompressTokens(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span className="font-bold text-caramel-600 dark:text-caramel-400">RAG Token Optimizer (Save 50%+)</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isRunning}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-caramel-500/25 glow-caramel transition disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Scraping Parallel Batch...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Execute High-Speed Batch</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Right: Results Inspector & Universal Exporters */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {!batchResult ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
            <Layers className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
            <h3 className="text-base font-medium text-espresso-800 dark:text-espresso-200">Batch Studio Ready</h3>
            <p className="text-xs max-w-sm mt-1">
              Paste your list of URLs to execute parallel extraction across multiple worker threads.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-caramel-500/15 bg-white/40 dark:bg-espresso-900/40 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-espresso-900 dark:text-white">
                  Batch Execution Summary
                </h2>
                <p className="text-xs text-espresso-500 font-mono mt-0.5">
                  Processed {batchResult.total_urls || batchResult.results?.length} URLs in {batchResult.total_duration_ms} ms • Concurrency: {concurrency}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportJsonl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-bold transition shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>JSONL</span>
                </button>

                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-espresso-900 text-espresso-800 dark:text-espresso-200 border border-caramel-500/20 text-xs font-bold hover:border-caramel-500/40 transition shadow-sm"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-caramel-500" />
                  <span>CSV</span>
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-3">
              {filteredResults.map((res, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-2 font-mono text-xs shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-espresso-900 dark:text-white truncate max-w-lg">
                      {res.url}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        (res.status_code || 200) < 400
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      HTTP {res.status_code || 200}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-espresso-50 dark:bg-black/60 border border-black/5 dark:border-white/5 max-h-36 overflow-y-auto text-espresso-800 dark:text-espresso-200 font-mono text-[11px] whitespace-pre-wrap select-text">
                    {typeof res.content === 'object' ? JSON.stringify(res.content, null, 2) : res.content || '(No content)'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
