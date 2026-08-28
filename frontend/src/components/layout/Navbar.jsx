import React, { useState } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { Modal } from '../common/Modal';
import {
  Coffee,
  Key,
  Layers,
  Sparkles,
  Cpu,
  Check,
  Zap,
  Terminal,
  BookOpen,
  Sun,
  Moon,
} from 'lucide-react';

export function Navbar() {
  const health = useCrawlStore((state) => state.health);
  const apiKey = useCrawlStore((state) => state.apiKey);
  const setApiKey = useCrawlStore((state) => state.setApiKey);
  const theme = useCrawlStore((state) => state.theme);
  const setTheme = useCrawlStore((state) => state.setTheme);
  const addToast = useCrawlStore((state) => state.addToast);
  const setActiveTab = useCrawlStore((state) => state.setActiveTab);

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  const handleSaveKey = (e) => {
    e.preventDefault();
    setApiKey(tempKey.trim());
    setIsKeyModalOpen(false);
    addToast({
      type: 'success',
      title: 'API Key Saved',
      message: tempKey.trim() ? 'API Key applied to all subsequent requests.' : 'API Key cleared.',
    });
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    addToast({
      type: 'info',
      message: nextTheme === 'dark' ? 'Switched to OLED Pitch Black Mode' : 'Switched to Warm Cream Light Mode',
    });
  };

  const getStatusBadge = () => {
    if (health.status === 'ok') {
      return {
        bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
        dot: 'bg-emerald-400',
        label: 'Cluster Online',
      };
    }
    if (health.status === 'degraded') {
      return {
        bg: 'bg-caramel-500/10 text-caramel-500 border-caramel-500/30',
        dot: 'bg-caramel-400',
        label: 'Degraded',
      };
    }
    return {
      bg: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
      dot: 'bg-rose-400',
      label: 'Disconnected',
    };
  };

  const status = getStatusBadge();

  return (
    <>
      <header className="sticky top-0 z-40 w-full h-16 border-b border-caramel-500/20 bg-espresso-950/90 dark:bg-black/90 backdrop-blur-2xl px-6 flex items-center justify-between transition-colors">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-caramel-600 via-caramel-500 to-caramel-400 shadow-lg shadow-caramel-500/30 glow-caramel-subtle">
            <Coffee className="w-5 h-5 text-white fill-white animate-pulse" />
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-caramel-300 ring-2 ring-black"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black tracking-tight font-mono text-espresso-900 dark:text-white">
                CRAWL<span className="text-caramel-500">IX</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-full bg-caramel-500/15 text-caramel-600 dark:text-caramel-400 border border-caramel-500/30 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Cyber Espresso
              </span>
            </div>
            <p className="text-[11px] text-espresso-500 dark:text-espresso-400 -mt-0.5 font-sans">
              High-Octane Autonomous Web Extraction & Intelligence
            </p>
          </div>
        </div>

        {/* Right: Metrics & Actions */}
        <div className="flex items-center gap-3 text-xs">
          {/* Live Browser Slots */}
          <div
            className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-espresso-50/80 dark:bg-espresso-900/80 border border-caramel-500/15 text-espresso-600 dark:text-espresso-300"
            title="Available Chromium worker slots"
          >
            <Cpu className="w-3.5 h-3.5 text-caramel-500" />
            <span>Browser Slots:</span>
            <span className="font-bold text-espresso-900 dark:text-white font-mono">
              {health.playwright_slots_free ?? 0} free
            </span>
          </div>

          {/* Redis Sessions */}
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-espresso-50/80 dark:bg-espresso-900/80 border border-caramel-500/15 text-espresso-600 dark:text-espresso-300"
            title="Active persistent sessions in Redis"
          >
            <Layers className="w-3.5 h-3.5 text-caramel-400" />
            <span>Sessions:</span>
            <span className="font-bold text-espresso-900 dark:text-white font-mono">
              {health.active_sessions ?? 0}
            </span>
          </div>

          {/* Health Status Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border font-medium ${status.bg}`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${status.dot}`}
              ></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${status.dot}`}></span>
            </span>
            <span>{status.label}</span>
          </div>

          {/* Light / Dark Mode Toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-espresso-100 dark:bg-espresso-900 border border-caramel-500/20 text-espresso-700 dark:text-caramel-300 hover:border-caramel-500/50 transition font-medium"
            title={theme === 'dark' ? 'Switch to Warm Cream Light Mode' : 'Switch to OLED Pitch Black Mode'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-caramel-400" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-caramel-600" />
                <span>OLED Black</span>
              </>
            )}
          </button>

          {/* Quick MCP / Docs Button */}
          <button
            onClick={() => setActiveTab('docs')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-espresso-100 dark:bg-espresso-900 border border-caramel-500/20 text-espresso-700 dark:text-espresso-200 hover:text-caramel-500 transition font-medium"
            title="View API Specs & Model Context Protocol"
          >
            <BookOpen className="w-3.5 h-3.5 text-caramel-500" />
            <span>MCP & Docs</span>
          </button>

          {/* API Key Modal Button */}
          <button
            onClick={() => {
              setTempKey(apiKey);
              setIsKeyModalOpen(true);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border font-semibold transition ${
              apiKey
                ? 'bg-caramel-500/15 border-caramel-500/40 text-caramel-600 dark:text-caramel-300 hover:bg-caramel-500/25 shadow-lg shadow-caramel-500/10'
                : 'bg-espresso-100 dark:bg-espresso-900 border-caramel-500/20 text-espresso-700 dark:text-espresso-300 hover:border-caramel-500/40'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>{apiKey ? 'API Key Active' : 'Set API Key'}</span>
          </button>
        </div>
      </header>

      {/* API Key Modal */}
      <Modal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        title="Crawlix API Key & Access Tokens"
      >
        <form onSubmit={handleSaveKey} className="space-y-4">
          <p className="text-sm text-espresso-600 dark:text-espresso-300 leading-relaxed">
            Provide your Crawlix Master API Key or tenant key. It will be sent via the{' '}
            <code className="text-caramel-600 dark:text-caramel-400 px-1.5 py-0.5 bg-black/10 dark:bg-black/50 rounded font-mono text-xs">x-api-key</code>{' '}
            header with every outbound request.
          </p>

          <div>
            <label className="block text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider mb-2">
              Master API Key
            </label>
            <input
              type="password"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="e.g. crawlix_live_09f87a..."
              className="w-full px-4 py-2.5 rounded-xl glass-input font-mono text-sm"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-caramel-500/15">
            <button
              type="button"
              onClick={() => {
                setTempKey('');
                setApiKey('');
                setIsKeyModalOpen(false);
                addToast({ type: 'info', message: 'API Key cleared' });
              }}
              className="px-4 py-2 rounded-xl text-espresso-500 hover:text-espresso-800 dark:hover:text-white transition text-sm"
            >
              Clear Key
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="px-4 py-2 rounded-xl text-espresso-600 dark:text-espresso-300 hover:bg-black/5 dark:hover:bg-white/5 transition text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-caramel hover:opacity-90 text-white font-semibold shadow-lg shadow-caramel-500/25 transition text-sm"
              >
                <Check className="w-4 h-4" /> Save Key
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
