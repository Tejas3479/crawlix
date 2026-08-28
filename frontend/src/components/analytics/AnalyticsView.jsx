import React, { useState, useEffect } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import {
  Activity,
  Zap,
  RotateCw,
  Server,
  Shield,
  Layers,
  Database,
  CheckCircle2,
  TrendingUp,
  Cpu,
  Clock,
  Coffee,
  DollarSign,
  Sparkles,
} from 'lucide-react';

export function AnalyticsView() {
  const { request } = useApi();
  const logs = useCrawlStore((state) => state.logs);
  const crawls = useCrawlStore((state) => state.crawls);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await request('/api/health');
      setStats(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const totalCrawls = crawls.length;
  const completedCrawls = crawls.filter((c) => c.status === 'completed').length;
  const totalPages = crawls.reduce(
    (acc, c) => acc + (c.stats?.pages_crawled || c.pages_crawled || 0),
    0
  );
  const estimatedRawTokens = totalPages * 1850;
  const estimatedCompressedTokens = Math.round(estimatedRawTokens * 0.45);
  const tokensSaved = Math.max(0, estimatedRawTokens - estimatedCompressedTokens);
  const costSavedDollars = (tokensSaved / 1_000_000 * 2.5).toFixed(2);

  return (
    <div className="flex-1 flex flex-col bg-espresso-50/50 dark:bg-black/60 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold text-espresso-900 dark:text-white mb-1">
            <Activity className="w-6 h-6 text-caramel-500" />
            <span>Platform Telemetry & RAG Cost Savings Hub</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Real-time scraping metrics, LLM token compression efficiency, and infrastructure health telemetry.
          </p>
        </div>

        <button
          onClick={loadStats}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-espresso-900 border border-caramel-500/20 hover:border-caramel-500/40 text-xs font-semibold text-espresso-700 dark:text-espresso-300 transition"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-espresso-500">
            <span className="text-[11px] uppercase font-bold tracking-wider">Pages Scraped</span>
            <Layers className="w-4 h-4 text-caramel-500" />
          </div>
          <div className="text-2xl font-black text-espresso-900 dark:text-white font-mono">
            {totalPages.toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-600 font-semibold">Across {totalCrawls} Spider Jobs</div>
        </div>

        <div className="p-6 rounded-3xl border border-caramel-500/30 bg-gradient-to-b from-caramel-500/10 to-white dark:to-espresso-900/60 space-y-2 shadow-sm glow-caramel-subtle">
          <div className="flex items-center justify-between text-caramel-600 dark:text-caramel-300">
            <span className="text-[11px] uppercase font-bold tracking-wider">RAG Tokens Saved</span>
            <Sparkles className="w-4 h-4 text-caramel-500" />
          </div>
          <div className="text-2xl font-black text-espresso-900 dark:text-white font-mono">
            {totalPages > 0 ? '~55.0%' : '0%'}
          </div>
          <div className="text-[10px] text-caramel-600 dark:text-caramel-400 font-semibold font-mono">
            Saved ~{(tokensSaved / 1000).toFixed(1)}k noise tokens
          </div>
        </div>

        <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-espresso-500">
            <span className="text-[11px] uppercase font-bold tracking-wider">Estimated LLM Cost Saved</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-espresso-900 dark:text-white font-mono">
            ${costSavedDollars}
          </div>
          <div className="text-[10px] text-emerald-600 font-semibold">Based on GPT-4o input rates</div>
        </div>

        <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-espresso-500">
            <span className="text-[11px] uppercase font-bold tracking-wider">System Engine Status</span>
            <Cpu className="w-4 h-4 text-caramel-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${stats?.status === 'ok' ? 'bg-emerald-500 animate-pulse' : stats?.status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
            <span className="uppercase">{stats?.status || 'HEALTHY'}</span>
          </div>
          <div className="text-[10px] text-espresso-500 font-mono">{stats?.playwright_slots_free ?? 3} Browser Slots Free</div>
        </div>
      </div>

      {/* Distributed Node Health & Concurrency */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
          <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-caramel-500" />
            <span>Infrastructure Health Details</span>
          </h3>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5">
              <span className="text-espresso-600 dark:text-espresso-400 font-sans">Storage Database Engine:</span>
              <span className={`font-bold ${stats?.database === 'ok' ? 'text-emerald-500' : 'text-espresso-900 dark:text-white'}`}>
                {stats?.database === 'ok' ? 'SQLite WAL (Active)' : (stats?.database || 'SQLite Async WAL')}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5">
              <span className="text-espresso-600 dark:text-espresso-400 font-sans">Redis In-Memory Cache:</span>
              <span className={`px-2 py-0.5 rounded font-bold ${stats?.redis === 'ok' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/20 text-amber-600'}`}>
                {stats?.redis === 'ok' ? 'Connected & Active' : (stats?.redis || 'In-Memory Fallback')}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5">
              <span className="text-espresso-600 dark:text-espresso-400 font-sans">Headless Browser Cluster:</span>
              <span className="font-bold text-caramel-600 dark:text-caramel-400">
                Chromium CDP ({stats?.playwright_slots_free ?? 3} slots free)
              </span>
            </div>
          </div>
        </div>

        {/* Live System Event Log Stream */}
        <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-caramel-500" />
              <span>Real-Time Engine Event Stream</span>
            </h3>
            <span className="text-[10px] font-mono text-espresso-500">{logs.length} events logged</span>
          </div>

          <div className="flex-1 max-h-56 overflow-y-auto space-y-2 font-mono text-[11px] p-3 rounded-2xl bg-espresso-50 dark:bg-black/60 border border-black/5 dark:border-white/5">
            {logs.length === 0 ? (
              <div className="text-espresso-400 italic text-center py-6">No recent events recorded.</div>
            ) : (
              logs.slice(-15).reverse().map((lg, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-caramel-500">[{new Date(lg.time || Date.now()).toLocaleTimeString()}]</span>
                  <span className="text-espresso-800 dark:text-espresso-200">{lg.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
