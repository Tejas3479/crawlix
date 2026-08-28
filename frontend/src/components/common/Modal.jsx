import React from 'react';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xl transition-opacity animate-fade-in"
        onClick={onClose}
      ></div>

      {/* Modal Container */}
      <div className="relative w-full max-w-lg rounded-3xl border border-caramel-500/30 bg-white dark:bg-espresso-900 shadow-2xl overflow-hidden z-10 animate-slide-up glow-caramel-subtle">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-caramel-500/15 bg-espresso-50 dark:bg-black/40">
          <h3 className="text-base font-bold text-espresso-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-espresso-400 hover:text-espresso-800 dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
