import React, { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { useCrawlStore } from '../../store/useCrawlStore';

export function JsonViewer({ data, filename = 'crawlix-data.json' }) {
  const [copied, setCopied] = useState(false);
  const addToast = useCrawlStore((state) => state.addToast);

  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    addToast({ type: 'success', message: 'JSON copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: `Downloaded ${filename}` });
  };

  const formatJson = (val) => {
    if (!val) return '';
    try {
      const obj = typeof val === 'string' ? JSON.parse(val) : val;
      const str = JSON.stringify(obj, null, 2);
      return str;
    } catch {
      return String(val);
    }
  };

  return (
    <div className="relative flex flex-col h-full bg-white dark:bg-espresso-900/90 rounded-2xl border border-caramel-500/15 overflow-hidden font-mono text-xs shadow-xl">
      {/* Action Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-espresso-50 dark:bg-black/50 border-b border-caramel-500/15">
        <div className="flex items-center gap-2 text-espresso-600 dark:text-espresso-400">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-caramel-500 animate-pulse"></span>
          <span className="font-bold text-espresso-900 dark:text-white">JSON Payload</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-espresso-500 font-mono">
            {new Blob([jsonString]).size} bytes
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white dark:bg-white/5 hover:bg-black/5 dark:hover:bg-white/10 text-espresso-700 dark:text-espresso-300 transition text-xs border border-caramel-500/10 shadow-sm"
            title="Copy JSON"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-caramel-500/15 hover:bg-caramel-500/25 text-caramel-700 dark:text-caramel-300 transition text-xs border border-caramel-500/30 font-bold"
            title="Download JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Code Container */}
      <div className="flex-1 overflow-auto p-5 select-text bg-espresso-50/30 dark:bg-black/50">
        <pre className="text-caramel-600 dark:text-caramel-400 whitespace-pre-wrap leading-relaxed">
          {formatJson(data)}
        </pre>
      </div>
    </div>
  );
}
