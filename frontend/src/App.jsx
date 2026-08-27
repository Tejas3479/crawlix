import { useEffect } from 'react';
import { useCrawlStore } from './store/useCrawlStore';
import { useWebSocket } from './hooks/useWebSocket';

function App() {
  useWebSocket('ws://localhost:8000/api/ws/crawls');
  const crawls = useCrawlStore(state => state.crawls);
  const logs = useCrawlStore(state => state.logs);

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Crawlix v2.0
        </h1>
        <p className="text-neutral-400">Agentic Vision-Based Scraper</p>
      </header>
      
      <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="glass-panel p-6 rounded-2xl">
          <h2 className="text-xl font-semibold mb-4">Real-time VLM Crawls</h2>
          {crawls.length === 0 ? (
            <p className="text-neutral-500 text-sm">No active crawls.</p>
          ) : (
            crawls.map(crawl => (
              <div key={crawl.id} className="mb-4 p-4 border border-white/10 rounded-xl bg-black/20">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-sm truncate w-2/3">{crawl.seed_url}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${crawl.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {crawl.status}
                  </span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-1.5 mb-1">
                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (crawl.pages_crawled / crawl.max_pages) * 100)}%` }}></div>
                </div>
                <div className="text-xs text-neutral-400 text-right">{crawl.pages_crawled} / {crawl.max_pages} pages</div>
              </div>
            ))
          )}
        </section>

        <section className="glass-panel p-6 rounded-2xl flex flex-col h-[500px]">
          <h2 className="text-xl font-semibold mb-4">System Event Log</h2>
          <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs">
            {logs.map((log, i) => (
              <div key={i} className={`p-2 rounded ${log.type === 'error' ? 'text-red-400 bg-red-900/20' : log.type === 'warning' ? 'text-yellow-400 bg-yellow-900/20' : 'text-neutral-300'}`}>
                [{new Date().toLocaleTimeString()}] {log.message}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
