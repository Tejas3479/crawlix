import React, { useState } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import {
  Search,
  Play,
  ExternalLink,
  FileText,
  Sparkles,
  ArrowRight,
  Globe,
  Coffee,
  Copy,
  Check,
  Zap,
  Sliders,
  Layers,
} from 'lucide-react';

export function SearchView() {
  const { request } = useApi();
  const addToast = useCrawlStore((state) => state.addToast);

  const [query, setQuery] = useState('Top AI web scraping tools 2026');
  const [provider, setProvider] = useState('duckduckgo');
  const [maxResults, setMaxResults] = useState(5);
  const [fetchContent, setFetchContent] = useState(true);
  const [contentLimit, setContentLimit] = useState(3);
  const [renderJs, setRenderJs] = useState(false);
  const [compressTokens, setCompressTokens] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      addToast({ type: 'warning', message: 'Please enter a search query' });
      return;
    }

    setIsLoading(true);
    setSearchResult(null);
    setSelectedResult(null);

    try {
      const res = await request('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          provider,
          max_results: Number(maxResults),
          fetch_content: fetchContent,
          content_limit: Number(contentLimit),
          render_js: renderJs,
        }),
      });

      setSearchResult(res);
      if (res.results && res.results.length > 0) {
        setSelectedResult(res.results[0]);
      }
      addToast({
        type: 'success',
        title: 'Search Completed',
        message: `Found ${res.results?.length || 0} organic results in ${res.latency_ms} ms.`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Search Failed', message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMarkdown = (content, idx) => {
    if (!content) return;
    navigator.clipboard.writeText(typeof content === 'object' ? JSON.stringify(content, null, 2) : content);
    setCopiedIdx(idx);
    addToast({ type: 'success', message: 'Copied Markdown to clipboard' });
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Query Parameters */}
      <div className="w-[450px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-espresso-900 dark:text-white mb-1">
            <Search className="w-5 h-5 text-caramel-500" />
            <span>SERP Search & Direct Markdown</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Query top search engines and automatically scrape organic search results into clean LLM markdown.
          </p>
        </div>

        <form onSubmit={handleSearch} className="p-5 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Search Query
            </label>
            <input
              type="text"
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. latest generative AI research"
              className="w-full px-3.5 py-2 rounded-xl glass-input text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                SERP Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs"
              >
                <option value="duckduckgo">DuckDuckGo (Free)</option>
                <option value="google">Google Search (Custom)</option>
                <option value="bing">Bing Search</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Max SERP Hits
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs"
              />
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-caramel-500/15">
            <label className="flex items-center gap-2 text-xs text-espresso-800 dark:text-espresso-200 cursor-pointer font-bold">
              <input
                type="checkbox"
                checked={fetchContent}
                onChange={(e) => setFetchContent(e.target.checked)}
                className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
              />
              <span>Scrape & Extract Page Content for Hits</span>
            </label>

            {fetchContent && (
              <div className="space-y-2 pl-4 border-l border-caramel-500/30">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                    Scrape Top N Results
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={maxResults}
                    value={contentLimit}
                    onChange={(e) => setContentLimit(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl glass-input text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
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
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-caramel-500/25 glow-caramel transition disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Searching & Scraping...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Search & Extract Knowledge</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Right: Results List & Full Markdown Viewer */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {!searchResult ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
            <Search className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
            <h3 className="text-base font-medium text-espresso-800 dark:text-espresso-200">SERP Search Studio</h3>
            <p className="text-xs max-w-sm mt-1">
              Enter any query to search the live web and ingest top search results directly into markdown.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-caramel-500/15 bg-white/40 dark:bg-espresso-900/40 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-espresso-900 dark:text-white">
                  Results for "{searchResult.query}"
                </h2>
                <p className="text-xs text-espresso-500 font-mono mt-0.5">
                  Found {searchResult.results?.length || 0} links • {searchResult.latency_ms} ms
                </p>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Left Column: Organic Links List */}
              <div className="w-1/2 border-r border-caramel-500/15 p-6 overflow-y-auto space-y-3">
                {searchResult.results?.map((res, idx) => {
                  const isSelected = selectedResult?.url === res.url;
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedResult(res)}
                      className={`p-4 rounded-2xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-caramel-500/15 border-caramel-500/50 shadow-md glow-caramel-subtle'
                          : 'bg-white dark:bg-espresso-900/60 border-caramel-500/10 hover:border-caramel-500/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-espresso-900 dark:text-white line-clamp-2">
                          {res.title || res.url}
                        </h4>
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded text-espresso-400 hover:text-caramel-500 shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>

                      <p className="text-[11px] text-espresso-600 dark:text-espresso-300 line-clamp-2 font-serif">
                        {res.snippet}
                      </p>

                      <div className="flex items-center justify-between text-[10px] text-espresso-500 font-mono pt-1">
                        <span className="truncate max-w-[200px]">{new URL(res.url).hostname}</span>
                        {res.content && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                            Scraped
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Content Preview */}
              <div className="w-1/2 p-6 overflow-y-auto bg-white/20 dark:bg-espresso-900/20 flex flex-col">
                {selectedResult ? (
                  <div className="space-y-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between pb-3 border-b border-caramel-500/15">
                      <div className="min-w-0 pr-4">
                        <h3 className="text-xs font-bold text-espresso-900 dark:text-white truncate">
                          {selectedResult.title || selectedResult.url}
                        </h3>
                        <a
                          href={selectedResult.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-caramel-600 dark:text-caramel-400 hover:underline truncate block"
                        >
                          {selectedResult.url}
                        </a>
                      </div>

                      {selectedResult.content && (
                        <button
                          onClick={() => handleCopyMarkdown(selectedResult.content, 1)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-bold transition shrink-0"
                        >
                          {copiedIdx === 1 ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedIdx === 1 ? 'Copied' : 'Copy MD'}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex-1 p-4 rounded-2xl bg-espresso-50 dark:bg-black/60 border border-black/5 dark:border-white/5 overflow-y-auto text-espresso-800 dark:text-espresso-200 font-mono text-xs whitespace-pre-wrap select-text leading-relaxed">
                      {selectedResult.content ? (
                        typeof selectedResult.content === 'object' ? (
                          JSON.stringify(selectedResult.content, null, 2)
                        ) : (
                          selectedResult.content
                        )
                      ) : (
                        <span className="text-espresso-400 italic">No content scraped for this hit. Enable "Scrape & Extract Page Content" to ingest full pages.</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-espresso-400 text-xs">
                    Select a search hit on the left to preview extracted content.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
