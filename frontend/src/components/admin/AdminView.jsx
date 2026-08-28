import React, { useState, useEffect } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import {
  Shield,
  Plus,
  Trash2,
  RotateCw,
  Database,
  Calendar,
  Layers,
  Key,
  CheckCircle2,
  ExternalLink,
  Coffee,
  Server,
  Zap,
  Send,
  Lock,
  Copy,
  Check,
  Activity,
} from 'lucide-react';

export function AdminView() {
  const { request } = useApi();
  const proxies = useCrawlStore((state) => state.proxies);
  const setProxies = useCrawlStore((state) => state.setProxies);
  const destinations = useCrawlStore((state) => state.destinations);
  const setDestinations = useCrawlStore((state) => state.setDestinations);
  const schedules = useCrawlStore((state) => state.schedules);
  const setSchedules = useCrawlStore((state) => state.setSchedules);
  const addToast = useCrawlStore((state) => state.addToast);

  const [activeSubTab, setActiveSubTab] = useState('keys'); // 'keys' | 'webhooks' | 'proxies' | 'destinations' | 'schedules'

  // API Key Management State
  const [apiKeys, setApiKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
  const [keyRateLimit, setKeyRateLimit] = useState(60);
  const [copiedKey, setCopiedKey] = useState(null);

  // Webhook Testbench State
  const [webhookTestUrl, setWebhookTestUrl] = useState('https://webhook.site/test');
  const [webhookSecret, setWebhookSecret] = useState('crawlix_secret_key_123');
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState(null);

  // Proxy form
  const [proxyInput, setProxyInput] = useState('');

  // Destination form
  const [destName, setDestName] = useState('');
  const [destType, setDestType] = useState('pinecone');
  const [destConfig, setDestConfig] = useState('{"api_key": "...", "index_name": "crawlix"}');

  // Schedule form
  const [cronExpr, setCronExpr] = useState('0 0 * * *');
  const [schedUrl, setSchedUrl] = useState('https://news.ycombinator.com');
  const [schedMaxPages, setSchedMaxPages] = useState(50);

  // Web Monitor Watchdog state
  const [monitors, setMonitors] = useState([]);
  const [monUrl, setMonUrl] = useState('https://news.ycombinator.com');
  const [monName, setMonName] = useState('HackerNews Frontpage Monitor');
  const [monCron, setMonCron] = useState('*/30 * * * *');
  const [monWebhook, setMonWebhook] = useState('');
  const [monSelector, setMonSelector] = useState('');
  const [isCheckingMonitor, setIsCheckingMonitor] = useState({});
  const [monitorCheckResults, setMonitorCheckResults] = useState({});

  const loadAll = async () => {
    try {
      const [p, d, s, k, m] = await Promise.all([
        request('/api/proxies').catch(() => []),
        request('/api/destinations').catch(() => []),
        request('/api/schedule').catch(() => []),
        request('/api/keys').catch(() => []),
        request('/api/monitors').catch(() => []),
      ]);
      setProxies(p);
      setDestinations(d);
      setSchedules(s);
      setApiKeys(k);
      setMonitors(m || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // API Key Handlers
  const handleCreateApiKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    try {
      const res = await request('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: keyName.trim(), rate_limit: Number(keyRateLimit) }),
      });
      addToast({
        type: 'success',
        title: 'API Key Generated',
        message: `Key: ${res.key.slice(0, 16)}... created.`,
      });
      setKeyName('');
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to create API Key', message: err.message });
    }
  };

  const handleDeleteApiKey = async (key) => {
    try {
      await request(`/api/keys/${key}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'API Key revoked' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleCopyKey = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    addToast({ type: 'success', message: 'API key copied to clipboard' });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Webhook Test Handler
  const handleTestWebhook = async (e) => {
    e.preventDefault();
    if (!webhookTestUrl.trim()) return;
    setIsTestingWebhook(true);
    setWebhookTestResult(null);

    try {
      const res = await request('/api/webhooks/test', {
        method: 'POST',
        body: JSON.stringify({
          target_url: webhookTestUrl.trim(),
          secret: webhookSecret.trim() || null,
        }),
      });
      setWebhookTestResult(res);
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Webhook Delivery Verified',
          message: `Status HTTP ${res.status_code} (${res.latency_ms} ms)`,
        });
      } else {
        addToast({
          type: 'warning',
          title: 'Webhook Target Non-200',
          message: `Endpoint returned: ${res.status_code || res.error}`,
        });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Webhook Test Error', message: err.message });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  // Proxy Handlers
  const handleAddProxy = async (e) => {
    e.preventDefault();
    if (!proxyInput.trim()) return;
    try {
      await request('/api/proxies', {
        method: 'POST',
        body: JSON.stringify({ url: proxyInput.trim() }),
      });
      addToast({ type: 'success', message: 'Proxy added to rotation pool' });
      setProxyInput('');
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add proxy', message: err.message });
    }
  };

  const handleDeleteProxy = async (id) => {
    try {
      await request(`/api/proxies/${id}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'Proxy deleted' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  // Destination Handlers
  const handleAddDestination = async (e) => {
    e.preventDefault();
    if (!destName.trim()) return;
    try {
      const parsedConfig = JSON.parse(destConfig);
      await request('/api/destinations', {
        method: 'POST',
        body: JSON.stringify({
          name: destName.trim(),
          type: destType,
          config: parsedConfig,
        }),
      });
      addToast({ type: 'success', message: 'Vector DB destination configured' });
      setDestName('');
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add destination', message: err.message });
    }
  };

  const handleDeleteDestination = async (id) => {
    try {
      await request(`/api/destinations/${id}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'Destination deleted' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  // Schedule Handlers
  const handleAddSchedule = async (e) => {
    e.preventDefault();
    try {
      await request('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({
          cron_expression: cronExpr.trim(),
          payload: {
            url: schedUrl.trim(),
            seed_url: schedUrl.trim(),
            max_pages: Number(schedMaxPages),
          },
        }),
      });
      addToast({ type: 'success', message: 'Scheduled crawl created' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Schedule Failed', message: err.message });
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await request(`/api/schedule/${id}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'Schedule deleted' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  // Web Monitor Handlers
  const handleCreateMonitor = async (e) => {
    e.preventDefault();
    if (!monUrl.trim()) return;
    try {
      await request('/api/monitors', {
        method: 'POST',
        body: JSON.stringify({
          url: monUrl.trim(),
          name: monName.trim(),
          cron_expression: monCron.trim(),
          webhook_url: monWebhook.trim() || null,
          css_selector: monSelector.trim() || null,
        }),
      });
      addToast({ type: 'success', title: 'Monitor Created', message: `Watchdog tracking ${monUrl}` });
      setMonUrl('');
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to create monitor', message: err.message });
    }
  };

  const handleDeleteMonitor = async (id) => {
    try {
      await request(`/api/monitors/${id}`, { method: 'DELETE' });
      addToast({ type: 'success', message: 'Web monitor deleted' });
      loadAll();
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleCheckMonitor = async (id) => {
    setIsCheckingMonitor((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await request(`/api/monitors/${id}/check`, { method: 'POST' });
      setMonitorCheckResults((prev) => ({ ...prev, [id]: res }));
      if (res.has_changed) {
        addToast({
          type: 'warning',
          title: 'Semantic Change Detected!',
          message: `Diff: +${res.diff?.additions_count || 0} / -${res.diff?.deletions_count || 0} lines changed.`,
        });
      } else {
        addToast({
          type: 'success',
          title: 'Content Verified Identical',
          message: 'No changes detected since last snapshot.',
        });
      }
      loadAll();
    } catch (err) {
      addToast({ type: 'error', title: 'Check Failed', message: err.message });
    } finally {
      setIsCheckingMonitor((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-espresso-50/50 dark:bg-black/60 p-8 overflow-y-auto max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold text-espresso-900 dark:text-white mb-1">
            <Server className="w-6 h-6 text-caramel-500" />
            <span>Developer Console & Infrastructure Hub</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Manage tenant API keys, web monitors & change watchdog, webhook testbench with HMAC SHA-256 verification, residential proxies, and vector destinations.
          </p>
        </div>

        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-espresso-900 border border-caramel-500/20 hover:border-caramel-500/40 text-xs font-semibold text-espresso-700 dark:text-espresso-300 transition"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>Refresh All</span>
        </button>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white dark:bg-espresso-900 border border-caramel-500/15 w-fit text-xs font-semibold shadow-sm">
        <button
          onClick={() => setActiveSubTab('keys')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'keys'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Tenant API Keys ({apiKeys.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('monitors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'monitors'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Web Monitors & Diff ({monitors.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('webhooks')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'webhooks'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Webhook Testbench</span>
        </button>

        <button
          onClick={() => setActiveSubTab('proxies')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'proxies'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Proxy Pool ({proxies.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('destinations')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'destinations'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Vector Destinations ({destinations.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('schedules')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            activeSubTab === 'schedules'
              ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20 font-bold'
              : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Cron Schedules ({schedules.length})</span>
        </button>
      </div>

      {/* API Keys Tab */}
      {activeSubTab === 'keys' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 h-fit shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-caramel-500" />
              <span>Generate New API Key</span>
            </h3>
            <form onSubmit={handleCreateApiKey} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Key Label / Project Name
                </label>
                <input
                  type="text"
                  required
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Production Scraper Agent"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Rate Limit (Requests / Min)
                </label>
                <input
                  type="number"
                  min="10"
                  max="10000"
                  value={keyRateLimit}
                  onChange={(e) => setKeyRateLimit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition"
              >
                Generate Tenant API Key
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Active Tenant API Keys
            </h3>
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/40 text-espresso-400 dark:text-espresso-600 text-xs shadow-sm">
                No custom tenant keys generated yet.
              </div>
            ) : (
              <div className="space-y-2">
                {apiKeys.map((k) => (
                  <div
                    key={k.key}
                    className="p-4 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 flex items-center justify-between shadow-sm"
                  >
                    <div className="space-y-1 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-espresso-900 dark:text-white font-sans">{k.name}</span>
                        <span className="px-2 py-0.5 rounded bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 font-bold text-[10px]">
                          {k.rate_limit} req/min
                        </span>
                      </div>
                      <div className="text-caramel-600 dark:text-caramel-400 font-bold flex items-center gap-2">
                        <span>{k.key}</span>
                        <button
                          onClick={() => handleCopyKey(k.key)}
                          className="p-1 rounded text-espresso-400 hover:text-caramel-500 transition"
                          title="Copy API Key"
                        >
                          {copiedKey === k.key ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteApiKey(k.key)}
                      className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                      title="Revoke API Key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Web Monitors & Diff Watchdog Tab */}
      {activeSubTab === 'monitors' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 h-fit shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-caramel-500" />
              <span>Create Web Monitor</span>
            </h3>
            <form onSubmit={handleCreateMonitor} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Monitor Name
                </label>
                <input
                  type="text"
                  required
                  value={monName}
                  onChange={(e) => setMonName(e.target.value)}
                  placeholder="e.g. Pricing Page Watchdog"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Target URL
                </label>
                <input
                  type="url"
                  required
                  value={monUrl}
                  onChange={(e) => setMonUrl(e.target.value)}
                  placeholder="https://example.com/pricing"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Cron Expression (Interval)
                </label>
                <input
                  type="text"
                  required
                  value={monCron}
                  onChange={(e) => setMonCron(e.target.value)}
                  placeholder="*/30 * * * * (Every 30 minutes)"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  CSS Selector (Optional Scope)
                </label>
                <input
                  type="text"
                  value={monSelector}
                  onChange={(e) => setMonSelector(e.target.value)}
                  placeholder="e.g. main, .pricing-table, article"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Alert Webhook URL (Optional)
                </label>
                <input
                  type="url"
                  value={monWebhook}
                  onChange={(e) => setMonWebhook(e.target.value)}
                  placeholder="https://api.yourcompany.com/alerts"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition"
              >
                Start Tracking Webpage
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-4">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Active Watchdog Monitors ({monitors.length})
            </h3>
            {monitors.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/40 text-espresso-400 dark:text-espresso-600 text-xs shadow-sm">
                No active web monitors configured. Create one on the left to start tracking content drift.
              </div>
            ) : (
              <div className="space-y-3">
                {monitors.map((m) => {
                  const checkResult = monitorCheckResults[m.id];
                  const checking = isCheckingMonitor[m.id];
                  return (
                    <div
                      key={m.id}
                      className="p-5 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 space-y-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-espresso-900 dark:text-white text-xs">{m.name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 font-mono">
                              {m.cron_expression}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 uppercase">
                              {m.status}
                            </span>
                          </div>
                          <p className="text-xs text-hazelnut-600 dark:text-hazelnut-400 font-mono break-all">{m.url}</p>
                          <div className="flex items-center gap-4 text-[11px] text-espresso-500">
                            <span>Checks: <b>{m.total_checks}</b></span>
                            <span>Changes Detected: <b>{m.change_count}</b></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCheckMonitor(m.id)}
                            disabled={checking}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/15 hover:bg-caramel-500/25 text-caramel-700 dark:text-caramel-300 text-xs font-bold transition disabled:opacity-50"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                            <span>{checking ? 'Checking...' : 'Check Now'}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteMonitor(m.id)}
                            className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {checkResult && (
                        <div className="p-3.5 rounded-xl bg-espresso-50 dark:bg-black/60 border border-caramel-500/15 text-xs font-mono space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className={checkResult.has_changed ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
                              {checkResult.has_changed ? '⚠️ Content Changed' : '✅ Content Identical'}
                            </span>
                            <span className="text-espresso-400">
                              +{checkResult.diff?.additions_count || 0} / -{checkResult.diff?.deletions_count || 0} lines
                            </span>
                          </div>
                          {checkResult.diff?.diff_text && (
                            <pre className="text-[10px] text-espresso-700 dark:text-espresso-300 max-h-32 overflow-y-auto p-2 rounded bg-white dark:bg-espresso-950">
                              {checkResult.diff.diff_text}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Webhook Testbench Tab */}
      {activeSubTab === 'webhooks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-caramel-500" />
              <span>Simulate Webhook Dispatcher</span>
            </h3>
            <form onSubmit={handleTestWebhook} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Target Receiver URL
                </label>
                <input
                  type="url"
                  required
                  value={webhookTestUrl}
                  onChange={(e) => setWebhookTestUrl(e.target.value)}
                  placeholder="https://your-api.com/webhooks/crawlix"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  HMAC SHA-256 Shared Secret
                </label>
                <input
                  type="text"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Enter secret used to sign headers"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={isTestingWebhook}
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition flex items-center justify-center gap-2"
              >
                {isTestingWebhook ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Transmitting Signed Payload...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Test Webhook Payload</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white">Delivery Inspector & HMAC Signatures</h3>
            {webhookTestResult ? (
              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5">
                  <span className="text-espresso-500">Receiver Response:</span>
                  <span className={`px-2 py-0.5 rounded font-bold ${webhookTestResult.success ? 'bg-emerald-500/20 text-emerald-600' : 'bg-rose-500/20 text-rose-600'}`}>
                    HTTP {webhookTestResult.status_code || 'Error'} ({webhookTestResult.latency_ms} ms)
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5 space-y-1">
                  <div className="text-espresso-500 text-[10px] uppercase font-bold">X-Crawlix-Signature Header:</div>
                  <div className="text-caramel-600 dark:text-caramel-400 break-all">{webhookTestResult.signature_header}</div>
                </div>

                {webhookTestResult.response_body && (
                  <div className="p-3 rounded-xl bg-espresso-50 dark:bg-black/50 border border-black/5 dark:border-white/5 space-y-1">
                    <div className="text-espresso-500 text-[10px] uppercase font-bold">Response Body:</div>
                    <div className="text-espresso-800 dark:text-espresso-200">{webhookTestResult.response_body}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center rounded-2xl bg-espresso-50 dark:bg-black/40 text-espresso-400 text-xs">
                Send a test webhook to verify HMAC signatures and endpoint connectivity.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Proxies Tab */}
      {activeSubTab === 'proxies' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 h-fit shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-caramel-500" />
              <span>Add Residential / Datacenter Proxy</span>
            </h3>
            <form onSubmit={handleAddProxy} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Proxy URI
                </label>
                <input
                  type="text"
                  required
                  value={proxyInput}
                  onChange={(e) => setProxyInput(e.target.value)}
                  placeholder="http://user:pass@gate.proxy.com:8080"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition"
              >
                Add to Rotation Pool
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Active Proxy Rotation Nodes
            </h3>
            {proxies.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/40 text-espresso-400 dark:text-espresso-600 text-xs shadow-sm">
                No custom proxies configured. System defaults to direct egress.
              </div>
            ) : (
              <div className="space-y-2">
                {proxies.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="font-mono text-xs text-espresso-900 dark:text-white font-bold">{p.url}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteProxy(p.id)}
                      className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Destinations Tab */}
      {activeSubTab === 'destinations' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 h-fit shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-caramel-500" />
              <span>Connect Vector Database</span>
            </h3>
            <form onSubmit={handleAddDestination} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Destination Name
                </label>
                <input
                  type="text"
                  required
                  value={destName}
                  onChange={(e) => setDestName(e.target.value)}
                  placeholder="e.g. pinecone-prod"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Vector Engine
                </label>
                <select
                  value={destType}
                  onChange={(e) => setDestType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                >
                  <option value="pinecone">Pinecone</option>
                  <option value="weaviate">Weaviate Cloud</option>
                  <option value="supabase">Supabase (pgvector)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Configuration JSON
                </label>
                <textarea
                  rows={4}
                  required
                  value={destConfig}
                  onChange={(e) => setDestConfig(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl glass-input font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition"
              >
                Save Vector Destination
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Connected Storage Endpoints
            </h3>
            {destinations.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/40 text-espresso-400 dark:text-espresso-600 text-xs shadow-sm">
                No vector destinations connected yet.
              </div>
            ) : (
              <div className="space-y-2">
                {destinations.map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 flex items-center justify-between shadow-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-espresso-900 dark:text-white text-xs">{d.name}</span>
                        <span className="px-2 py-0.5 rounded uppercase text-[10px] font-bold bg-hazelnut-400/20 text-hazelnut-700 dark:text-hazelnut-300 border border-hazelnut-400/30">
                          {d.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-espresso-500 font-mono mt-1">ID: {d.id}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteDestination(d.id)}
                      className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedules Tab */}
      {activeSubTab === 'schedules' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 h-fit shadow-sm">
            <h3 className="text-sm font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-caramel-500" />
              <span>Create Scheduled Spider</span>
            </h3>
            <form onSubmit={handleAddSchedule} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Target Seed URL
                </label>
                <input
                  type="url"
                  required
                  value={schedUrl}
                  onChange={(e) => setSchedUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Cron Expression
                </label>
                <input
                  type="text"
                  required
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="0 0 * * * (Daily at midnight)"
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-espresso-600 dark:text-espresso-400 uppercase">
                  Max Pages per Crawl
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={schedMaxPages}
                  onChange={(e) => setSchedMaxPages(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-gradient-caramel text-white font-bold text-xs shadow-lg shadow-caramel-500/25 transition"
              >
                Schedule Recurring Crawl
              </button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Active Cron Schedules
            </h3>
            {schedules.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/40 text-espresso-400 dark:text-espresso-600 text-xs shadow-sm">
                No recurring crawl schedules configured.
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 rounded-2xl bg-white dark:bg-espresso-900/60 border border-caramel-500/15 flex items-center justify-between shadow-sm"
                  >
                    <div className="space-y-1 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 font-bold">
                          {s.cron_expression}
                        </span>
                        <span className="text-espresso-900 dark:text-white font-semibold">{s.payload?.url || s.payload?.seed_url}</span>
                      </div>
                      <div className="text-[11px] text-espresso-500">ID: {s.id}</div>
                    </div>
                    <button
                      onClick={() => handleDeleteSchedule(s.id)}
                      className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
