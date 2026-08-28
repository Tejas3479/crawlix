import React from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import {
  Zap,
  Bot,
  Compass,
  Eye,
  FileSpreadsheet,
  Database,
  Network,
  Search,
  Server,
  BookOpen,
  Activity,
  Coffee,
} from 'lucide-react';

export function Sidebar() {
  const activeTab = useCrawlStore((state) => state.activeTab);
  const setActiveTab = useCrawlStore((state) => state.setActiveTab);
  const crawls = useCrawlStore((state) => state.crawls);

  const activeCrawlsCount = crawls.filter(
    (c) => c.status === 'running' || c.status === 'pending'
  ).length;

  const workspaces = [
    {
      group: 'Core Scraping & Intelligence',
      items: [
        {
          id: 'fetch',
          label: 'Playground & VLM',
          icon: Zap,
          badge: 'Vision Ready',
          badgeColor: 'bg-caramel-500/20 text-caramel-600 dark:text-caramel-300 border-caramel-500/40',
        },
        {
          id: 'crawler',
          label: 'Crawler Studio',
          icon: Bot,
          badge: activeCrawlsCount > 0 ? `${activeCrawlsCount} Active` : null,
          badgeColor: 'bg-caramel-500 text-white font-bold animate-pulse',
        },
        {
          id: 'agentic',
          label: 'Agentic Navigator',
          icon: Compass,
          badge: 'Autonomous',
          badgeColor: 'bg-caramel-400/20 text-caramel-700 dark:text-caramel-300 border-caramel-400/40',
        },
        {
          id: 'inspector',
          label: 'Visual Inspector',
          icon: Eye,
          badge: 'Point & Click',
          badgeColor: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/40',
        },
      ],
    },
    {
      group: 'Bulk & AI Data Pipeline',
      items: [
        {
          id: 'batch',
          label: 'Batch Studio',
          icon: FileSpreadsheet,
        },
        {
          id: 'rag',
          label: 'Vector & RAG Hub',
          icon: Database,
          badge: 'Pinecone/pgvector',
          badgeColor: 'bg-hazelnut-400/20 text-hazelnut-600 dark:text-hazelnut-300 border-hazelnut-400/40',
        },
        {
          id: 'map',
          label: 'Site Mapper',
          icon: Network,
        },
        {
          id: 'search',
          label: 'SERP Search',
          icon: Search,
        },
      ],
    },
    {
      group: 'Infrastructure & Developer',
      items: [
        {
          id: 'proxies',
          label: 'Proxies & Sessions',
          icon: Server,
        },
        {
          id: 'docs',
          label: 'API & MCP Spec',
          icon: BookOpen,
          badge: 'MCP v1.0',
          badgeColor: 'bg-caramel-500/20 text-caramel-600 dark:text-caramel-400 border-caramel-500/30',
        },
        {
          id: 'analytics',
          label: 'System Telemetry',
          icon: Activity,
        },
      ],
    },
  ];

  return (
    <aside className="w-64 shrink-0 border-r border-caramel-500/15 bg-espresso-50/70 dark:bg-black/70 p-3.5 flex flex-col justify-between overflow-y-auto transition-colors">
      <div className="space-y-5">
        {workspaces.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-espresso-500 dark:text-espresso-400">
              {group.group}
            </div>

            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all text-xs ${
                    isActive
                      ? 'bg-gradient-to-r from-caramel-500/20 to-caramel-500/5 border border-caramel-500/40 text-espresso-900 dark:text-white font-semibold shadow-lg shadow-caramel-500/10 glow-caramel-subtle'
                      : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-espresso-100 hover:bg-black/5 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-caramel-500' : 'text-espresso-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${
                        item.badgeColor || 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-espresso-600 dark:text-espresso-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Cyber Espresso Card */}
      <div className="mt-4 p-3.5 rounded-2xl border border-caramel-500/25 bg-gradient-to-b from-caramel-500/10 via-black/10 dark:via-black/40 to-transparent">
        <div className="flex items-center gap-2 text-xs font-bold text-caramel-600 dark:text-caramel-400 mb-1">
          <Coffee className="w-3.5 h-3.5 fill-caramel-500" />
          <span>Crawlix Espresso Engine</span>
        </div>
        <p className="text-[11px] text-espresso-600 dark:text-espresso-400 leading-relaxed">
          Ultra-high-octane crawling with TLS spoofing, CDP stealth, and multimodal Vision intelligence.
        </p>
      </div>
    </aside>
  );
}
