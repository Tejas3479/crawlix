import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useCrawlStore } from '../../store/useCrawlStore';

export function CodeBlock({ code, language = 'text', title = null }) {
  const [copied, setCopied] = useState(false);
  const addToast = useCrawlStore((state) => state.addToast);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    addToast({ type: 'success', message: 'Code copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-2xl border border-caramel-500/15 bg-white dark:bg-espresso-900/90 overflow-hidden font-mono text-xs shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-espresso-50 dark:bg-black/50 border-b border-caramel-500/15">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-caramel-400/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
          </div>
          {title && <span className="text-espresso-700 dark:text-espresso-300 font-semibold ml-2">{title}</span>}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-caramel-600 dark:text-caramel-400 px-2 py-0.5 rounded bg-caramel-500/10 border border-caramel-500/20">
            {language}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-white/5 hover:bg-black/5 dark:hover:bg-white/10 text-espresso-700 dark:text-espresso-300 transition text-xs border border-caramel-500/10 shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Code Container */}
      <div className="p-4 overflow-x-auto select-text bg-espresso-50/30 dark:bg-black/40">
        <pre className="text-espresso-900 dark:text-espresso-100 whitespace-pre leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
