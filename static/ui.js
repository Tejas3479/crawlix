import { state } from './state.js';

export function getMotion() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return null;
  }
  return window.Motion || window.motion || (window.MotionOne && window.MotionOne.dom) || null;
}

export function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  const Motion = getMotion();
  if (Motion && typeof Motion.animate === "function") {
    toast.classList.add("show");
    Motion.animate(
      toast,
      { opacity: [0, 1], y: [25, 0], scale: [0.9, 1] },
      { type: "spring", stiffness: 450, damping: 25 }
    );
  } else {
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  }
  
  setTimeout(() => {
    const activeMotion = getMotion();
    if (activeMotion && typeof activeMotion.animate === "function") {
      activeMotion.animate(
        toast,
        { opacity: 0, y: 15, scale: 0.95 },
        { duration: 0.2 }
      ).finished.then(() => {
        toast.remove();
      }).catch(() => toast.remove());
    } else {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.remove();
      }, 200);
    }
  }, duration);
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderJsonTree(obj, depth) {
  if (depth > 5) return '<span style="color:#6a6a6a">[…]</span>';
  if (obj === null) return '<span style="color:#888">null</span>';
  if (typeof obj === "boolean") return '<span style="color:#f87171">' + obj + '</span>';
  if (typeof obj === "number") return '<span style="color:#fbbf24">' + obj + '</span>';
  if (typeof obj === "string") {
    const safe = escapeHtml(obj);
    return '<span style="color:#86efac">"' + safe.substring(0, 200) + (obj.length > 200 ? '...' : '') + '"</span>';
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span style="color:#9a9a9a">[]</span>';
    const items = obj.slice(0, 50).map(v =>
      '<div style="margin-left:' + ((depth + 1) * 14) + 'px">' + renderJsonTree(v, depth + 1) + '</div>'
    ).join("");
    const more = obj.length > 50 ? '<div style="margin-left:' + ((depth + 1) * 14) + 'px;color:#6a6a6a">… ' + (obj.length - 50) + ' more</div>' : "";
    return '<span style="color:#9a9a9a">[</span>' + items + more + '<div style="margin-left:' + (depth * 14) + 'px"><span style="color:#9a9a9a">]</span></div>';
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '<span style="color:#9a9a9a">{}</span>';
    const rows = entries.map(([k, v]) =>
      '<div style="margin-left:' + ((depth + 1) * 14) + 'px"><span style="color:#4fc3f7">"' + escapeHtml(k) + '"</span><span style="color:#9a9a9a">: </span>' + renderJsonTree(v, depth + 1) + '</div>'
    ).join("");
    return '<span style="color:#9a9a9a">{</span>' + rows + '<div style="margin-left:' + (depth * 14) + 'px"><span style="color:#9a9a9a">}</span></div>';
  }
  return escapeHtml(String(obj));
}

export function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return Math.floor(diff / 1000) + "s ago";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  return Math.floor(diff / 3600000) + "h ago";
}

export function renderWaterfall(timing) {
  const waterfall = document.getElementById("timing-waterfall");
  if (!waterfall) return;

  if (!timing) {
    waterfall.classList.add("hidden");
    return;
  }

  const { security_ms = 0, connect_ms = 0, ttfb_ms = 0, transfer_ms = 0, total_ms = 1 } = timing;
  const safeTotal = total_ms || 1;

  const segs = [
    ["tseg-security", security_ms, "tval-security"],
    ["tseg-connect",  connect_ms,  "tval-connect"],
    ["tseg-ttfb",     ttfb_ms,     "tval-ttfb"],
    ["tseg-transfer", transfer_ms, "tval-transfer"],
  ];

  segs.forEach(([segId, ms, valId]) => {
    const seg = document.getElementById(segId);
    const val = document.getElementById(valId);
    const pct = Math.max(0.8, (ms / safeTotal) * 100);
    if (seg) {
      seg.style.flex = String(pct);
      seg.setAttribute("data-ms", ms + "ms");
    }
    if (val) val.textContent = ms + "ms";
  });

  waterfall.classList.remove("hidden");
}

export function updateMetaBar(data) {
  const statusEl = document.getElementById("response-status");
  if (!statusEl) return;
  
  statusEl.textContent = data.status_code;
  statusEl.className = "status-pill";
  if (data.status_code >= 200 && data.status_code < 300) statusEl.classList.add("status-2xx");
  else if (data.status_code >= 300 && data.status_code < 400) statusEl.classList.add("status-3xx");
  else if (data.status_code >= 400 && data.status_code < 500) statusEl.classList.add("status-4xx");
  else statusEl.classList.add("status-5xx");
  
  document.getElementById("response-latency").textContent = data.latency_ms;
  document.getElementById("response-retries").textContent = data.retries_used;
  
  const urlEl = document.getElementById("response-url");
  if (urlEl) {
    urlEl.textContent = data.url;
    urlEl.title = data.url;
  }

  renderWaterfall(data.timing);
}

