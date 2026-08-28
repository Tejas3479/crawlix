import React, { useState, useMemo } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import { CodeBlock } from '../common/CodeBlock';
import {
  Coffee,
  Play,
  Sparkles,
  Layers,
  Clock,
  Camera,
  Code,
  FileText,
  Sliders,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  History,
  RotateCcw,
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
  Download,
  Image as ImageIcon,
  Copy,
  Terminal,
} from 'lucide-react';

export function PlaygroundView() {
  const { request } = useApi();
  const addFetchHistory = useCrawlStore((state) => state.addFetchHistory);
  const fetchHistory = useCrawlStore((state) => state.fetchHistory);
  const addToast = useCrawlStore((state) => state.addToast);
  const addLog = useCrawlStore((state) => state.addLog);

  // Form State
  const [url, setUrl] = useState('https://news.ycombinator.com');
  const [method, setMethod] = useState('GET');
  const [outputFormat, setOutputFormat] = useState('markdown');
  const [renderJs, setRenderJs] = useState(false);
  const [impersonate, setImpersonate] = useState('chrome120');
  const [stealth, setStealth] = useState(true);
  const [scroll, setScroll] = useState(false);
  const [stripLinks, setStripLinks] = useState(false);
  const [compressTokens, setCompressTokens] = useState(false);
  const [autoDismissBanners, setAutoDismissBanners] = useState(true);
  const [bypassCache, setBypassCache] = useState(false);
  const [timeout, setTimeoutSec] = useState(30);
  const [maxRetries, setMaxRetries] = useState(1);
  const [proxyUrl, setProxyUrl] = useState('');
  const [sessionId, setSessionId] = useState('');

  // Structured / LLM / VLM options
  const [llmProvider, setLlmProvider] = useState('openai');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [extractionPrompt, setExtractionPrompt] = useState('');
  const [jsonSchema, setJsonSchema] = useState('');
  const [isGeneratingSchema, setIsGeneratingSchema] = useState(false);

  // Quick Action Adder
  const handleAddAction = (type) => {
    const newAction = { type, selector: '', value: '', duration: 1 };
    setActions([...actions, newAction]);
  };

  const handleAutoGenerateSchema = async () => {
    if (!url.trim()) {
      addToast({ type: 'warning', message: 'Please enter a target URL first' });
      return;
    }
    setIsGeneratingSchema(true);
    try {
      const res = await request('/api/schema/generate', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          render_js: renderJs,
          llm_provider: llmProvider,
          llm_api_key: llmApiKey.trim() || null,
          extraction_goal: extractionPrompt.trim() || null,
        }),
      });
      if (res.schema_definition) {
        setJsonSchema(JSON.stringify(res.schema_definition, null, 2));
        addToast({
          type: 'success',
          title: 'Schema Inferred by AI',
          message: `Discovered ${res.suggested_fields?.length || 0} fields automatically in ${res.latency_ms} ms.`,
        });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Schema Generation Failed', message: err.message });
    } finally {
      setIsGeneratingSchema(false);
    }
  };

  const handleUpdateAction = (index, field, val) => {
    const updated = [...actions];
    updated[index][field] = val;
    setActions(updated);
  };

  const handleRemoveAction = (index) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  // Execution
  const handleFetch = async (e) => {
    if (e) e.preventDefault();
    if (!url.trim()) {
      addToast({ type: 'warning', message: 'Please provide a target URL' });
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    let parsedSchema = null;
    if (jsonSchema.trim()) {
      try {
        parsedSchema = JSON.parse(jsonSchema);
      } catch (err) {
        addToast({ type: 'error', title: 'Invalid JSON Schema', message: 'Please ensure valid JSON format.' });
        setIsLoading(false);
        return;
      }
    }

    const cleanedActions = actions.length > 0
      ? actions.map((a) => ({
          type: a.type,
          selector: a.selector?.trim() || null,
          value: a.value?.trim() || null,
          duration: a.type === 'wait' ? (Number(a.duration) || 1) : null,
        }))
      : null;

    const payload = {
      url: url.trim(),
      method,
      output_format: outputFormat,
      render_js: outputFormat === 'vlm' ? true : renderJs,
      impersonate,
      stealth,
      scroll,
      strip_links: stripLinks,
      compress_tokens: compressTokens,
      auto_dismiss_banners: autoDismissBanners,
      bypass_cache: bypassCache,
      timeout: Number(timeout),
      max_retries: Number(maxRetries),
      proxy: proxyUrl.trim() ? { url: proxyUrl.trim() } : null,
      session_id: sessionId.trim() || null,
      screenshot: outputFormat === 'screenshot' || outputFormat === 'vlm',
      llm_provider: llmProvider,
      llm_model: llmModel.trim() || null,
      llm_api_key: llmApiKey.trim() || null,
      extraction_prompt: extractionPrompt.trim() || null,
      json_schema: parsedSchema,
      actions: cleanedActions,
    };

    try {
      addLog({ type: 'info', message: `Executing fetch: ${method} ${url} (${outputFormat})` });
      const res = await request('/fetch', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setResult(res);
      addFetchHistory({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        url,
        method,
        output_format: outputFormat,
        status_code: res.status_code,
        latency_ms: res.latency_ms,
        success: res.success,
        payload,
        result: res,
      });

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Scrape Resolved',
          message: `Completed in ${res.latency_ms}ms (Status: ${res.status_code})`,
        });
        if (outputFormat === 'vlm' || outputFormat === 'structured') {
          setActiveResultTab('json');
        } else if (outputFormat === 'screenshot') {
          setActiveResultTab('screenshot');
        } else {
          setActiveResultTab('content');
        }
      } else {
        setError(res.error_message || res.error || 'Fetch operation reported failure.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Dynamic Multi-Language Code Snippets Generator
  const generatedCode = useMemo(() => {
    const payloadObj = {
      url,
      method,
      output_format: outputFormat,
      render_js: outputFormat === 'vlm' ? true : renderJs,
      impersonate,
      stealth,
      scroll,
      ...(actions.length > 0 ? { actions } : {}),
      ...(extractionPrompt ? { extraction_prompt: extractionPrompt } : {}),
    };

    if (codeLanguage === 'python') {
      return `from crawlix import CrawlixClient

client = CrawlixClient(api_key="your_api_key")

response = client.fetch(
    url="${url}",
    method="${method}",
    output_format="${outputFormat}",
    render_js=${outputFormat === 'vlm' || renderJs ? 'True' : 'False'},
    stealth=${stealth ? 'True' : 'False'},
    impersonate="${impersonate}",
    ${actions.length > 0 ? `actions=${JSON.stringify(actions, null, 4)},\n    ` : ''}${extractionPrompt ? `extraction_prompt="${extractionPrompt}",\n    ` : ''}
)

print("Status:", response.status_code)
print("Content:", response.content)
`;
    }

    if (codeLanguage === 'typescript') {
      return `import { Crawlix } from 'crawlix-sdk';

const client = new Crawlix({ apiKey: process.env.CRAWLIX_API_KEY });

async function main() {
  const result = await client.fetch({
    url: '${url}',
    method: '${method}',
    outputFormat: '${outputFormat}',
    renderJs: ${outputFormat === 'vlm' || renderJs},
    stealth: ${stealth},
    impersonate: '${impersonate}',
    ${actions.length > 0 ? `actions: ${JSON.stringify(actions, null, 2)},\n    ` : ''}${extractionPrompt ? `extractionPrompt: '${extractionPrompt}',\n    ` : ''}
  });

  console.log('Status:', result.statusCode);
  console.log('Data:', result.content);
}

main();
`;
    }

    if (codeLanguage === 'curl') {
      return `curl -X POST "http://localhost:8000/fetch" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: your_api_key" \\
  -d '${JSON.stringify(payloadObj, null, 2)}'
`;
    }

    if (codeLanguage === 'go') {
      return `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

func main() {
	payload, _ := json.Marshal(map[string]interface{}{
		"url":           "${url}",
		"method":        "${method}",
		"output_format": "${outputFormat}",
		"render_js":     ${outputFormat === 'vlm' || renderJs},
		"stealth":       ${stealth},
	})

	req, _ := http.NewRequest("POST", "http://localhost:8000/fetch", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", "your_api_key")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	fmt.Println("Response Status:", resp.Status)
}
`;
    }

    return '';
  }, [url, method, outputFormat, renderJs, impersonate, stealth, scroll, actions, extractionPrompt, codeLanguage]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Configuration Panel */}
      <div className="w-[500px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-espresso-900 dark:text-white flex items-center gap-2">
              <Coffee className="w-4 h-4 text-caramel-500 fill-caramel-500" />
              Scraper & VLM Playground
            </h2>
            <button
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-espresso-100 dark:bg-espresso-900 border border-caramel-500/20 text-xs text-espresso-700 dark:text-espresso-300 hover:border-caramel-500/40 transition"
            >
              <History className="w-3.5 h-3.5 text-caramel-500" />
              <span>History ({fetchHistory.length})</span>
            </button>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Real-time scraping with TLS fingerprint spoofing, CDP stealth masking, and Vision-Language multi-modal AI.
          </p>
        </div>

        <form onSubmit={handleFetch} className="space-y-4">
          {/* Target URL & Method */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Target URL
            </label>
            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-24 px-2.5 py-2 rounded-xl glass-input text-xs font-mono font-bold text-caramel-600 dark:text-caramel-400"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
              />
            </div>
          </div>

          {/* Extraction Mode / Output Format */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Output Format
              </label>
              {outputFormat === 'vlm' && (
                <span className="text-[10px] text-caramel-500 font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> VLM Vision Model
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { id: 'markdown', label: 'Markdown', icon: FileText },
                { id: 'structured', label: 'Structured JSON', icon: Code },
                { id: 'vlm', label: 'Vision (VLM)', icon: Sparkles },
                { id: 'html', label: 'Raw HTML', icon: Code },
                { id: 'text', label: 'Plain Text', icon: FileText },
                { id: 'screenshot', label: 'Screenshot', icon: Camera },
              ].map((fmt) => (
                <button
                  type="button"
                  key={fmt.id}
                  onClick={() => {
                    setOutputFormat(fmt.id);
                    if (fmt.id === 'vlm') setRenderJs(true);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-left transition ${
                    outputFormat === fmt.id
                      ? fmt.id === 'vlm'
                        ? 'bg-gradient-to-r from-caramel-400/20 to-caramel-500/20 border-caramel-500/60 text-caramel-700 dark:text-caramel-300 font-bold shadow-lg shadow-caramel-500/15 glow-caramel-subtle'
                        : 'bg-caramel-500/20 border-caramel-500/60 text-caramel-700 dark:text-caramel-200 font-bold shadow-lg shadow-caramel-500/15 glow-caramel-subtle'
                      : 'bg-white dark:bg-espresso-900/60 border-espresso-200 dark:border-white/5 text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                  }`}
                >
                  <fmt.icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fmt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Engine & TLS Impersonation */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Execution Engine
              </label>
              <select
                value={renderJs ? 'playwright' : 'curl'}
                onChange={(e) => setRenderJs(e.target.value === 'playwright')}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs"
              >
                <option value="curl">⚡ curl_cffi (Fast TLS)</option>
                <option value="playwright">🌐 Playwright Chromium</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                TLS Fingerprint
              </label>
              <select
                value={impersonate}
                onChange={(e) => setImpersonate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-xs font-mono"
              >
                <option value="chrome120">Chrome 120</option>
                <option value="safari15_5">Safari 15.5</option>
                <option value="firefox120">Firefox 120</option>
                <option value="edge101">Edge 101</option>
                <option value="okhttp4">OkHttp 4 (Android)</option>
              </select>
            </div>
          </div>

          {/* Vision (VLM) & Structured AI Settings */}
          {(outputFormat === 'structured' || outputFormat === 'vlm') && (
            <div className="p-4 rounded-2xl border border-caramel-500/30 bg-caramel-500/5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-caramel-600 dark:text-caramel-300">
                <Sparkles className="w-4 h-4 text-caramel-500" />
                <span>{outputFormat === 'vlm' ? 'Vision-Language Model Configuration' : 'AI Schema Extraction'}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400 mb-1">
                    AI Provider
                  </label>
                  <select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg glass-input text-xs"
                  >
                    <option value="openai">OpenAI (GPT-5.6 Sol / Terra / Luna)</option>
                    <option value="anthropic">Anthropic (Claude Sonnet 5 / Opus 5 / Fable 5)</option>
                    <option value="gemini">Google Gemini (Gemini 3.6 Flash / 3.1 Pro / 2.5 Flash)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400 mb-1">
                    Custom Model (Optional)
                  </label>
                  <input
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="e.g. gemini-3.6-flash, gpt-5.6-sol, claude-sonnet-5"
                    className="w-full px-2.5 py-1.5 rounded-lg glass-input text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400 mb-1">
                  Natural Language Extraction Prompt
                </label>
                <textarea
                  rows={2}
                  value={extractionPrompt}
                  onChange={(e) => setExtractionPrompt(e.target.value)}
                  placeholder="Extract all product titles, prices, ratings, and stock status."
                  className="w-full px-3 py-2 rounded-lg glass-input text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400">
                    JSON Schema (Strict Structure)
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoGenerateSchema}
                    disabled={isGeneratingSchema}
                    className="flex items-center gap-1 text-[10px] font-bold text-caramel-600 dark:text-caramel-400 hover:text-caramel-500 transition px-2 py-0.5 rounded bg-caramel-500/10 border border-caramel-500/20"
                  >
                    <Sparkles className="w-3 h-3 text-caramel-500" />
                    <span>{isGeneratingSchema ? 'Analyzing DOM...' : '✨ Auto-Generate Schema'}</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={jsonSchema}
                  onChange={(e) => setJsonSchema(e.target.value)}
                  placeholder='{"type": "object", "properties": {"title": {"type": "string"}, "price": {"type": "number"}}}'
                  className="w-full px-3 py-2 rounded-lg glass-input font-mono text-xs"
                />
              </div>
            </div>
          )}

          {/* Action Automation Builder */}
          <div className="p-4 rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-espresso-900 dark:text-espresso-200">
                <Sliders className="w-3.5 h-3.5 text-caramel-500" />
                <span>Pre-Scrape Actions ({actions.length})</span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handleAddAction('click')}
                  className="px-2 py-1 rounded bg-espresso-100 dark:bg-white/5 hover:bg-caramel-500/20 text-[11px] text-espresso-700 dark:text-espresso-300 hover:text-caramel-600 dark:hover:text-caramel-300 transition"
                >
                  + Click
                </button>
                <button
                  type="button"
                  onClick={() => handleAddAction('fill')}
                  className="px-2 py-1 rounded bg-espresso-100 dark:bg-white/5 hover:bg-caramel-500/20 text-[11px] text-espresso-700 dark:text-espresso-300 hover:text-caramel-600 dark:hover:text-caramel-300 transition"
                >
                  + Fill
                </button>
                <button
                  type="button"
                  onClick={() => handleAddAction('wait')}
                  className="px-2 py-1 rounded bg-espresso-100 dark:bg-white/5 hover:bg-caramel-500/20 text-[11px] text-espresso-700 dark:text-espresso-300 hover:text-caramel-600 dark:hover:text-caramel-300 transition"
                >
                  + Wait
                </button>
                <button
                  type="button"
                  onClick={() => handleAddAction('scroll')}
                  className="px-2 py-1 rounded bg-espresso-100 dark:bg-white/5 hover:bg-caramel-500/20 text-[11px] text-espresso-700 dark:text-espresso-300 hover:text-caramel-600 dark:hover:text-caramel-300 transition"
                >
                  + Scroll
                </button>
              </div>
            </div>

            {actions.length === 0 ? (
              <p className="text-[11px] text-espresso-500 italic">
                No automation steps. Page will be scraped immediately after load.
              </p>
            ) : (
              <div className="space-y-2">
                {actions.map((act, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 p-2 rounded-xl bg-espresso-50 dark:bg-black/60 border border-caramel-500/15 text-xs font-mono"
                  >
                    <span className="px-2 py-0.5 rounded bg-caramel-500/20 text-caramel-600 dark:text-caramel-400 font-bold uppercase text-[10px]">
                      {act.type}
                    </span>

                    {act.type === 'click' && (
                      <input
                        type="text"
                        placeholder="CSS Selector (e.g. #accept-cookies)"
                        value={act.selector}
                        onChange={(e) => handleUpdateAction(idx, 'selector', e.target.value)}
                        className="flex-1 px-2 py-1 rounded glass-input text-xs"
                      />
                    )}

                    {act.type === 'fill' && (
                      <>
                        <input
                          type="text"
                          placeholder="Selector (e.g. input.search)"
                          value={act.selector}
                          onChange={(e) => handleUpdateAction(idx, 'selector', e.target.value)}
                          className="w-1/2 px-2 py-1 rounded glass-input text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Text Value"
                          value={act.value}
                          onChange={(e) => handleUpdateAction(idx, 'value', e.target.value)}
                          className="w-1/2 px-2 py-1 rounded glass-input text-xs"
                        />
                      </>
                    )}

                    {act.type === 'wait' && (
                      <input
                        type="number"
                        min="1"
                        max="30"
                        placeholder="Seconds"
                        value={act.duration}
                        onChange={(e) => handleUpdateAction(idx, 'duration', Number(e.target.value))}
                        className="w-24 px-2 py-1 rounded glass-input text-xs"
                      />
                    )}

                    {act.type === 'scroll' && (
                      <input
                        type="text"
                        placeholder="Selector (or leave blank for bottom)"
                        value={act.selector}
                        onChange={(e) => handleUpdateAction(idx, 'selector', e.target.value)}
                        className="flex-1 px-2 py-1 rounded glass-input text-xs"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveAction(idx)}
                      className="p-1 rounded text-espresso-400 hover:text-rose-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced Toggles Accordion */}
          <div className="border border-caramel-500/15 rounded-2xl overflow-hidden bg-white dark:bg-espresso-900/40">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-espresso-700 dark:text-espresso-300 hover:text-caramel-500 transition"
            >
              <span>Advanced Options (Proxies, RAG Token Optimizer, Cookie Banners)</span>
              {isAdvancedOpen ? <ChevronUp className="w-4 h-4 text-caramel-500" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isAdvancedOpen && (
              <div className="p-4 space-y-3 bg-espresso-50 dark:bg-black/40 border-t border-caramel-500/15 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stealth}
                      onChange={(e) => setStealth(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span>Stealth Masking</span>
                  </label>

                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={compressTokens}
                      onChange={(e) => setCompressTokens(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span className="font-bold text-caramel-600 dark:text-caramel-400">RAG Token Optimizer (Save 50%+)</span>
                  </label>

                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDismissBanners}
                      onChange={(e) => setAutoDismissBanners(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span>Auto-Dismiss Cookies</span>
                  </label>

                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scroll}
                      onChange={(e) => setScroll(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span>Auto-Scroll Page</span>
                  </label>

                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stripLinks}
                      onChange={(e) => setStripLinks(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span>Strip Links</span>
                  </label>

                  <label className="flex items-center gap-2 text-espresso-700 dark:text-espresso-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bypassCache}
                      onChange={(e) => setBypassCache(e.target.checked)}
                      className="rounded bg-black/50 border-caramel-500/20 text-caramel-500 focus:ring-caramel-400"
                    />
                    <span>Bypass Cache</span>
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400">
                    Custom Proxy URL
                  </label>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="http://user:pass@proxy.example.com:8080"
                    className="w-full px-3 py-1.5 rounded-lg glass-input font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400">
                      Session ID (Redis)
                    </label>
                    <input
                      type="text"
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      placeholder="e.g. browser-session-1"
                      className="w-full px-3 py-1.5 rounded-lg glass-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-espresso-600 dark:text-espresso-400">
                      Timeout (Seconds)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="120"
                      value={timeout}
                      onChange={(e) => setTimeoutSec(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg glass-input text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-caramel-500/30 glow-caramel transition disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Extracting Target Page...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Execute Scrape Request</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Right: Results & Live Code Generator */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {/* Result Toolbar */}
        <div className="h-14 border-b border-caramel-500/15 px-6 flex items-center justify-between bg-white/40 dark:bg-espresso-900/40">
          <div className="flex items-center gap-3">
            <div className="flex gap-1 p-1 rounded-xl bg-espresso-100 dark:bg-espresso-900 border border-caramel-500/20 text-xs font-semibold">
              <button
                onClick={() => setActiveResultTab('content')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeResultTab === 'content'
                    ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                Extracted Content
              </button>
              <button
                onClick={() => setActiveResultTab('json')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeResultTab === 'json'
                    ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                JSON Payload
              </button>
              <button
                onClick={() => setActiveResultTab('screenshot')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeResultTab === 'screenshot'
                    ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                Screenshot
              </button>
              <button
                onClick={() => setActiveResultTab('code')}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  activeResultTab === 'code'
                    ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                <Code className="w-3.5 h-3.5" /> Live Code
              </button>
              <button
                onClick={() => setActiveResultTab('timing')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeResultTab === 'timing'
                    ? 'bg-caramel-500 text-white shadow-lg shadow-caramel-500/20'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                Telemetry
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          {result && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span
                className={`px-2.5 py-1 rounded-lg border font-bold ${
                  result.status_code >= 200 && result.status_code < 300
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/30'
                }`}
              >
                HTTP {result.status_code}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-espresso-900 border border-caramel-500/20 text-espresso-700 dark:text-espresso-200">
                {result.latency_ms} ms
              </span>
              {result.cache_hit && (
                <span className="px-2 py-0.5 rounded bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/30 text-[10px] uppercase font-bold">
                  Cache Hit
                </span>
              )}
            </div>
          )}
        </div>

        {/* Result Body */}
        <div className="flex-1 p-6 overflow-y-auto">
          {error && (
            <div className="p-4 rounded-2xl border border-rose-500/40 bg-rose-950/20 text-rose-600 dark:text-rose-300 text-sm flex items-start gap-3 mb-4 animate-slide-up">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-rose-700 dark:text-rose-200">Scrape Error</h4>
                <p className="opacity-90 font-mono text-xs mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Live Code Tab */}
          {activeResultTab === 'code' && (
            <div className="space-y-4 max-w-4xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-espresso-900 dark:text-white">Live Client Code Generator</h3>
                  <p className="text-xs text-espresso-600 dark:text-espresso-400">Copy pre-configured code directly into your codebase.</p>
                </div>
                <div className="flex gap-1.5 p-1 rounded-xl bg-espresso-100 dark:bg-espresso-900 border border-caramel-500/20 text-xs font-mono">
                  {['python', 'typescript', 'curl', 'go'].map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setCodeLanguage(lang)}
                      className={`px-3 py-1 rounded-lg uppercase text-[11px] font-bold transition ${
                        codeLanguage === lang
                          ? 'bg-caramel-500 text-white shadow-sm'
                          : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
              <CodeBlock code={generatedCode} language={codeLanguage} title={`Crawlix ${codeLanguage.toUpperCase()} Snippet`} />
            </div>
          )}

          {/* Extracted Content Tab */}
          {activeResultTab === 'content' && (
            <div className="h-full flex flex-col">
              {!result && !isLoading && !error && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
                  <Coffee className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
                  <h3 className="text-base font-medium text-espresso-800 dark:text-espresso-200">No Scrape Results Yet</h3>
                  <p className="text-xs max-w-sm mt-1">
                    Enter a target URL and hit execute. Crawlix will bypass anti-bot shields and extract data cleanly.
                  </p>
                </div>
              )}

              {isLoading && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-espresso-600 dark:text-espresso-400">
                  <div className="w-8 h-8 border-2 border-caramel-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs font-mono">Executing scraper pipeline & model inference...</p>
                </div>
              )}

              {result && (
                typeof result.content === 'object' ? (
                  <JsonViewer data={result.content} />
                ) : (
                  <div className="h-full bg-white dark:bg-espresso-900/80 rounded-2xl border border-caramel-500/15 p-5 font-mono text-xs overflow-auto select-text text-espresso-900 dark:text-espresso-100 leading-relaxed shadow-sm">
                    <pre className="whitespace-pre-wrap">{result.content || '(Empty response)'}</pre>
                  </div>
                )
              )}
            </div>
          )}

          {/* JSON Payload Tab */}
          {activeResultTab === 'json' && result && (
            <div className="h-full">
              <JsonViewer data={result} />
            </div>
          )}

          {/* Screenshot Tab */}
          {activeResultTab === 'screenshot' && (
            <div className="h-full flex flex-col items-center justify-center bg-espresso-100/50 dark:bg-black/40 rounded-2xl border border-caramel-500/15 p-6 overflow-auto">
              {result?.screenshot ? (
                <div className="space-y-4 max-w-4xl text-center">
                  <img
                    src={result.screenshot}
                    alt="Page Screenshot"
                    className="rounded-2xl border border-caramel-500/20 shadow-2xl max-h-[600px] object-contain mx-auto"
                  />
                  <a
                    href={result.screenshot}
                    download={`crawlix-screenshot-${Date.now()}.png`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-caramel hover:opacity-90 text-white text-xs font-bold transition shadow-lg shadow-caramel-500/25"
                  >
                    <Download className="w-4 h-4" /> Download High-Res Screenshot
                  </a>
                </div>
              ) : (
                <div className="text-center text-espresso-400 dark:text-espresso-600 text-xs">
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No screenshot captured. Select "Vision (VLM)" or "Screenshot" output format.</p>
                </div>
              )}
            </div>
          )}

          {/* Telemetry Tab */}
          {activeResultTab === 'timing' && result && (
            <div className="space-y-5 max-w-2xl">
              <h3 className="text-sm font-bold text-espresso-900 dark:text-white">Network & Extraction Telemetry</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-white dark:bg-espresso-900 border border-caramel-500/15 shadow-sm">
                  <span className="text-[11px] text-espresso-500 uppercase font-bold">Total Latency</span>
                  <p className="text-3xl font-black font-mono text-caramel-600 dark:text-caramel-400 mt-1">{result.latency_ms} ms</p>
                </div>
                <div className="p-5 rounded-2xl bg-white dark:bg-espresso-900 border border-caramel-500/15 shadow-sm">
                  <span className="text-[11px] text-espresso-500 uppercase font-bold">Retries Used</span>
                  <p className="text-3xl font-black font-mono text-caramel-500 mt-1">{result.retries_used ?? 0}</p>
                </div>
              </div>

              {result.timing && (
                <div className="p-5 rounded-2xl bg-white dark:bg-espresso-900 border border-caramel-500/15 space-y-2 font-mono text-xs shadow-sm">
                  <div className="text-espresso-800 dark:text-espresso-200 font-bold mb-2">Network Phase Breakdown:</div>
                  {Object.entries(result.timing).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
                      <span className="text-espresso-500 capitalize">{k.replace('_', ' ')}</span>
                      <span className="text-espresso-900 dark:text-white font-bold">{v} ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
