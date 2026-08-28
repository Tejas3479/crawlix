import { create } from 'zustand';

export const useCrawlStore = create((set, get) => ({
  // Navigation & Core Config
  activeTab: 'fetch',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Theme state ('dark' | 'light')
  theme: localStorage.getItem('crawlix_theme') || 'dark',
  setTheme: (theme) => {
    localStorage.setItem('crawlix_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },

  apiKey: localStorage.getItem('crawlix_api_key') || '',
  setApiKey: (key) => {
    localStorage.setItem('crawlix_api_key', key);
    set({ apiKey: key });
  },

  // Health Stats
  health: {
    status: 'checking',
    database: 'unknown',
    redis: 'unknown',
    active_sessions: 0,
    playwright_slots_free: 0,
  },
  setHealth: (health) => set({ health }),

  // Crawls State
  crawls: [],
  activeCrawlId: null,
  activeCrawlDetails: null,
  setCrawls: (crawls) => set({
    crawls: (crawls || []).map((c) => ({
      ...c,
      id: c.id || c.crawl_id,
      crawl_id: c.crawl_id || c.id,
    })),
  }),
  setActiveCrawlId: (id) => set({ activeCrawlId: id }),
  setActiveCrawlDetails: (details) => set({ activeCrawlDetails: details }),
  updateCrawl: (update) => set((state) => {
    const targetId = update.crawl_id || update.id;
    const crawls = state.crawls.map((c) =>
      (c.id === targetId || c.crawl_id === targetId)
        ? {
            ...c,
            status: update.status || c.status,
            pages_crawled: update.pages_crawled ?? c.pages_crawled,
            results: update.results ? [...(c.results || []), ...update.results] : c.results,
          }
        : c
    );

    // Also update active crawl details if selected
    let activeCrawlDetails = state.activeCrawlDetails;
    if (activeCrawlDetails && (activeCrawlDetails.id === targetId || activeCrawlDetails.crawl_id === targetId)) {
      activeCrawlDetails = {
        ...activeCrawlDetails,
        status: update.status || activeCrawlDetails.status,
        stats: {
          ...(activeCrawlDetails.stats || {}),
          pages_crawled: update.pages_crawled ?? activeCrawlDetails.stats?.pages_crawled,
        },
        results: update.results
          ? [...(activeCrawlDetails.results || []), ...update.results]
          : activeCrawlDetails.results,
      };
    }

    return { crawls, activeCrawlDetails };
  }),

  // Fetch History (persisted)
  fetchHistory: JSON.parse(localStorage.getItem('crawlix_history') || '[]'),
  addFetchHistory: (item) => set((state) => {
    const updated = [item, ...state.fetchHistory.filter(h => h.id !== item.id)].slice(0, 50);
    localStorage.setItem('crawlix_history', JSON.stringify(updated));
    return { fetchHistory: updated };
  }),
  clearFetchHistory: () => {
    localStorage.removeItem('crawlix_history');
    set({ fetchHistory: [] });
  },

  // Sessions
  sessions: [],
  setSessions: (sessions) => set({ sessions }),

  // Admin: Proxies, Destinations, Schedules
  proxies: [],
  setProxies: (proxies) => set({ proxies }),
  destinations: [],
  setDestinations: (destinations) => set({ destinations }),
  schedules: [],
  setSchedules: (schedules) => set({ schedules }),

  // Batch Jobs
  batchJobs: [],
  setBatchJobs: (batchJobs) => set({ batchJobs }),

  // Real-time Event Logs
  logs: [
    {
      id: 1,
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Crawlix v2.0 dashboard initialized. Ready for high-scale agentic extraction.',
    },
  ],
  addLog: (log) => set((state) => ({
    logs: [
      {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        ...log,
      },
      ...state.logs.slice(0, 199),
    ],
  })),
  clearLogs: () => set({ logs: [] }),

  // Toast Notifications
  toasts: [],
  addToast: (toast) => {
    const id = Date.now() + Math.random();
    const newToast = { id, type: 'info', duration: 4000, ...toast };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    if (newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, newToast.duration);
    }
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
}));
