import React, { useEffect } from 'react';
import { useCrawlStore } from './store/useCrawlStore';
import { useWebSocket } from './hooks/useWebSocket';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/common/ToastContainer';

// Workspaces
import { PlaygroundView } from './components/fetch/PlaygroundView';
import { CrawlerStudio } from './components/crawler/CrawlerStudio';
import { AgenticView } from './components/agentic/AgenticView';
import { InspectorView } from './components/inspector/InspectorView';
import { BatchView } from './components/batch/BatchView';
import { VectorRagView } from './components/rag/VectorRagView';
import { MapView } from './components/map/MapView';
import { SearchView } from './components/search/SearchView';
import { AdminView } from './components/admin/AdminView';
import { SessionsView } from './components/sessions/SessionsView';
import { ApiDocsView } from './components/docs/ApiDocsView';
import { AnalyticsView } from './components/analytics/AnalyticsView';

export default function App() {
  const activeTab = useCrawlStore((state) => state.activeTab);
  const theme = useCrawlStore((state) => state.theme);

  // Initialize theme class on <html>
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Auto-connect real-time WebSocket stream
  useWebSocket();

  return (
    <div className="flex flex-col h-screen w-screen bg-espresso-50 dark:bg-black text-espresso-900 dark:text-espresso-100 antialiased overflow-hidden font-sans selection:bg-caramel-500 selection:text-white transition-colors">
      {/* Top Navigation Bar */}
      <Navbar />

      {/* Main Workspace Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar Navigation */}
        <Sidebar />

        {/* Dynamic Workspace Container */}
        <main className="flex-1 flex overflow-hidden relative bg-gradient-latte-light dark:bg-gradient-espresso-dark">
          {activeTab === 'fetch' && <PlaygroundView />}
          {activeTab === 'crawler' && <CrawlerStudio />}
          {activeTab === 'agentic' && <AgenticView />}
          {activeTab === 'inspector' && <InspectorView />}
          {activeTab === 'batch' && <BatchView />}
          {activeTab === 'rag' && <VectorRagView />}
          {activeTab === 'map' && <MapView />}
          {activeTab === 'search' && <SearchView />}
          {activeTab === 'proxies' && <AdminView />}
          {activeTab === 'sessions' && <SessionsView />}
          {activeTab === 'docs' && <ApiDocsView />}
          {activeTab === 'analytics' && <AnalyticsView />}
        </main>
      </div>

      {/* Toast Notification Container */}
      <ToastContainer />
    </div>
  );
}
