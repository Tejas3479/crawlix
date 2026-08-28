import React from 'react';
import { useCrawlStore } from '../../store/useCrawlStore';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export function ToastContainer() {
  const toasts = useCrawlStore((state) => state.toasts);
  const removeToast = useCrawlStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        let icon = <Info className="w-4 h-4 text-blue-500 shrink-0" />;
        let borderClass = 'border-caramel-500/20 bg-white/95 dark:bg-espresso-900/95';

        if (toast.type === 'success') {
          icon = <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
          borderClass = 'border-emerald-500/30 bg-white/95 dark:bg-emerald-950/20';
        } else if (toast.type === 'error') {
          icon = <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />;
          borderClass = 'border-rose-500/30 bg-white/95 dark:bg-rose-950/20';
        } else if (toast.type === 'warning') {
          icon = <AlertTriangle className="w-4 h-4 text-caramel-500 shrink-0" />;
          borderClass = 'border-caramel-500/30 bg-white/95 dark:bg-caramel-950/20';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border backdrop-blur-2xl shadow-2xl animate-slide-up ${borderClass}`}
          >
            {icon}
            <div className="flex-1 min-w-0">
              {toast.title && (
                <h4 className="text-xs font-bold text-espresso-900 dark:text-white mb-0.5">{toast.title}</h4>
              )}
              <p className="text-xs text-espresso-700 dark:text-espresso-300 leading-relaxed break-words">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded-lg text-espresso-400 hover:text-espresso-800 dark:hover:text-white transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
