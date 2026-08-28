import React, { useState, useRef } from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { useApi } from '../../hooks/useApi';
import { JsonViewer } from '../common/JsonViewer';
import {
  Eye,
  Play,
  Plus,
  Trash2,
  Code,
  Copy,
  Check,
  Sparkles,
  MousePointer,
  ExternalLink,
  Layers,
  ArrowRight,
  Coffee,
  CheckCircle2,
  RefreshCw,
  Sliders,
} from 'lucide-react';

export function InspectorView() {
  const { request } = useApi();
  const addToast = useCrawlStore((state) => state.addToast);

  const [targetUrl, setTargetUrl] = useState('https://news.ycombinator.com');
  const [baseSelector, setBaseSelector] = useState('.athing');
  const [fields, setFields] = useState([
    { name: 'title', selector: '.titleline > a', type: 'text', attribute: '' },
    { name: 'link', selector: '.titleline > a', type: 'attribute', attribute: 'href' },
    { name: 'rank', selector: '.rank', type: 'text', attribute: '' },
  ]);

  // Visual Picker State
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [sandboxHtml, setSandboxHtml] = useState(null);
  const [hoveredElementInfo, setHoveredElementInfo] = useState(null);
  const [selectedElementInfo, setSelectedElementInfo] = useState(null);
  const iframeRef = useRef(null);

  // Extraction State
  const [isLoading, setIsLoading] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Load Sandboxed Visual DOM
  const handleLoadVisualSandbox = async () => {
    if (!targetUrl.trim()) return;
    setIsSandboxLoading(true);
    try {
      const res = await request('/fetch', {
        method: 'POST',
        body: JSON.stringify({
          url: targetUrl.trim(),
          output_format: 'html',
          render_js: false,
        }),
      });

      if (res.raw_html) {
        // Inject interactive hover and click listeners into the HTML
        const injectedScript = `
          <style>
            .crawlix-inspect-hover {
              outline: 2px dashed #e28743 !important;
              outline-offset: 2px !important;
              background-color: rgba(226, 135, 67, 0.15) !important;
              cursor: crosshair !important;
            }
            .crawlix-inspect-selected {
              outline: 3px solid #e28743 !important;
              outline-offset: 2px !important;
              background-color: rgba(226, 135, 67, 0.3) !important;
            }
          </style>
          <script>
            let currentHovered = null;
            let currentSelected = null;

            function getCssSelector(el) {
              if (!el || el.nodeType !== 1) return '';
              if (el.id) return '#' + el.id;
              let path = [];
              while (el && el.nodeType === 1 && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
                let selector = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') {
                  const classes = el.className.trim().split(/\\s+/).filter(c => !c.startsWith('crawlix-'));
                  if (classes.length > 0) {
                    selector += '.' + classes.slice(0, 2).join('.');
                  }
                }
                path.unshift(selector);
                el = el.parentElement;
              }
              return path.join(' > ');
            }

            document.addEventListener('mouseover', (e) => {
              if (currentHovered) currentHovered.classList.remove('crawlix-inspect-hover');
              currentHovered = e.target;
              currentHovered.classList.add('crawlix-inspect-hover');
              const selector = getCssSelector(e.target);
              window.parent.postMessage({
                type: 'CRAWLIX_HOVER',
                tag: e.target.tagName.toLowerCase(),
                text: (e.target.innerText || '').slice(0, 100),
                selector: selector,
                classes: e.target.className || ''
              }, '*');
            });

            document.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (currentSelected) currentSelected.classList.remove('crawlix-inspect-selected');
              currentSelected = e.target;
              currentSelected.classList.add('crawlix-inspect-selected');
              const selector = getCssSelector(e.target);
              window.parent.postMessage({
                type: 'CRAWLIX_SELECT',
                tag: e.target.tagName.toLowerCase(),
                text: (e.target.innerText || '').slice(0, 100),
                selector: selector,
                attributes: Array.from(e.target.attributes).map(a => ({ name: a.name, value: a.value }))
              }, '*');
            }, true);
          </script>
        `;

        const modifiedHtml = res.raw_html.replace('</body>', `${injectedScript}</body>`);
        setSandboxHtml(modifiedHtml);
        addToast({ type: 'success', message: 'Visual DOM sandbox loaded. Hover & click elements!' });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Sandbox Load Failed', message: err.message });
    } finally {
      setIsSandboxLoading(false);
    }
  };

  // Listen to messages from the sandbox iframe
  React.useEffect(() => {
    const handleIframeMessage = (event) => {
      if (event.data?.type === 'CRAWLIX_HOVER') {
        setHoveredElementInfo(event.data);
      } else if (event.data?.type === 'CRAWLIX_SELECT') {
        setSelectedElementInfo(event.data);
        addToast({
          type: 'info',
          title: 'Element Selected',
          message: `Captured CSS Selector: ${event.data.selector}`,
        });
      }
    };

    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, []);

  const handleAddField = () => {
    setFields([...fields, { name: `field_${fields.length + 1}`, selector: '', type: 'text', attribute: '' }]);
  };

  const handleApplySelectedToField = (index) => {
    if (!selectedElementInfo) {
      addToast({ type: 'warning', message: 'Click an element in the visual preview first!' });
      return;
    }
    const updated = [...fields];
    updated[index].selector = selectedElementInfo.selector;
    setFields(updated);
    addToast({ type: 'success', message: `Applied selector to "${updated[index].name}"` });
  };

  const handleUpdateField = (index, key, val) => {
    const updated = [...fields];
    updated[index][key] = val;
    setFields(updated);
  };

  const handleRemoveField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const schemaObject = {
    name: 'custom_extraction',
    baseSelector: baseSelector.trim(),
    fields: fields.map((f) => ({
      name: f.name,
      selector: f.selector,
      type: f.type,
      ...(f.type === 'attribute' && f.attribute ? { attribute: f.attribute } : {}),
    })),
  };

  const handleTestExtraction = async (e) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;

    setIsLoading(true);
    setExtractedData(null);

    try {
      const res = await request('/fetch', {
        method: 'POST',
        body: JSON.stringify({
          url: targetUrl.trim(),
          output_format: 'structured',
          json_schema: schemaObject,
          render_js: false,
        }),
      });

      setExtractedData(res.content);
      addToast({
        type: 'success',
        title: 'Extraction Verified',
        message: `Extracted ${Array.isArray(res.content) ? res.content.length : 1} records in ${res.latency_ms} ms.`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Extraction Failed', message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const pythonSnippet = `from crawlix import CrawlixClient

client = CrawlixClient()

schema = ${JSON.stringify(schemaObject, null, 4)}

data = client.fetch(
    url="${targetUrl}",
    output_format="structured",
    json_schema=schema
)

print(data.content)`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pythonSnippet);
    setCopiedSnippet(true);
    addToast({ type: 'success', message: 'Python snippet copied' });
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Schema Builder Form & Field Mapping */}
      <div className="w-[500px] shrink-0 border-r border-caramel-500/15 bg-white/40 dark:bg-black/40 p-6 overflow-y-auto flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-espresso-900 dark:text-white mb-1">
            <Eye className="w-5 h-5 text-caramel-500" />
            <span>Visual Point & Click DOM Inspector</span>
          </div>
          <p className="text-xs text-espresso-600 dark:text-espresso-400">
            Hover and click elements in the interactive sandbox to auto-generate rock-solid CSS and XPath selectors.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
              Target Test URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com/items"
                className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleLoadVisualSandbox}
                disabled={isSandboxLoading}
                className="px-3 py-2 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 hover:bg-caramel-500/30 text-xs font-bold transition flex items-center gap-1.5 shrink-0"
              >
                {isSandboxLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <MousePointer className="w-3.5 h-3.5" />}
                <span>Load Live Picker</span>
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider flex items-center justify-between">
              <span>Repeated Item Base Selector</span>
              <span className="text-[10px] text-caramel-600 dark:text-caramel-400 font-mono">Row / Card Parent</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={baseSelector}
                onChange={(e) => setBaseSelector(e.target.value)}
                placeholder="e.g. .product-card or tr.row"
                className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
              />
              {selectedElementInfo && (
                <button
                  type="button"
                  onClick={() => setBaseSelector(selectedElementInfo.selector)}
                  className="px-2.5 py-1.5 rounded-xl bg-espresso-100 dark:bg-white/10 hover:bg-caramel-500/20 text-[11px] font-bold text-caramel-600 dark:text-caramel-300 transition"
                  title="Use selected element as Base Selector"
                >
                  Set Base
                </button>
              )}
            </div>
          </div>

          {/* Fields Mapping Builder */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-espresso-600 dark:text-espresso-400 uppercase tracking-wider">
                Target Field Selectors ({fields.length})
              </label>
              <button
                type="button"
                onClick={handleAddField}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/30 hover:bg-caramel-500/30 text-xs font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Field</span>
              </button>
            </div>

            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-2xl bg-white dark:bg-espresso-900/80 border border-caramel-500/15 space-y-2 text-xs shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Field name"
                      value={f.name}
                      onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                      className="w-1/3 px-2.5 py-1.5 rounded-lg glass-input text-xs font-mono font-bold text-espresso-900 dark:text-white"
                    />

                    <select
                      value={f.type}
                      onChange={(e) => handleUpdateField(idx, 'type', e.target.value)}
                      className="w-1/3 px-2 py-1.5 rounded-lg glass-input text-xs"
                    >
                      <option value="text">Inner Text</option>
                      <option value="attribute">Attribute</option>
                      <option value="html">Raw HTML</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => handleRemoveField(idx)}
                      className="p-1.5 rounded-lg text-espresso-400 hover:text-rose-500 hover:bg-rose-500/10 transition ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Child CSS Selector"
                      value={f.selector}
                      onChange={(e) => handleUpdateField(idx, 'selector', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg glass-input text-xs font-mono"
                    />

                    {selectedElementInfo && (
                      <button
                        type="button"
                        onClick={() => handleApplySelectedToField(idx)}
                        className="px-2 py-1 rounded bg-caramel-500/15 hover:bg-caramel-500/30 text-caramel-600 dark:text-caramel-400 text-[10px] font-bold transition shrink-0"
                        title="Paste selected element selector"
                      >
                        Paste Clicked
                      </button>
                    )}

                    {f.type === 'attribute' && (
                      <input
                        type="text"
                        placeholder="Attr (href, src)"
                        value={f.attribute}
                        onChange={(e) => handleUpdateField(idx, 'attribute', e.target.value)}
                        className="w-24 px-2 py-1.5 rounded-lg glass-input text-xs font-mono text-caramel-600 dark:text-caramel-400 font-bold"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestExtraction}
            disabled={isLoading}
            className="w-full py-3.5 rounded-2xl bg-gradient-caramel hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-caramel-500/20 glow-caramel transition disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Testing Deterministic Selectors...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Test Live Selector Schema</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right: Live Interactive Sandbox & Extracted Data */}
      <div className="flex-1 flex flex-col min-w-0 bg-espresso-50/50 dark:bg-black/60 overflow-hidden">
        {/* Visual Inspection Toolbar */}
        <div className="h-14 border-b border-caramel-500/15 px-6 flex items-center justify-between bg-white/40 dark:bg-espresso-900/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="w-2.5 h-2.5 rounded-full bg-caramel-500 animate-pulse"></span>
              <span className="font-bold text-espresso-900 dark:text-white">
                {hoveredElementInfo ? `<${hoveredElementInfo.tag}> ${hoveredElementInfo.selector}` : 'Hover over elements in the live frame'}
              </span>
            </div>
          </div>

          {selectedElementInfo && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-0.5 rounded-full bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 font-bold border border-caramel-500/30">
                Selected: {selectedElementInfo.selector}
              </span>
            </div>
          )}
        </div>

        {/* Visual Sandbox / Results Split */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Live Sandboxed Iframe */}
          <div className="flex-1 border-r border-caramel-500/15 p-4 flex flex-col bg-white dark:bg-black/80">
            {sandboxHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={sandboxHtml}
                title="Visual DOM Sandbox"
                className="w-full h-full rounded-2xl border border-caramel-500/20 shadow-inner"
                sandbox="allow-scripts"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-espresso-400 dark:text-espresso-600">
                <MousePointer className="w-12 h-12 opacity-30 text-caramel-500 mb-3" />
                <h4 className="text-sm font-semibold text-espresso-800 dark:text-espresso-200">Visual DOM Sandbox Ready</h4>
                <p className="text-xs max-w-sm mt-1">
                  Click "Load Live Picker" on the left to render the target website in an interactive point-and-click canvas.
                </p>
              </div>
            )}
          </div>

          {/* Results / Extracted Payload */}
          <div className="w-[450px] p-4 flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-espresso-900 dark:text-white uppercase tracking-wider">
                Extracted Output
              </h4>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-espresso-100 dark:bg-white/5 hover:bg-caramel-500/20 text-[11px] font-mono text-espresso-700 dark:text-espresso-300 transition"
              >
                {copiedSnippet ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>Python SDK</span>
              </button>
            </div>

            <div className="flex-1 min-h-[300px]">
              {extractedData ? (
                <JsonViewer data={extractedData} filename="point-click-data.json" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-caramel-500/15 rounded-2xl bg-white/40 dark:bg-espresso-900/40 text-espresso-400 text-xs shadow-sm">
                  <Eye className="w-8 h-8 opacity-30 text-caramel-500 mb-2" />
                  <p>Extracted records will stream here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
