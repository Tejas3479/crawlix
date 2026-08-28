import React, { useState, useEffect } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import {
  Layers,
  Trash2,
  RotateCw,
  Download,
  Clock,
  Shield,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';

export function SessionsView() {
  const { request } = useApi();
  const sessions = useCrawlStore((state) => state.sessions);
  const setSessions = useCrawlStore((state) => state.setSessions);
  const addToast = useCrawlStore((state) => state.addToast);

  const [isLoading, setIsLoading] = useState(false);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const data = await request('/api/sessions');
      setSessions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleDeleteSession = async (sid) => {
    try {
      await request(`/api/sessions/${sid}`, { method: 'DELETE' });
      addToast({ type: 'success', message: `Deleted session: ${sid}` });
      loadSessions();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleDownloadCsv = () => {
    if (!sessions || sessions.length === 0) return;
    let csv = 'Session ID,Engine,Requests,Cookies,Created At,Last Active\n';
    sessions.forEach((s) => {
      csv += `"${s.session_id}","${s.engine}",${s.request_count},${s.cookie_count},"${s.created_at}","${s.last_active}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crawlix-sessions-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Sessions CSV exported' });
  };

  const handleDownloadJson = () => {
    if (!sessions || sessions.length === 0) return;
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crawlix-sessions-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Sessions JSON exported' });
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-1">
            <Layers className="w-5 h-5 text-purple-400" />
            Active Session Contexts
          </h2>
          <p className="text-xs text-neutral-400">
            Persistent browser and TLS sessions stored in Redis with cookies and state preservation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadSessions}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-200 transition"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleDownloadCsv}
            disabled={sessions.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-200 transition disabled:opacity-40"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handleDownloadJson}
            disabled={sessions.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-xs text-purple-300 transition disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Sessions Grid / Table */}
      {sessions.length === 0 ? (
        <div className="text-center py-16 border border-white/10 rounded-2xl bg-white/[0.01] text-neutral-500">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <h3 className="text-base font-medium text-neutral-300">No Active Sessions in Redis</h3>
          <p className="text-xs max-w-sm mx-auto mt-1">
            Pass a <code className="text-brand-400">session_id</code> during any scrape request to persist cookies and browser contexts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <div
              key={s.session_id}
              className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-white truncate max-w-[200px]">
                  {s.session_id}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                    s.engine === 'playwright'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                  }`}
                >
                  {s.engine}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-neutral-300 pt-1">
                <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                  <span className="text-[10px] text-neutral-500 uppercase block">Requests</span>
                  <span className="text-sm font-bold text-brand-400">{s.request_count}</span>
                </div>
                <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                  <span className="text-[10px] text-neutral-500 uppercase block">Cookies</span>
                  <span className="text-sm font-bold text-purple-400">{s.cookie_count}</span>
                </div>
              </div>

              <div className="text-[11px] text-neutral-400 space-y-1 font-mono">
                <div>Created: {new Date(s.created_at).toLocaleString()}</div>
                <div>Last Active: {new Date(s.last_active).toLocaleString()}</div>
              </div>

              <button
                onClick={() => handleDeleteSession(s.session_id)}
                className="w-full py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Terminate Session
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