export function initCardEffects() {
  document.querySelectorAll(".glow-card, .meta-bar").forEach(card => {
    card.classList.add("glow-card");
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });
  });

  document.querySelectorAll(".tilt-card").forEach(card => {
    card.classList.add("tilt-card");
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -4;
      const rotateY = ((x - centerX) / centerX) * 4;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
    });
  });

  const lightboxOverlay = document.getElementById("lightbox-overlay");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCloseBtn = document.getElementById("lightbox-close-btn");

  if (lightboxOverlay && lightboxImg) {
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.tagName === "IMG" && (target.id === "screenshot-img" || target.closest("#content-screenshot"))) {
        lightboxImg.src = target.src;
        lightboxOverlay.classList.add("active");
        animateModalOpen(lightboxOverlay, lightboxImg);
        focusModal(lightboxOverlay, { focusTarget: lightboxCloseBtn });
      }
    });

    const closeLightbox = () => {
      blurModal(lightboxOverlay, { restoreFocus: true });
      const Motion = getMotion();
      if (Motion && typeof Motion.animate === "function") {
        Motion.animate(lightboxOverlay, { opacity: 0 }, { duration: 0.18 }).finished.then(() => {
          lightboxOverlay.classList.remove("active");
        }).catch(() => lightboxOverlay.classList.remove("active"));
      } else {
        lightboxOverlay.classList.remove("active");
      }
    };
    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener("click", closeLightbox);
    lightboxOverlay.addEventListener("click", (e) => {
      if (e.target === lightboxOverlay) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lightboxOverlay.classList.contains("active")) {
        closeLightbox();
      }
    });
  }

  const Motion = getMotion();
  if (Motion && typeof Motion.animate === "function") {
    const { animate } = Motion;
    animate("#sidebar", { x: [-32, 0], opacity: [0, 1] }, { duration: 0.45, easing: [0.16, 1, 0.3, 1] });
    const activeSection = document.querySelector(".main-content > div:not(.hidden)");
    if (activeSection) {
      animate(activeSection, { y: [18, 0], opacity: [0, 1] }, { duration: 0.45, easing: [0.16, 1, 0.3, 1] });
    }

    document.querySelectorAll("button, .nav-link, .tab-btn, .option-card, .action-item").forEach(btn => {
      if (btn._hasMotionSpring) return;
      btn._hasMotionSpring = true;
      btn.addEventListener("pointerdown", () => {
        const m = getMotion();
        if (m && typeof m.animate === "function") {
          m.animate(btn, { scale: 0.95 }, { type: "spring", stiffness: 500, damping: 25 });
        }
      });
      btn.addEventListener("pointerup", () => {
        const m = getMotion();
        if (m && typeof m.animate === "function") {
          m.animate(btn, { scale: 1 }, { type: "spring", stiffness: 500, damping: 25 });
        }
      });
      btn.addEventListener("pointerleave", () => {
        const m = getMotion();
        if (m && typeof m.animate === "function") {
          m.animate(btn, { scale: 1 }, { duration: 0.15 });
        }
      });
    });
  }
}

export function animateViewEntrance(target) {
  const Motion = getMotion();
  if (!Motion || typeof Motion.animate !== "function" || !target) return;
  const { animate } = Motion;
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  animate(
    el,
    { opacity: [0, 1], y: [14, 0], scale: [0.99, 1] },
    { duration: 0.35, easing: [0.16, 1, 0.3, 1] }
  );
}

export function animateListItems(selector) {
  const Motion = getMotion();
  if (!Motion || typeof Motion.animate !== "function") return;
  const { animate, stagger } = Motion;
  const items = document.querySelectorAll(selector);
  if (items && items.length > 0) {
    const delayVal = typeof stagger === "function" ? stagger(0.04) : 0;
    animate(
      items,
      { opacity: [0, 1], y: [12, 0], scale: [0.98, 1] },
      { delay: delayVal, duration: 0.35, easing: [0.16, 1, 0.3, 1] }
    );
  }
}

export function animateModalOpen(modalEl, contentEl) {
  const Motion = getMotion();
  if (!Motion || typeof Motion.animate !== "function" || !modalEl) return;
  const { animate } = Motion;
  animate(modalEl, { opacity: [0, 1] }, { duration: 0.2 });
  if (contentEl) {
    animate(
      contentEl,
      { scale: [0.85, 1], opacity: [0, 1], y: [24, 0] },
      { type: "spring", stiffness: 450, damping: 26 }
    );
  }
}

const openModals = new Set();
let modalLastFocused = null;
let modalKeydownBound = false;

function trapModalFocus(e) {
  if (e.key !== "Tab" || openModals.size === 0) return;
  const modalEl = [...openModals][openModals.size - 1];
  const focusable = Array.from(
    modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !modalEl.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !modalEl.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

export function focusModal(modalEl, opts = {}) {
  if (!modalEl) return;
  if (!modalKeydownBound) {
    modalKeydownBound = true;
    document.addEventListener("keydown", trapModalFocus);
  }
  openModals.add(modalEl);
  modalLastFocused = document.activeElement;
  if (opts.lockScroll !== false) document.body.style.overflow = "hidden";
  const focusTarget = opts.focusTarget ||
    modalEl.querySelector("button, [href], input, select, textarea");
  if (focusTarget) focusTarget.focus();
}

export function blurModal(modalEl, opts = {}) {
  if (!modalEl) return;
  openModals.delete(modalEl);
  if (openModals.size === 0) document.body.style.overflow = "";
  if (opts.restoreFocus && modalLastFocused && document.contains(modalLastFocused)) {
    modalLastFocused.focus();
  }
  modalLastFocused = null;
}

export function renderSkeletonCards(count = 3) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:16px;">
        <div class="skeleton-loader" style="height:10px; width:35%; margin-bottom:12px;"></div>
        <div class="skeleton-loader" style="height:14px; margin-bottom:8px;"></div>
        <div class="skeleton-loader" style="height:6px; margin-top:10px;"></div>
      </div>`;
  }
  return html;
}

export function renderSkeletonRows(count = 3) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton-loader" style="height:34px; margin-bottom:8px;"></div>`;
  }
  return html;
}
