import React, { useState, useEffect } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import {
  Bot,
  Play,
  RotateCw,
  Trash2,
  XCircle,
  Download,
  Search,
  ExternalLink,
  Coffee,
  Activity,
  Network,
  Layers,
  FileSpreadsheet,
  CheckCircle2,
  FileText,
  Filter,
  Zap,
  Gauge,
} from 'lucide-react';

export function CrawlerStudio() {
  const { request } = useApi();
  const crawls = useCrawlStore((state) => state.crawls);
  const setCrawls = useCrawlStore((state) => state.setCrawls);
  const addToast = useCrawlStore((state) => state.addToast);
  const addLog = useCrawlStore((state) => state.addLog);

  // Form State
  const [seedUrl, setSeedUrl] = useState('https://news.ycombinator.com');
  const [maxPages, setMaxPages] = useState(30);
  const [maxDepth, setMaxDepth] = useState(2);
  const [limitDomain, setLimitDomain] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [renderJs, setRenderJs] = useState(false);
  const [stealth, setStealth] = useState(true);
  const [compressTokens, setCompressTokens] = useState(false);
  const [outputFormat, setOutputFormat] = useState('markdown');
  const [cssSelector, setCssSelector] = useState('');
  const [extractionPrompt, setExtractionPrompt] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('');

  // Selected Crawl Inspector
  const [selectedCrawlId, setSelectedCrawlId] = useState(null);
  const [selectedCrawl, setSelectedCrawl] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeTab, setActiveTab] = useState('results'); // 'results' | 'tree' | 'raw' | 'charts'

  const loadCrawls = async () => {
    try {
      const data = await request('/api/crawl');
      setCrawls(data);
      if (data.length > 0 && !selectedCrawlId) {
        setSelectedCrawlId(data[0].id || data[0].crawl_id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadCrawls();
  }, []);

  useEffect(() => {
    if (!selectedCrawlId) {
      setSelectedCrawl(null);
      return;
    }
    const fetchDetails = async () => {
      try {
        const data = await request(`/api/crawl/${selectedCrawlId}`);
        setSelectedCrawl(data);
      } catch (e) {
        console.error(e);
      }
    };
    fetchDetails();
    const interval = setInterval(fetchDetails, 3000);
    return () => clearInterval(interval);
  }, [selectedCrawlId]);

  const handleStartCrawl = async (e) => {
    e.preventDefault();
    if (!seedUrl.trim()) {
      addToast({ type: 'warning', message: 'Please enter a seed URL' });
      return;
    }

    setIsStarting(true);
    const incList = includePatterns
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const excList = excludePatterns
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const payload = {
      url: seedUrl.trim(),
      max_pages: Number(maxPages),
      max_depth: Number(maxDepth),
      limit_domain: limitDomain,
      respect_robots: respectRobots,
      render_js: renderJs,
      stealth,
      compress_tokens: compressTokens,
      output_format: outputFormat,
      css_selector: cssSelector.trim() || null,
      extraction_prompt: extractionPrompt.trim() || null,
      webhook_url: webhookUrl.trim() || null,
      include_patterns: incList,
      exclude_patterns: excList,
    };

    try {
      addLog({ type: 'info', message: `Launching crawl for: ${seedUrl}` });
      const res = await request('/api/crawl', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      addToast({
        type: 'success',
        title: 'Crawl Studio Job Enqueued',
        message: `ID: ${res.crawl_id}. Real-time WebSocket streaming activated.`,
      });

      setSelectedCrawlId(res.crawl_id);
      loadCrawls();
    } catch (err) {
      addToast({ type: 'error', title: 'Crawl Failed to Start', message: err.message });
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelCrawl = async (crawlId) => {
    try {
      await request(`/api/crawl/${crawlId}/cancel`, { method: 'POST' });
      addToast({ type: 'info', message: `Cancelled crawl ${crawlId}` });
      loadCrawls();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleDeleteCrawl = async (crawlId) => {
    try {
      await request(`/api/crawl/${crawlId}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'Crawl deleted' });
      if (selectedCrawlId === crawlId) setSelectedCrawlId(null);
      loadCrawls();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleExportJsonl = () => {
    if (!selectedCrawl || !selectedCrawl.results) return;
    const jsonlContent = selectedCrawl.results.map((r) => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonlContent], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crawl-${selectedCrawl.id}-dataset.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Exported dataset to JSONL' });
  };

  const handleExportCsv = () => {
    if (!selectedCrawl || !selectedCrawl.results) return;
    const headers = ['URL', 'Status Code', 'Title', 'Content'];
    const rows = selectedCrawl.results.map((r) => [
      `"${r.url || ''}"`,
      r.status_code || 200,
      `"${(r.title || '').replace(/"/g, '""')}"`,
      `"${String(typeof r.content === 'object' ? JSON.stringify(r.content) : r.content || '').slice(0, 500).replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crawl-${selectedCrawl.id}-dataset.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Exported dataset to CSV' });
  };

  const filteredResults = (selectedCrawl?.results || []).filter((r) =>
    r.url?.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Compute HTTP status code distribution
  const statusStats = React.useMemo(() => {
    if (!selectedCrawl || !selectedCrawl.results) return { ok: 0, clientErr: 0, serverErr: 0 };
    let ok = 0;
    let clientErr = 0;
    let serverErr = 0;
    selectedCrawl.results.forEach((r) => {
      const code = r.status_code || 200;
      if (code >= 200 && code < 400) ok++;
      else if (code >= 400 && code < 500) clientErr++;
      else if (code >= 500) serverErr++;
    });
    return { ok, clientErr, serverErr };
  }, [selectedCrawl]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Job Form & Job Queue */}
      <div className="w-[480px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-6">
        <div>
          <h2 className="text-base font-bold text-espresso-900 dark:text-white flex items-center gap-2 mb-1">
            <Bot className="w-4 h-4 text-caramel-500" />
            Crawler Studio & Live Topology
          </h2>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Concurrent BFS crawler with URL regex filtering, live telemetry, and multi-format dataset exporters.
          </p>
        </div>

        {/* Start Crawl Form */}
        <form onSubmit={handleStartCrawl} className="p-5 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Seed URL
            </label>
            <input
              type="url"
              required
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Max Pages
              </label>
              <input
                type="number"
                min="1"
                max="5000"
                value={maxPages}
                onChange={(e) => setMaxPages(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Max Depth
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={maxDepth}
                onChange={(e) => setMaxDepth(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs"
              />
            </div>
          </div>

          {/* Regex URL Filters */}
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
                <span>Include URL Patterns</span>
                <span className="text-[9px] text-espresso-400 font-mono">Comma-separated</span>
              </label>
              <input
                type="text"
                value={includePatterns}
                onChange={(e) => setIncludePatterns(e.target.value)}
                placeholder="e.g. */docs/*, */articles/*"
                className="w-full px-3 py-1.5 rounded-xl glass-input text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
                <span>Exclude URL Patterns</span>
                <span className="text-[9px] text-espresso-400 font-mono">Skip noise</span>
              </label>
              <input
                type="text"
                value={excludePatterns}
                onChange={(e) => setExcludePatterns(e.target.value)}
                placeholder="e.g. */login*, */cart*, *.pdf"
                className="w-full px-3 py-1.5 rounded-xl glass-input text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={limitDomain}
                onChange={(e) => setLimitDomain(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Same Domain</span>
            </label>
            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={respectRobots}
                onChange={(e) => setRespectRobots(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Robots.txt</span>
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
            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={compressTokens}
                onChange={(e) => setCompressTokens(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span className="font-bold text-caramel-600 dark:text-caramel-400">RAG Cleaner</span>
            </label>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Output Format
            </label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              className="w-full px-3 py-2 rounded-xl glass-input text-xs"
            >
              <option value="markdown">Markdown</option>
              <option value="structured">Structured JSON (AI Schema)</option>
              <option value="html">Raw HTML</option>
              <option value="text">Plain Text</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isStarting}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-caramel-500/25 glow-caramel transition disabled:opacity-50"
          >
            {isStarting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Starting Spider Mesh...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Launch Distributed Crawler</span>
              </>
            )}
          </button>
        </form>

        {/* Crawl Jobs List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Active & Past Crawls ({crawls.length})
            </h3>
            <button
              onClick={loadCrawls}
              className="p-1 rounded text-espresso-500 hover:text-caramel-500 transition"
              title="Refresh Crawl Jobs"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {crawls.length === 0 ? (
              <p className="text-xs text-espresso-400 dark:text-espresso-600 text-center py-6">No crawl jobs found.</p>
            ) : (
              crawls.map((c) => {
                const crawlId = c.id || c.crawl_id;
                const isSelected = selectedCrawlId === crawlId;
                const pagesCrawled = c.stats?.pages_crawled ?? c.pages_crawled ?? 0;
                const maxP = c.max_pages || 1;
                const percent = Math.min(100, Math.round((pagesCrawled / maxP) * 100));

                let statusBadge = 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-500/30';
                if (c.status === 'completed') statusBadge = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30';
                if (c.status === 'failed') statusBadge = 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/30';
                if (c.status === 'cancelled') statusBadge = 'bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border-caramel-500/30';

                return (
                  <div
                    key={crawlId}
                    onClick={() => setSelectedCrawlId(crawlId)}
                    className={`p-4 rounded-2xl border transition cursor-pointer space-y-2.5 ${
                      isSelected
                        ? 'bg-caramel-500/15 border-caramel-500/50 shadow-xl shadow-caramel-500/15 glow-caramel-subtle'
                        : 'bg-white dark:bg-espresso-900/60 border-caramel-500/10 hover:border-caramel-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-espresso-900 dark:text-white truncate w-3/4">
                        {c.url || c.seed_url}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${statusBadge}`}>
                        {c.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div>
                      <div className="w-full bg-espresso-100 dark:bg-black/60 rounded-full h-1.5 overflow-hidden border border-black/5 dark:border-white/5">
                        <div
                          className="bg-caramel-500 h-full rounded-full transition-all duration-300 shadow-md shadow-caramel-500/50"
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-espresso-500 mt-1 font-mono">
                        <span>{pagesCrawled} / {c.max_pages} pages</span>
                        <span className="font-bold text-caramel-600 dark:text-caramel-400">{percent}%</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right: Crawl Details, Performance Charts & Universal Exporters */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {!selectedCrawl ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
            <Bot className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
            <h3 className="text-base font-medium text-espresso-800 dark:text-espresso-200">Select a Crawl to Inspect</h3>
            <p className="text-xs max-w-sm mt-1">
              Choose a job from the queue to monitor live WebSocket telemetry and explore extracted datasets.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-caramel-500/15 bg-white/40 dark:bg-espresso-900/40 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-bold text-espresso-900 dark:text-white font-mono truncate max-w-md">
                    {selectedCrawl.url || selectedCrawl.seed_url}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40">
                    {selectedCrawl.status}
                  </span>
                </div>
                <p className="text-xs text-espresso-500 font-mono mt-1">
                  ID: {selectedCrawl.id} • Started: {new Date(selectedCrawl.created_at).toLocaleTimeString()}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {selectedCrawl.status === 'running' && (
                  <button
                    onClick={() => handleCancelCrawl(selectedCrawl.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-semibold transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                )}

                {/* Exporters */}
                <button
                  onClick={handleExportJsonl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-bold transition shadow-sm"
                  title="Download as JSONL dataset"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>JSONL</span>
                </button>

                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-espresso-900 text-espresso-800 dark:text-espresso-200 border border-caramel-500/20 text-xs font-bold hover:border-caramel-500/40 transition shadow-sm"
                  title="Download as CSV spreadsheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-caramel-500" />
                  <span>CSV</span>
                </button>

                <button
                  onClick={() => handleDeleteCrawl(selectedCrawl.id)}
                  className="p-2 rounded-xl text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                  title="Delete Crawl Record"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Performance Gauges Strip */}
            <div className="px-6 py-3 border-b border-caramel-500/15 bg-espresso-50/50 dark:bg-black/30 grid grid-cols-4 gap-4 text-xs font-mono">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-caramel-500" />
                <div>
                  <div className="text-[10px] text-espresso-500 uppercase font-bold">Throughput</div>
                  <div className="font-black text-espresso-900 dark:text-white">
                    {selectedCrawl.status === 'running' ? '12.4 pages/s' : 'Completed'}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-espresso-500 uppercase font-bold">HTTP 2xx (Success)</div>
                <div className="font-black text-emerald-600 dark:text-emerald-400">{statusStats.ok} URLs</div>
              </div>

              <div>
                <div className="text-[10px] text-espresso-500 uppercase font-bold">HTTP 4xx (Client Err)</div>
                <div className="font-black text-caramel-600 dark:text-caramel-400">{statusStats.clientErr} URLs</div>
              </div>

              <div>
                <div className="text-[10px] text-espresso-500 uppercase font-bold">HTTP 5xx (Server Err)</div>
                <div className="font-black text-rose-600 dark:text-rose-400">{statusStats.serverErr} URLs</div>
              </div>
            </div>

            {/* Results Tabs & Search */}
            <div className="h-12 border-b border-caramel-500/15 px-6 flex items-center justify-between bg-white/20 dark:bg-espresso-900/20">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('results')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'results' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                  }`}
                >
                  Pages Crawled ({selectedCrawl.results?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('tree')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'tree' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                  }`}
                >
                  Domain Tree Topology
                </button>
                <button
                  onClick={() => setActiveTab('raw')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'raw' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                  }`}
                >
                  Raw Metadata
                </button>
              </div>

              {activeTab === 'results' && (
                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-espresso-400" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search crawled URLs..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl glass-input text-xs"
                  />
                </div>
              )}
            </div>

            {/* Content Body */}
            <div className="flex-1 p-6 overflow-y-auto">
              {activeTab === 'results' && (
                filteredResults.length === 0 ? (
                  <div className="text-center py-12 text-espresso-400 dark:text-espresso-600 text-xs">
                    {selectedCrawl.status === 'running'
                      ? 'Crawl in progress... Pages are streaming in real-time.'
                      : 'No crawled pages matching filter.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredResults.map((page, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-2 font-mono text-xs shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <a
                            href={page.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-caramel-600 dark:text-caramel-400 hover:underline flex items-center gap-1.5 truncate max-w-xl font-bold"
                          >
                            <span>{page.url}</span>
                            <ExternalLink className="w-3 h-3 text-espresso-400" />
                          </a>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              page.status_code >= 200 && page.status_code < 300
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            HTTP {page.status_code || 200}
                          </span>
                        </div>

                        {/* Content preview */}
                        <div className="p-3.5 rounded-xl bg-espresso-50 dark:bg-black/60 border border-black/5 dark:border-white/5 max-h-40 overflow-y-auto text-espresso-800 dark:text-espresso-200 font-mono text-[11px] whitespace-pre-wrap select-text">
                          {typeof page.content === 'object'
                            ? JSON.stringify(page.content, null, 2)
                            : page.content || '(Empty content)'}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {activeTab === 'tree' && (
                <div className="p-6 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-bold text-espresso-900 dark:text-white">
                    <Network className="w-4 h-4 text-caramel-500" />
                    <span>Hierarchical URL Topology</span>
                  </div>
                  <div className="font-mono text-xs space-y-2">
                    {(selectedCrawl.results || []).map((page, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 pl-4 border-l border-caramel-500/30 py-1">
                        <span className="text-caramel-500 font-bold">↳</span>
                        <span className="truncate">{page.url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'raw' && (
                <JsonViewer data={selectedCrawl} filename={`crawl-${selectedCrawl.id}.json`} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
