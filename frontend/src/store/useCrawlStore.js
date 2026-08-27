import { create } from 'zustand';

export const useCrawlStore = create((set) => ({
  activeTab: 'fetch',
  crawls: [],
  logs: [],
  setActiveTab: (tab) => set({ activeTab: tab }),
  setCrawls: (crawls) => set({ crawls }),
  updateCrawl: (updatedCrawl) => set((state) => ({
    crawls: state.crawls.map(c => c.id === updatedCrawl.crawl_id ? { ...c, ...updatedCrawl } : c)
  })),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] }))
}));
