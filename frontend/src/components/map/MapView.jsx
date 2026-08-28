import React, { useState } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import {
  Network,
  Play,
  Copy,
  Check,
  Download,
  Search,
  ExternalLink,
  Bot,
  Filter,
  Coffee,
  Layers,
  ArrowRight,
} from 'lucide-react';

export function MapView() {
  const { request } = useApi();
  const addToast = useCrawlStore((state) => state.addToast);
  const setActiveTab = useCrawlStore((state) => state.setActiveTab);

  const [url, setUrl] = useState('https://news.ycombinator.com');
  const [limit, setLimit] = useState(100);
  const [includeSitemap, setIncludeSitemap] = useState(true);
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [renderJs, setRenderJs] = useState(false);
  const [timeout, setTimeoutSec] = useState(15);

  const [isLoading, setIsLoading] = useState(false);
  const [mapResult, setMapResult] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTabLocal] = useState('list'); // 'list' | 'tree' | 'json'

  const handleMap = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      addToast({ type: 'warning', message: 'Please provide a target domain/URL' });
      return;
    }

    setIsLoading(true);
    setMapResult(null);

    try {
      const res = await request('/api/map', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          limit: Number(limit),
          include_sitemap: includeSitemap,
          allow_subdomains: allowSubdomains,
          render_js: renderJs,
          timeout: Number(timeout),
        }),
      });

      const urlsList = res.urls || res.links || [];
      const normalizedResult = { ...res, urls: urlsList, url: res.base_domain || url.trim() };
      setMapResult(normalizedResult);
      addToast({
        type: 'success',
        title: 'Site Mapping Completed',
        message: `Discovered ${urlsList.length} URLs in ${res.latency_ms} ms.`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Map Operation Failed', message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const discoveredUrls = mapResult?.urls || mapResult?.links || [];
  const filteredLinks = discoveredUrls.filter((l) =>
    l.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const handleCopyLinks = () => {
    if (!discoveredUrls.length) return;
    navigator.clipboard.writeText(discoveredUrls.join('\n'));
    setCopied(true);
    addToast({ type: 'success', message: 'Copied URL list to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    if (!discoveredUrls.length) return;
    const blob = new Blob([discoveredUrls.join('\n')], { type: 'text/plain' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    const hostname = url.includes('://') ? new URL(url).hostname : 'site';
    a.download = `sitemap-${hostname}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
    addToast({ type: 'success', message: 'Downloaded sitemap.txt' });
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Map Configuration */}
      <div className="w-[450px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-espresso-900 dark:text-white mb-1">
            <Network className="w-5 h-5 text-caramel-500" />
            <span>Deep Sitemap & Graph Mapper</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Rapidly discover full website topologies by combining robots.txt, recursive XML sitemaps, and BFS DOM link exploration.
          </p>
        </div>

        <form onSubmit={handleMap} className="p-5 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Root Domain / URL
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
              <span>Max URLs to Discover</span>
              <span className="font-mono text-caramel-600 dark:text-caramel-400 text-xs font-bold">{limit} URLs</span>
            </label>
            <input
              type="range"
              min="10"
              max="2000"
              step="10"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full accent-caramel-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSitemap}
                onChange={(e) => setIncludeSitemap(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Parse sitemap.xml</span>
            </label>

            <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowSubdomains}
                onChange={(e) => setAllowSubdomains(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500"
              />
              <span>Subdomains</span>
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
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-caramel-500/25 glow-caramel transition disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Mapping Domain Hierarchy...</span>
              </>
            ) : (
              <>
                <Network className="w-3.5 h-3.5" />
                <span>Discover Site Topology</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Right: Mapped Hierarchy & Visual Topology */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {!mapResult ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
            <Network className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
            <h3 className="text-base font-medium text-espresso-800 dark:text-espresso-200">Site Mapper Ready</h3>
            <p className="text-xs max-w-sm mt-1">
              Enter any domain root to extract complete URL structures without scraping page contents.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-caramel-500/15 bg-white/40 dark:bg-espresso-900/40 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-espresso-900 dark:text-white font-mono">
                  {mapResult.url}
                </h2>
                <p className="text-xs text-espresso-500 font-mono mt-0.5">
                  Discovered {discoveredUrls.length} unique URLs • {mapResult.latency_ms} ms
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyLinks}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-bold transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy All'}</span>
                </button>

                <button
                  onClick={handleDownloadTxt}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-espresso-900 text-espresso-800 dark:text-espresso-200 border border-caramel-500/20 text-xs font-bold hover:border-caramel-500/40 transition shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-caramel-500" />
                  <span>Download .txt</span>
                </button>
              </div>
            </div>

            {/* Filter Search */}
            <div className="h-12 border-b border-caramel-500/15 px-6 flex items-center justify-between bg-white/20 dark:bg-espresso-900/20">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTabLocal('list')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'list' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400'
                  }`}
                >
                  URL List ({filteredLinks.length})
                </button>
                <button
                  onClick={() => setActiveTabLocal('tree')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'tree' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400'
                  }`}
                >
                  Tree Topology
                </button>
                <button
                  onClick={() => setActiveTabLocal('json')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'json' ? 'bg-caramel-500 text-white shadow-md' : 'text-espresso-600 dark:text-espresso-400'
                  }`}
                >
                  Raw JSON
                </button>
              </div>

              {activeTab === 'list' && (
                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-espresso-400" />
                  <input
                    type="text"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Filter URLs..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl glass-input text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
              {activeTab === 'list' && (
                <div className="space-y-2">
                  {filteredLinks.map((link, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-white dark:bg-espresso-900/60 border border-caramel-500/10 flex items-center justify-between font-mono text-xs shadow-sm hover:border-caramel-500/30 transition"
                    >
                      <span className="text-espresso-800 dark:text-espresso-200 truncate pr-4">{link}</span>
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 rounded text-espresso-400 hover:text-caramel-500 shrink-0"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'tree' && (
                <div className="p-6 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 space-y-2 font-mono text-xs">
                  {filteredLinks.map((link, idx) => (
                    <div key={idx} className="flex items-center gap-2 pl-4 border-l border-caramel-500/30 py-0.5 text-espresso-700 dark:text-espresso-300">
                      <span className="text-caramel-500 font-bold">↳</span>
                      <span className="truncate">{link}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'json' && (
                <JsonViewer data={mapResult} filename="mapped-links.json" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
