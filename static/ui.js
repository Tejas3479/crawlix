import { state } from './state.js';

export function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });
  
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
    }, 200);
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

export function initFramerMotion() {
  document.querySelectorAll(".glow-card, .request-panel, .options-grid, .meta-bar").forEach(card => {
    card.classList.add("glow-card");
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });
  });

  document.querySelectorAll(".tilt-card, .option-group, .action-item").forEach(card => {
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
      if (target && target.tagName === "IMG" && (target.classList.contains("screenshot-img") || target.closest("#tab-screenshot"))) {
        lightboxImg.src = target.src;
        lightboxOverlay.classList.add("active");
      }
    });

    const closeLightbox = () => lightboxOverlay.classList.remove("active");
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
}
