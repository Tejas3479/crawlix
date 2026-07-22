// State management
const state = {
  apiKey: localStorage.getItem("crawlix_key") || "",
  currentSessionId: null,
  activeTab: "preview",
  lastResponse: null,
  lastRequest: null,
  sessions: [],
  crawls: [],
  previewDark: true  // preview iframe background theme
};

const API_BASE = ""; // relative path for same-origin requests
const TABS = ["preview", "screenshot", "markdown", "code", "json"];
const MAX_HISTORY = 20;

// Helper to add a KV row to a container
function createKvRow(containerId, key = "", value = "") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const row = document.createElement("div");
  row.className = "kv-row action-row";
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.alignItems = "center";
  row.style.background = "rgba(255,255,255,0.02)";
  row.style.padding = "6px";
  row.style.borderRadius = "6px";
  row.style.border = "1px solid rgba(255,255,255,0.06)";

  row.innerHTML = `
    <input type="text" class="kv-key-input" placeholder="Key" value="${key}" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
    <input type="text" class="kv-value-input" placeholder="Value" value="${value}" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
    <button class="remove-kv-btn icon-btn" style="height:36px; width:36px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:6px; color:var(--danger-color); border-color:rgba(248,113,113,0.2);">✕</button>
  `;

  row.querySelector(".remove-kv-btn").addEventListener("click", () => {
    row.remove();
  });

  container.appendChild(row);
}

// Helper to parse KV rows from a container
function parseKvContainer(containerId) {
  const container = document.getElementById(containerId);
  const data = {};
  if (!container) return data;

  const rows = container.querySelectorAll(".kv-row");
  rows.forEach(row => {
    const key = row.querySelector(".kv-key-input").value.trim();
    const val = row.querySelector(".kv-value-input").value.trim();
    if (key) {
      data[key] = val;
    }
  });
  return data;
}

// Toast notification system
function showToast(message, type = "info", duration = 3500) {
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

// Health check and Auth verification loop
async function checkHealth() {
  const badge = document.getElementById("status-badge");
  if (!badge) return;
  
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok") {
        const headers = {};
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        
        const authRes = await fetch("/api/sessions", { headers });
        if (authRes.status === 401) {
          badge.className = "status-badge status-offline";
          badge.textContent = "● Auth Failed";
          return;
        }
        
        badge.className = "status-badge status-online";
        badge.textContent = "● Online";
        return;
      }
    }
    badge.className = "status-badge status-offline";
    badge.textContent = "● Offline";
  } catch (e) {
    badge.className = "status-badge status-offline";
    badge.textContent = "● Offline";
  }
}

// ─── DEAD CODE REMOVED ───────────────────────────────────────────────────────
// parseHeaders() and parseCookies() were superseded by parseKvContainer().
// Removed to avoid confusion and reduce bundle size.
// ─────────────────────────────────────────────────────────────────────────────

// Switch tabs and trigger re-render of dynamic code block / preview frame
function switchTab(tabName) {
  state.activeTab = tabName;
  TABS.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    const content = document.getElementById("content-" + t);
    if (btn) btn.classList.toggle("tab-active", t === tabName);
    if (content) content.classList.toggle("hidden", t !== tabName);
  });
  if (state.lastResponse) renderTab(tabName);
}

// Render active tab data
function renderTab(tabName) {
  const data = state.lastResponse;
  if (!data) return;

  if (tabName === "preview") {
    const iframe = document.getElementById("preview-iframe");
    if (!iframe) return;
    const bgColor = state.previewDark ? "#0a0a0f" : "#ffffff";
    const textColor = state.previewDark ? "#e2e2e2" : "#111111";

    if (data.output_format === "html" && typeof data.content === "string") {
      let injectedHtml = data.content;
      const selectorHelperScript = `
        <style>
          .crawlix-highlight {
            outline: 2px dashed #7c6cf0 !important;
            outline-offset: -2px !important;
            cursor: pointer !important;
          }
        </style>
        <script>
          window.addEventListener('DOMContentLoaded', () => {
            let lastEl = null;
            document.body.addEventListener('mousemove', (e) => {
              if (lastEl) lastEl.classList.remove('crawlix-highlight');
              if (e.target !== document.body && e.target !== document.documentElement) {
                e.target.classList.add('crawlix-highlight');
                lastEl = e.target;
              }
            });
            document.body.addEventListener('mouseout', (e) => {
              if (lastEl) lastEl.classList.remove('crawlix-highlight');
            });
            document.body.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              function getSelector(el) {
                if (el.id) return '#' + el.id;
                let path = [];
                while (el && el.nodeType === Node.ELEMENT_NODE) {
                  let selector = el.nodeName.toLowerCase();
                  if (el.className) {
                    const classes = Array.from(el.classList)
                      .filter(c => c !== 'crawlix-highlight')
                      .join('.');
                    if (classes) selector += '.' + classes;
                  }
                  let sib = el, nth = 1;
                  while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() === el.nodeName.toLowerCase()) nth++;
                  }
                  if (nth > 1) selector += ':nth-of-type(' + nth + ')';
                  path.unshift(selector);
                  el = el.parentNode;
                }
                return path.join(' > ');
              }
              const selector = getSelector(e.target);
              window.parent.postMessage({ type: 'crawlix-selector-select', selector }, '*');
            });
          });
        </script>
      `;
      injectedHtml = injectedHtml.replace("</body>", selectorHelperScript + "</body>");
      if (!injectedHtml.includes(selectorHelperScript)) {
        injectedHtml += selectorHelperScript;
      }
      iframe.srcdoc = injectedHtml;
    } else if (data.output_format === "markdown" && typeof data.content === "string") {
      iframe.srcdoc = `<body style='font-family:Inter,sans-serif;padding:16px;color:${textColor};background-color:${bgColor}'>${marked.parse(data.content)}</body>`;
    } else {
      iframe.srcdoc = `<body style='font-family:Inter,sans-serif;padding:16px;color:${textColor};background-color:${bgColor}'><pre>${JSON.stringify(data.content, null, 2).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body>`;
    }
  } else if (tabName === "screenshot") {
    const img = document.getElementById("screenshot-img");
    const placeholder = document.getElementById("screenshot-placeholder");
    if (!img || !placeholder) return;
    
    if (data.screenshot) {
      img.src = data.screenshot;
      img.style.display = "inline-block";
      placeholder.style.display = "none";
    } else {
      img.src = "";
      img.style.display = "none";
      placeholder.style.display = "block";
    }
  } else if (tabName === "markdown") {
    const code = document.getElementById("markdown-code");
    if (!code) return;
    code.textContent = typeof data.content === "string" ? data.content : JSON.stringify(data.content, null, 2);
    if (window.Prism) Prism.highlightElement(code);
  } else if (tabName === "code") {
    const code = document.getElementById("python-code");
    if (!code) return;
    code.textContent = generatePythonSnippet(state.lastRequest, data);
    if (window.Prism) Prism.highlightElement(code);
  } else if (tabName === "json") {
    const tree = document.getElementById("json-tree");
    if (!tree) return;
    tree.innerHTML = renderJsonTree(data, 0);
  }
}

// Generate execution snippet matching visual config
function generatePythonSnippet(req, response) {
  const headersStr = JSON.stringify(req.headers || {}, null, 12);
  const cookiesStr = JSON.stringify(req.cookies || {}, null, 12);

  if (req.render_js) {
    let actionsCode = "";
    if (req.actions && req.actions.length > 0) {
      actionsCode = "\n        # Execute interactive browser actions\n";
      req.actions.forEach(act => {
        if (act.type === "click") {
          actionsCode += `        await page.click("${act.selector}")\n`;
        } else if (act.type === "fill") {
          actionsCode += `        await page.fill("${act.selector}", "${act.value || ''}")\n`;
        } else if (act.type === "wait") {
          actionsCode += `        await page.wait_for_timeout(${act.duration ? act.duration * 1000 : 1000})\n`;
        } else if (act.type === "scroll") {
          if (act.selector) {
            actionsCode += `        await page.locator("${act.selector}").scroll_into_view_if_needed()\n`;
          } else {
            actionsCode += `        await page.evaluate("window.scrollBy(0, window.innerHeight)")\n`;
          }
        } else if (act.type === "hover") {
          actionsCode += `        await page.hover("${act.selector}")\n`;
        } else if (act.type === "press") {
          actionsCode += `        await page.press("${act.selector}", "${act.value || 'Enter'}")\n`;
        }
      });
    }

    let screenshotCode = "";
    if (req.screenshot) {
      screenshotCode = `\n        # Capture screenshot\n        await page.screenshot(path="screenshot.png", full_page=True)\n`;
    }

    return `import asyncio
from playwright.async_api import async_playwright

async def fetch():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            extra_http_headers=${headersStr}
        )
        await context.add_cookies([
            {"name": k, "value": v, "url": "${req.url}"}
            for k, v in ${cookiesStr}.items()
        ])
        page = await context.new_page()
        response = await page.goto("${req.url}", wait_until="networkidle")
        print(f"Status: {response.status}")
        print(f"Final URL: {page.url}")
        ${actionsCode}${screenshotCode}
        content = await page.content()
        print(content[:1000])
        await browser.close()

asyncio.run(fetch())
# Response was: ${response.status_code} | ${response.latency_ms}ms | Format: ${response.output_format}
`;
  } else {
    let extraParams = "";
    if (req.css_selector) extraParams += `,\n            css_selector="${req.css_selector}"`;
    if (req.llm_model) extraParams += `,\n            llm_model="${req.llm_model}"`;
    if (req.json_schema) extraParams += `,\n            json_schema=${JSON.stringify(req.json_schema)}`;

    return `from curl_cffi.requests import AsyncSession
import asyncio, json

async def fetch():
    async with AsyncSession(impersonate="${req.impersonate || 'chrome120'}") as session:
        response = await session.${(req.method || 'get').toLowerCase()}(
            "${req.url}",
            headers=${headersStr},
            cookies=${cookiesStr},
            timeout=${req.timeout || 30}${extraParams}
        )
        print(f"Status: {response.status_code}")
        print(f"Final URL: {response.url}")
        print(response.text[:1000])

asyncio.run(fetch())
# Response was: ${response.status_code} | ${response.latency_ms}ms | Format: ${response.output_format}
`;
  }
}

// XSS-safe HTML entity escaper
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// JSON visualization tree (XSS-safe: all keys and string values are escaped)
function renderJsonTree(obj, depth) {
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

// Convert epoch time differences to readable labels
function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return Math.floor(diff / 1000) + "s ago";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  return Math.floor(diff / 3600000) + "h ago";
}

// Session listing and deletion renderer
async function renderSessions() {
  const grid = document.getElementById("session-grid");
  if (!grid) return;
  
  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    const res = await fetch(API_BASE + "/api/sessions", { headers });
    if (!res.ok) return;
    const sessions = await res.json();
    state.sessions = sessions;
    
    if (sessions.length === 0) {
      grid.innerHTML = '<div class="empty-state">No active sessions</div>';
      return;
    }
    
    grid.innerHTML = sessions.map(s => `
      <div class="session-card" data-session-id="${s.session_id}">
        <div class="card-session-id">${s.session_id}</div>
        <span class="engine-badge engine-${s.engine}">${s.engine}</span>
        <div class="card-meta">
          <div>Requests: ${s.request_count}</div>
          <div>Cookies: ${s.cookie_count}</div>
          <div>Created: ${timeAgo(s.created_at)}</div>
          <div>Last active: ${timeAgo(s.last_active)}</div>
        </div>
        <button class="delete-session-btn" data-session-id="${s.session_id}" title="Delete session">✕</button>
      </div>
    `).join("");
    
    // Wire up delete events
    grid.querySelectorAll(".delete-session-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sessionId;
        if (!confirm("Delete session " + sid.slice(0, 8) + "…?")) return;
        try {
          const h = { "Content-Type": "application/json" };
          if (state.apiKey) h["x-api-key"] = state.apiKey;
          const r = await fetch(API_BASE + "/api/sessions/" + sid, { method: "DELETE", headers: h });
          if (r.ok) {
            if (state.currentSessionId === sid) state.currentSessionId = null;
            btn.closest(".session-card").remove();
            showToast("Session deleted", "success", 2000);
            if (grid.querySelectorAll(".session-card").length === 0) {
              grid.innerHTML = '<div class="empty-state">No active sessions</div>';
            }
          } else {
            showToast("Failed to delete session", "error");
          }
        } catch (err) {
          showToast("Connection error", "error");
        }
      });
    });
  } catch (e) {
    // Fail silently
  }
}

// Update Response Metadata HUD Bar
function updateMetaBar(data) {
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

  // Render timing waterfall if timing data is present
  renderWaterfall(data.timing);
}

// ─── TIMING WATERFALL ─────────────────────────────────────────────────────────
function renderWaterfall(timing) {
  const waterfall = document.getElementById("timing-waterfall");
  if (!waterfall) return;

  if (!timing) {
    waterfall.classList.add("hidden");
    return;
  }

  const { security_ms = 0, connect_ms = 0, ttfb_ms = 0, transfer_ms = 0, total_ms = 1 } = timing;
  const safeTotal = total_ms || 1;

  // Segments: [id, ms value]
  const segs = [
    ["tseg-security", security_ms, "tval-security"],
    ["tseg-connect",  connect_ms,  "tval-connect"],
    ["tseg-ttfb",     ttfb_ms,     "tval-ttfb"],
    ["tseg-transfer", transfer_ms, "tval-transfer"],
  ];

  segs.forEach(([segId, ms, valId]) => {
    const seg = document.getElementById(segId);
    const val = document.getElementById(valId);
    const pct = Math.max(0.8, (ms / safeTotal) * 100); // min 0.8% so segment is visible
    if (seg) {
      seg.style.flex = String(pct);
      seg.setAttribute("data-ms", ms + "ms");
    }
    if (val) val.textContent = ms + "ms";
  });

  waterfall.classList.remove("hidden");
}


// Sidebar routing navigation setup
function setupRouting() {
  const links = {
    "nav-builder": "builder-section",
    "nav-crawler": "crawler-section",
    "nav-history": "history-section",
    "nav-sessions": "session-panel"
  };

  const allSections = ["builder-section", "crawler-section", "history-section", "session-panel"];

  Object.entries(links).forEach(([linkId, sectionId]) => {
    const link = document.getElementById(linkId);
    if (!link) return;

    link.addEventListener("click", (e) => {
      e.preventDefault();

      document.querySelectorAll("#sidebar .nav-link").forEach(l => {
        l.classList.remove("active");
        l.removeAttribute("aria-current");
      });
      link.classList.add("active");
      link.setAttribute("aria-current", "page");

      allSections.forEach(id => document.getElementById(id)?.classList.add("hidden"));

      const respPanel = document.getElementById("response-panel");
      if (sectionId === "builder-section" && state.lastResponse) {
        respPanel.classList.remove("hidden");
      } else {
        respPanel.classList.add("hidden");
      }

      document.getElementById(sectionId).classList.remove("hidden");

      // Trigger lazy renders
      if (sectionId === "session-panel") renderSessions();
      if (sectionId === "history-section") renderHistory();
    });
  });
}

function setupJsRenderingToggle() {
  const checkbox = document.getElementById("render-js-checkbox");
  const stealthLabel = document.getElementById("stealth-mode-label");
  const actionsCollapsible = document.getElementById("actions-collapsible");
  const waitSelectorInput = document.getElementById("wait-selector-input");
  const waitSelectorGroup = waitSelectorInput ? waitSelectorInput.closest(".option-group") : null;
  const screenshotCheckbox = document.getElementById("screenshot-checkbox");
  const screenshotLabel = screenshotCheckbox ? screenshotCheckbox.closest(".checkbox-label") : null;
  const scrollCheckbox = document.getElementById("scroll-checkbox");
  const scrollLabel = scrollCheckbox ? scrollCheckbox.closest(".checkbox-label") : null;
  const waitUntilGroup = document.getElementById("wait-until-group");

  function updateVisibility() {
    const isJs = checkbox && checkbox.checked;
    if (actionsCollapsible) {
      actionsCollapsible.style.display = isJs ? "block" : "none";
    }
    if (waitSelectorGroup) {
      waitSelectorGroup.style.display = isJs ? "flex" : "none";
    }
    if (screenshotLabel) {
      screenshotLabel.style.display = isJs ? "flex" : "none";
    }
    if (scrollLabel) {
      scrollLabel.style.display = isJs ? "flex" : "none";
    }
    if (waitUntilGroup) {
      waitUntilGroup.style.display = isJs ? "flex" : "none";
    }
    if (stealthLabel) {
      stealthLabel.style.display = isJs ? "flex" : "none";
    }
  }

  if (checkbox) {
    checkbox.addEventListener("change", updateVisibility);
    updateVisibility();
  }

  // Crawler Render JS toggle
  const crawlCheckbox = document.getElementById("crawl-render-js-checkbox");
  const crawlStealthLabel = document.getElementById("crawl-stealth-mode-label");
  function updateCrawlVisibility() {
    const isCrawlJs = crawlCheckbox && crawlCheckbox.checked;
    if (crawlStealthLabel) {
      crawlStealthLabel.style.display = isCrawlJs ? "flex" : "none";
    }
  }
  if (crawlCheckbox) {
    crawlCheckbox.addEventListener("change", updateCrawlVisibility);
    updateCrawlVisibility();
  }
}

function setupOutputFormatToggle() {
  const formatSelect = document.getElementById("output-format-select");
  const jsonSchemaCollapsible = document.getElementById("json-schema-collapsible");

  function updateVisibility() {
    const isStructured = formatSelect && formatSelect.value === "structured";
    if (jsonSchemaCollapsible) {
      jsonSchemaCollapsible.style.display = isStructured ? "block" : "none";
    }
  }

  if (formatSelect) {
    formatSelect.addEventListener("change", updateVisibility);
    updateVisibility();
  }
}

// Interactive Action Builder Logic
function setupActionBuilder() {
  const addBtn = document.getElementById("add-action-btn");
  const listContainer = document.getElementById("actions-list");
  if (!addBtn || !listContainer) return;

  addBtn.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "action-row";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.background = "rgba(255,255,255,0.02)";
    row.style.padding = "8px";
    row.style.borderRadius = "6px";
    row.style.border = "1px solid rgba(255,255,255,0.06)";

    row.innerHTML = `
      <select class="action-type-select" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; cursor:pointer; width:100px; flex-shrink:0;">
        <option value="click">Click</option>
        <option value="fill">Fill Input</option>
        <option value="wait">Wait</option>
        <option value="scroll">Scroll</option>
        <option value="hover">Hover</option>
        <option value="press">Press Key</option>
      </select>
      <input type="text" class="action-selector-input" placeholder="CSS Selector" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
      <input type="text" class="action-value-input" placeholder="Value (for Fill/Press)" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
      <input type="number" class="action-duration-input hidden" placeholder="Seconds" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; width:70px; flex-shrink:0;">
      <button class="remove-action-btn icon-btn" style="height:36px; width:36px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:6px; color:var(--danger-color); border-color:rgba(248,113,113,0.2);">✕</button>
    `;

    const typeSelect = row.querySelector(".action-type-select");
    const selectorInput = row.querySelector(".action-selector-input");
    const valueInput = row.querySelector(".action-value-input");
    const durationInput = row.querySelector(".action-duration-input");

    typeSelect.addEventListener("change", () => {
      const val = typeSelect.value;
      if (val === "wait") {
        selectorInput.classList.add("hidden");
        valueInput.classList.add("hidden");
        durationInput.classList.remove("hidden");
      } else if (val === "scroll") {
        selectorInput.classList.remove("hidden");
        selectorInput.placeholder = "CSS Selector (Optional)";
        valueInput.classList.add("hidden");
        durationInput.classList.add("hidden");
      } else if (val === "click" || val === "hover") {
        selectorInput.classList.remove("hidden");
        selectorInput.placeholder = "CSS Selector";
        valueInput.classList.add("hidden");
        durationInput.classList.add("hidden");
      } else if (val === "fill" || val === "press") {
        selectorInput.classList.remove("hidden");
        selectorInput.placeholder = "CSS Selector";
        valueInput.classList.remove("hidden");
        durationInput.classList.add("hidden");
      }
    });

    row.querySelector(".remove-action-btn").addEventListener("click", () => {
      row.remove();
    });

    listContainer.appendChild(row);
  });
}

function parseActions() {
  const actions = [];
  const rows = document.querySelectorAll("#actions-list .action-row");
  rows.forEach(row => {
    const type = row.querySelector(".action-type-select").value;
    const selector = row.querySelector(".action-selector-input").value.trim() || null;
    const value = row.querySelector(".action-value-input").value.trim() || null;
    const durationVal = row.querySelector(".action-duration-input").value;
    const duration = durationVal ? parseInt(durationVal, 10) : null;

    actions.push({ type, selector, value, duration });
  });
  return actions;
}

// Render crawl history list
async function renderCrawls() {
  const grid = document.getElementById("crawl-history-grid");
  if (!grid) return;

  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    const res = await fetch("/api/crawl", { headers });
    if (!res.ok) return;
    const crawls = await res.json();
    state.crawls = crawls;

    if (crawls.length === 0) {
      grid.innerHTML = '<div class="empty-state">No crawls started yet</div>';
      return;
    }

    grid.innerHTML = crawls.map(c => {
      const pct = Math.round((c.pages_crawled / c.max_pages) * 100);
      let statusClass = "engine-curl";
      if (c.status === "running") statusClass = "engine-playwright";
      else if (c.status === "failed") statusClass = "status-offline";
      
      return `
        <div class="session-card crawl-card" data-crawl-id="${c.crawl_id}" style="cursor:pointer; border-color:${c.status === 'running' ? 'var(--accent-color)' : 'rgba(255,255,255,0.08)'}; position: relative; padding:16px;">
          <div class="card-session-id" style="font-size:10px; color:var(--text-secondary)">ID: ${c.crawl_id.slice(0, 8)}…</div>
          <div class="crawl-card-url" style="font-size:13px; font-weight:500; margin-bottom:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right: 20px;" title="${c.url}">${c.url}</div>
          <span class="engine-badge ${statusClass}" style="margin-bottom:8px;">${c.status}</span>
          
          <div class="crawl-progress-container" style="background:rgba(255,255,255,0.06); height:6px; border-radius:3px; overflow:hidden; margin-top:8px; margin-bottom:4px;">
            <div class="crawl-progress-bar" style="width:${pct}%; height:100%; background:var(--accent-color); transition:width 0.3s ease;"></div>
          </div>
          <div class="card-meta" style="display:flex; justify-content:space-between; margin-top:4px;">
            <span>Pages: ${c.pages_crawled} / ${c.max_pages}</span>
            <span>${timeAgo(c.created_at)}</span>
          </div>
          <button class="delete-crawl-btn" data-crawl-id="${c.crawl_id}" style="position:absolute; top:12px; right:12px; background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:14px;">✕</button>
        </div>
      `;
    }).join("");

    // Add click events to cards
    grid.querySelectorAll(".crawl-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-crawl-btn")) return;
        viewCrawlDetails(card.dataset.crawlId);
      });
    });

    // Add delete events to buttons
    grid.querySelectorAll(".delete-crawl-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const cid = btn.dataset.crawlId;
        if (!confirm("Delete crawl " + cid.slice(0, 8) + " history?")) return;
        try {
          const headers = {};
          if (state.apiKey) headers["x-api-key"] = state.apiKey;
          const res = await fetch(`/api/crawl/${cid}`, { method: "DELETE", headers });
          if (res.ok) {
            showToast("Crawl deleted", "success", 2000);
            renderCrawls();
            const detailsView = document.getElementById("crawl-details-view");
            if (detailsView.dataset.currentCrawlId === cid) {
              detailsView.classList.add("hidden");
            }
          }
        } catch (err) {
          showToast("Failed to delete crawl", "error");
        }
      });
    });

  } catch (err) {
    // Silent fail
  }
}

let activeCrawlPollInterval = null;

// Start a crawl job
async function startCrawlJob() {
  const urlVal = document.getElementById("crawl-url-input").value.trim();
  if (!urlVal) {
    showToast("URL is required to start crawl", "error");
    return;
  }

  const startBtn = document.getElementById("crawl-start-btn");
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

  const payload = {
    url: urlVal,
    max_pages: parseInt(document.getElementById("crawl-max-pages-select").value, 10),
    max_depth: 3,
    render_js: document.getElementById("crawl-render-js-checkbox").checked,
    stealth: document.getElementById("crawl-stealth-checkbox").checked,
    output_format: document.getElementById("crawl-format-select").value,
    limit_domain: document.getElementById("crawl-limit-domain-checkbox").checked,
    actions: [],  // Crawl uses its own action scope (no shared builder actions)
    extraction_prompt: document.getElementById("crawl-extraction-prompt")?.value.trim() || null
  };

  try {
    const headers = { "Content-Type": "application/json" };
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    
    const res = await fetch("/api/crawl", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast("Crawl failed: " + (err.detail || "Request failed"), "error");
      return;
    }

    const data = await res.json();
    showToast("Crawl started successfully!", "success", 2000);
    document.getElementById("crawl-url-input").value = "";
    
    renderCrawls();
    viewCrawlDetails(data.crawl_id);

    setupCrawlPolling();

  } catch (err) {
    showToast("Connection failed", "error");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start Crawl";
  }
}

function setupCrawlPolling() {
  if (activeCrawlPollInterval) clearInterval(activeCrawlPollInterval);
  activeCrawlPollInterval = setInterval(async () => {
    await renderCrawls();
    
    const hasRunning = state.crawls.some(c => c.status === "running");
    if (!hasRunning) {
      clearInterval(activeCrawlPollInterval);
      activeCrawlPollInterval = null;
    }
    
    const detailsView = document.getElementById("crawl-details-view");
    if (!detailsView.classList.contains("hidden")) {
      const cid = detailsView.dataset.currentCrawlId;
      const currentCrawl = state.crawls.find(c => c.crawl_id === cid);
      if (currentCrawl && currentCrawl.status === "running") {
        viewCrawlDetails(cid, true);
      }
    }
  }, 1500);
}

// View crawl results table
async function viewCrawlDetails(crawlId, silent = false) {
  const detailsView = document.getElementById("crawl-details-view");
  const tableBody = document.getElementById("crawl-results-table-body");
  const titleEl = document.getElementById("crawl-details-title");
  if (!detailsView || !tableBody || !titleEl) return;

  detailsView.dataset.currentCrawlId = crawlId;
  if (!silent) {
    detailsView.classList.remove("hidden");
    titleEl.textContent = "Loading crawl results…";
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-tertiary);">Loading results…</td></tr>';
  }

  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    const res = await fetch(`/api/crawl/${crawlId}`, { headers });
    if (!res.ok) {
      titleEl.textContent = "Error loading results";
      return;
    }
    const crawl = await res.json();
    titleEl.textContent = `Crawl Results: ${crawl.url} (${crawl.pages_crawled} pages)`;

    detailsView.dataset.crawlData = JSON.stringify(crawl);

    // Calculate stats
    const totalPages = crawl.results.length;
    let successfulPages = 0;
    const statusCounts = {};

    crawl.results.forEach(r => {
      if (r.status_code && r.status_code >= 200 && r.status_code < 400) {
        successfulPages++;
      }
      const code = r.status_code || r.error || "error";
      statusCounts[code] = (statusCounts[code] || 0) + 1;
    });

    const successRate = totalPages > 0 ? Math.round((successfulPages / totalPages) * 100) : 0;
    const statusCodeStr = Object.entries(statusCounts)
      .map(([code, count]) => `${code}: ${count}`)
      .join(", ");

    const successRateEl = document.getElementById("stat-success-rate");
    const pagesScrapedEl = document.getElementById("stat-pages-scraped");
    const statusCodesEl = document.getElementById("stat-status-codes");

    if (successRateEl) {
      successRateEl.textContent = `${successRate}%`;
      successRateEl.style.color = successRate > 80 ? "var(--success-color)" : (successRate > 50 ? "var(--warning-color)" : "var(--danger-color)");
    }
    if (pagesScrapedEl) {
      pagesScrapedEl.textContent = `${crawl.pages_crawled} / ${crawl.max_pages}`;
    }
    if (statusCodesEl) {
      statusCodesEl.textContent = statusCodeStr || "—";
      statusCodesEl.title = statusCodeStr;
    }

    if (crawl.results.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-tertiary);">No pages scraped successfully yet</td></tr>';
      return;
    }

    tableBody.innerHTML = crawl.results.map((r, idx) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition:background 0.15s ease;" class="crawl-result-row">
        <td style="padding: 10px 16px; font-family: monospace; font-size: 11px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.url}">${r.url}</td>
        <td style="padding: 10px 16px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.title || '—'}">${r.title || '—'}</td>
        <td style="padding: 10px 16px;">
          <span class="status-pill ${r.status_code >= 200 && r.status_code < 300 ? 'status-2xx' : 'status-4xx'}" style="font-size:10px; padding:2px 8px;">
            ${r.status_code || r.error || 'error'}
          </span>
        </td>
        <td style="padding: 10px 16px;">
          <button class="icon-btn view-scraped-btn" data-index="${idx}" style="font-size:11px; padding:3px 8px;">View</button>
        </td>
      </tr>
    `).join("");

    // Wire view action
    tableBody.querySelectorAll(".view-scraped-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = crawl.results[parseInt(btn.dataset.index, 10)];
        state.lastResponse = {
          success: !r.error,
          url: r.url,
          status_code: r.status_code || 0,
          output_format: crawl.output_format || "markdown",
          content: r.content,
          session_id: null,
          latency_ms: 0,
          retries_used: 0,
          error: r.error || null
        };
        state.lastRequest = {
          url: r.url,
          method: "GET",
          render_js: crawl.render_js,
          output_format: crawl.output_format
        };
        
        document.getElementById("nav-builder").click();
        document.getElementById("response-panel").classList.remove("hidden");
        switchTab("preview");
        showToast("Loaded page details in Request Builder", "info", 2000);
      });
    });

  } catch (err) {
    titleEl.textContent = "Connection error";
  }
}

// Download Crawl JSON file
function setupCrawlDownload() {
  const btn = document.getElementById("crawl-download-btn");
  const detailsView = document.getElementById("crawl-details-view");
  if (!btn || !detailsView) return;

  btn.addEventListener("click", () => {
    const rawData = detailsView.dataset.crawlData;
    if (!rawData) return;
    const crawl = JSON.parse(rawData);
    
    const blob = new Blob([JSON.stringify(crawl, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crawl-results-${crawl.crawl_id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded results!", "success", 1500);
  });
}

// Download Crawl CSV file
function setupCrawlCsvDownload() {
  const btn = document.getElementById("crawl-download-csv-btn");
  const detailsView = document.getElementById("crawl-details-view");
  if (!btn || !detailsView) return;

  btn.addEventListener("click", () => {
    const rawData = detailsView.dataset.crawlData;
    if (!rawData) return;
    const crawl = JSON.parse(rawData);

    // Convert results to CSV format
    let csvContent = "URL,Title,Status Code,Error,Error Message\n";
    crawl.results.forEach(r => {
      const url = `"${(r.url || "").replace(/"/g, '""')}"`;
      const title = `"${(r.title || "").replace(/"/g, '""')}"`;
      const status = r.status_code || "";
      const error = r.error || "";
      const errMsg = `"${(r.error_message || "").replace(/"/g, '""')}"`;
      csvContent += `${url},${title},${status},${error},${errMsg}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crawl-results-${crawl.crawl_id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded CSV results!", "success", 1500);
  });
}

// ─── ENVIRONMENT VARIABLES PANEL ─────────────────────────────────────────────
const ENV_STORAGE_KEY = "crawlix_env_keys";

function envLoadKeys() {
  try { return JSON.parse(localStorage.getItem(ENV_STORAGE_KEY) || "[]"); }
  catch (e) { return []; }
}

function envSaveKeys(keys) {
  localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(keys));
}

// Mask key: show first 4 and last 4 chars with *** in between
function envMaskKey(value) {
  if (!value || value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

// Apply a key value to the raw input + state (no auth logic change needed)
function envApplyKey(value) {
  state.apiKey = value;
  const input = document.getElementById("api-key-input");
  if (input) input.value = value;
  localStorage.setItem("crawlix_key", value);
  checkHealth();
}

// Re-render chips and saved list
function envRender() {
  const keys = envLoadKeys();
  const chipsEl = document.getElementById("env-keys-chips");
  const listEl = document.getElementById("env-saved-list");

  // ── Chips ──
  if (chipsEl) {
    if (keys.length === 0) {
      chipsEl.innerHTML = "";
    } else {
      chipsEl.innerHTML = keys.map((k, i) => `
        <span class="env-chip ${k.value === state.apiKey ? 'env-chip-active' : ''}"
              data-index="${i}" title="${escapeHtml(k.label)}">
          <span class="env-chip-dot"></span>
          ${escapeHtml(k.label)}
        </span>
      `).join("");

      chipsEl.querySelectorAll(".env-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const key = keys[parseInt(chip.dataset.index, 10)];
          if (key) {
            envApplyKey(key.value);
            envRender();
            showToast(`Active key: ${key.label}`, "success", 1800);
          }
        });
      });
    }
  }

  // ── Saved list inside manage panel ──
  if (listEl) {
    if (keys.length === 0) {
      listEl.innerHTML = '<div style="font-size:11px; color:var(--text-tertiary); padding:4px 0;">No saved keys yet.</div>';
    } else {
      listEl.innerHTML = keys.map((k, i) => `
        <div class="env-saved-row" data-index="${i}">
          <span class="env-saved-label" title="${escapeHtml(k.label)}">${escapeHtml(k.label)}</span>
          <span class="env-saved-masked">${envMaskKey(k.value)}</span>
          <button class="env-use-btn ${k.value === state.apiKey ? 'env-use-active' : ''}"
                  data-index="${i}">${k.value === state.apiKey ? '✓ Active' : 'Use'}</button>
          <button class="env-delete-btn" data-index="${i}" title="Delete">✕</button>
        </div>
      `).join("");

      listEl.querySelectorAll(".env-use-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const key = keys[parseInt(btn.dataset.index, 10)];
          if (key) {
            envApplyKey(key.value);
            envRender();
            showToast(`Active key: ${key.label}`, "success", 1800);
          }
        });
      });

      listEl.querySelectorAll(".env-delete-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.index, 10);
          const key = keys[idx];
          if (!confirm(`Delete key "${key.label}"?`)) return;
          keys.splice(idx, 1);
          envSaveKeys(keys);
          // If deleted key was active, clear the input
          if (key.value === state.apiKey) {
            envApplyKey("");
          }
          envRender();
          showToast("Key deleted", "info", 1500);
        });
      });
    }
  }
}

function setupEnvPanel() {
  const toggleBtn = document.getElementById("env-manage-toggle");
  const managePanel = document.getElementById("env-manage-panel");
  const addBtn = document.getElementById("env-add-btn");
  const labelInput = document.getElementById("env-new-label");
  const valueInput = document.getElementById("env-new-value");

  if (!toggleBtn || !managePanel) return;

  // Toggle manage panel open/close
  toggleBtn.addEventListener("click", () => {
    const open = !managePanel.classList.contains("hidden");
    managePanel.classList.toggle("hidden", open);
    toggleBtn.classList.toggle("active", !open);
  });

  // Add new key
  const doAdd = () => {
    const label = labelInput?.value.trim();
    const value = valueInput?.value.trim();
    if (!label) { showToast("Enter a label for this key", "error", 2000); return; }
    if (!value) { showToast("Enter the API key value", "error", 2000); return; }

    const keys = envLoadKeys();
    // Prevent duplicate labels
    if (keys.some(k => k.label.toLowerCase() === label.toLowerCase())) {
      showToast(`A key named "${label}" already exists`, "error", 2000);
      return;
    }
    keys.push({ label, value, createdAt: new Date().toISOString() });
    envSaveKeys(keys);
    if (labelInput) labelInput.value = "";
    if (valueInput) valueInput.value = "";
    envRender();
    showToast(`Saved key: ${label}`, "success", 2000);
  };

  if (addBtn) addBtn.addEventListener("click", doAdd);

  // Allow Enter key in value input to save
  if (valueInput) {
    valueInput.addEventListener("keydown", e => {
      if (e.key === "Enter") doAdd();
    });
  }

  // Initial render
  envRender();

  // If a saved key matches the current raw key input, reflect it
  const rawInput = document.getElementById("api-key-input");
  if (rawInput) {
    rawInput.addEventListener("input", e => {
      state.apiKey = e.target.value.trim();
      localStorage.setItem("crawlix_key", state.apiKey);
      envRender(); // refresh active chip highlight
      checkHealth();
    });
  }
}

// ─── REQUEST HISTORY ─────────────────────────────────────────────────────────
function saveToHistory(req, response) {
  try {
    let history = JSON.parse(localStorage.getItem("crawlix_history") || "[]");
    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      method: req.method || "GET",
      url: req.url,
      output_format: req.output_format,
      render_js: req.render_js,
      status_code: response.status_code,
      latency_ms: response.latency_ms,
      req,
      response
    });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    localStorage.setItem("crawlix_history", JSON.stringify(history));
  } catch (e) { /* ignore storage errors */ }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  let history;
  try {
    history = JSON.parse(localStorage.getItem("crawlix_history") || "[]");
  } catch (e) {
    history = [];
  }
  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">No requests yet — send a request to start building history.</div>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="history-item" data-id="${h.id}" role="button" tabindex="0" aria-label="Replay ${h.method} ${h.url}">
      <span class="history-method">${escapeHtml(h.method)}</span>
      <span class="history-url" title="${escapeHtml(h.url)}">${escapeHtml(h.url)}</span>
      <span class="history-meta">
        <span class="status-pill ${h.status_code >= 200 && h.status_code < 300 ? 'status-2xx' : 'status-4xx'}" style="font-size:10px;padding:2px 6px;">${h.status_code}</span>
        &nbsp;${h.latency_ms}ms &nbsp;${timeAgo(h.timestamp)}
      </span>
    </div>
  `).join("");

  list.querySelectorAll(".history-item").forEach(item => {
    const handler = () => {
      const h = history.find(x => x.id === parseInt(item.dataset.id, 10));
      if (!h) return;
      // Restore request fields
      const urlInput = document.getElementById("url-input");
      const methodSelect = document.getElementById("method-select");
      if (urlInput) urlInput.value = h.url;
      if (methodSelect) methodSelect.value = h.method;
      // Navigate to builder
      document.getElementById("nav-builder")?.click();
      // Restore last response for viewing
      state.lastResponse = h.response;
      state.lastRequest = h.req;
      const respPanel = document.getElementById("response-panel");
      if (respPanel) respPanel.classList.remove("hidden");
      updateMetaBar(h.response);
      renderTab(state.activeTab);
      showToast(`Loaded: ${h.method} ${h.url.substring(0, 40)}…`, "info", 2000);
    };
    item.addEventListener("click", handler);
    item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") handler(); });
  });
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+Enter or Cmd+Enter → Send request
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      document.getElementById("send-btn")?.click();
      return;
    }
    // Ctrl+K or Cmd+K → Focus URL input
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      const urlInput = document.getElementById("url-input");
      if (urlInput) {
        document.getElementById("nav-builder")?.click();
        urlInput.focus();
        urlInput.select();
      }
    }
  });
}

// ─── PREVIEW THEME TOGGLE ─────────────────────────────────────────────────────
function setupPreviewThemeToggle() {
  const tabContent = document.getElementById("content-preview");
  if (!tabContent) return;
  const btn = document.createElement("button");
  btn.className = "preview-theme-btn";
  btn.textContent = "☀ Light preview";
  btn.title = "Toggle preview background (dark/light)";
  btn.addEventListener("click", () => {
    state.previewDark = !state.previewDark;
    btn.textContent = state.previewDark ? "☀ Light preview" : "☾ Dark preview";
    if (state.lastResponse) renderTab("preview");
  });
  tabContent.insertBefore(btn, tabContent.firstChild);
}

// ─── VISIBILITY-AWARE POLLING ─────────────────────────────────────────────────
function visibleInterval(fn, ms) {
  let id = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  return id;
}

// Init ON DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  setupRouting();
  setupActionBuilder();
  setupCrawlDownload();
  setupCrawlCsvDownload();
  setupJsRenderingToggle();
  setupOutputFormatToggle();
  setupKeyboardShortcuts();
  setupPreviewThemeToggle();

  // History clear button
  const historyClearBtn = document.getElementById("history-clear-btn");
  if (historyClearBtn) {
    historyClearBtn.addEventListener("click", () => {
      if (!confirm("Clear all request history?")) return;
      localStorage.removeItem("crawlix_history");
      renderHistory();
      showToast("History cleared", "info", 1500);
    });
  }
  // Add Header / Cookie builders
  const addHeaderBtn = document.getElementById("add-header-btn");
  if (addHeaderBtn) {
    addHeaderBtn.addEventListener("click", () => createKvRow("headers-list"));
  }
  const addCookieBtn = document.getElementById("add-cookie-btn");
  if (addCookieBtn) {
    addCookieBtn.addEventListener("click", () => createKvRow("cookies-list"));
  }

  // Add defaults
  createKvRow("headers-list", "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  createKvRow("headers-list", "Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  createKvRow("cookies-list");

  // Iframe selector communication listener
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "crawlix-selector-select") {
      const selector = e.data.selector;
      // Open advanced settings if hidden
      const tuningToggle = document.querySelector("#tuning-collapsible .collapsible-toggle");
      if (tuningToggle && tuningToggle.getAttribute("aria-expanded") !== "true") {
        tuningToggle.click();
      }
      const cssInput = document.getElementById("css-selector-input");
      if (cssInput) {
        cssInput.value = selector;
        showToast("Auto-filled Target CSS Selector: " + selector, "success", 2500);
      }
    }
  });

  // Crawl Start Button Binding
  const crawlStartBtn = document.getElementById("crawl-start-btn");
  if (crawlStartBtn) {
    crawlStartBtn.addEventListener("click", startCrawlJob);
  }

  // Environment Variables Panel (manages API key saving, switching, and raw input sync)
  setupEnvPanel();
  // Restore last active key into input on load
  const apiKeyInput = document.getElementById("api-key-input");
  if (apiKeyInput) apiKeyInput.value = state.apiKey;

  // Collapsible bodies toggle logic
  document.querySelectorAll(".collapsible-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const body = document.getElementById(btn.dataset.target);
      if (body) {
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!expanded));
        body.classList.toggle("hidden");
      }
    });
  });

  // Tab bindings
  TABS.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    if (btn) btn.addEventListener("click", () => switchTab(t));
  });

  // Copy code blocks utility
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      let text = "";
      if (targetId === "content-markdown") text = document.getElementById("markdown-code").textContent;
      else if (targetId === "content-code") text = document.getElementById("python-code").textContent;
      else if (targetId === "content-json") text = JSON.stringify(state.lastResponse, null, 2);
      
      navigator.clipboard.writeText(text).then(() => {
        showToast("Copied!", "success", 1500);
      });
    });
  });

  // Send request trigger
  const sendBtn = document.getElementById("send-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const urlVal = document.getElementById("url-input").value.trim();
      if (!urlVal) {
        showToast("URL is required", "error");
        return;
      }

      let jsonSchema = null;
      const schemaText = document.getElementById("json-schema-textarea").value.trim();
      if (schemaText) {
        try {
          jsonSchema = JSON.parse(schemaText);
        } catch (e) {
          showToast("Invalid JSON Schema format", "error");
          return;
        }
      }

      sendBtn.disabled = true;
      sendBtn.classList.add("loading");
      sendBtn.textContent = "Fetching…";

      const reqBody = {
        url: urlVal,
        method: document.getElementById("method-select").value,
        headers: parseKvContainer("headers-list"),
        cookies: parseKvContainer("cookies-list"),
        body: document.getElementById("body-textarea").value || null,
        session_id: state.currentSessionId || null,
        render_js: document.getElementById("render-js-checkbox").checked,
        stealth: document.getElementById("stealth-checkbox").checked,
        scroll: document.getElementById("scroll-checkbox").checked,
        strip_links: document.getElementById("strip-links-checkbox").checked,
        output_format: document.getElementById("output-format-select").value,
        impersonate: document.getElementById("impersonate-select").value,
        max_retries: 2,
        timeout: 30,
        proxy: document.getElementById("proxy-input").value.trim() ? { url: document.getElementById("proxy-input").value.trim() } : null,
        wait_for_selector: document.getElementById("wait-selector-input").value.trim() || null,
        css_selector: document.getElementById("css-selector-input").value.trim() || null,
        llm_model: document.getElementById("llm-model-input").value.trim() || null,
        json_schema: jsonSchema,
        actions: parseActions(),
        screenshot: document.getElementById("screenshot-checkbox").checked,
        screenshot_format: "png",
        extraction_prompt: document.getElementById("extraction-prompt-textarea").value.trim() || null,
        wait_until: document.getElementById("wait-until-select").value
      };
      state.lastRequest = reqBody;

      try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        
        const res = await fetch(API_BASE + "/fetch", {
          method: "POST",
          headers,
          body: JSON.stringify(reqBody)
        });
        
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast("Error " + res.status + ": " + (err.detail || "Request failed"), "error");
          return;
        }
        
        const data = await res.json();
        state.lastResponse = data;
        if (data.session_id) state.currentSessionId = data.session_id;

        // Save to history
        saveToHistory(reqBody, data);

        const respPanel = document.getElementById("response-panel");
        if (respPanel) respPanel.classList.remove("hidden");
        
        updateMetaBar(data);
        renderTab(state.activeTab);
        renderSessions();
        
        if (!data.success) {
          showToast("Fetch returned error: " + (data.error || "unknown"), "warning");
        }
      } catch (e) {
        showToast("Connection failed — is the server running?", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove("loading");
        sendBtn.textContent = "Send request";
      }
    });
  }

  // Refresh active sessions manual button trigger
  const sessionRefreshBtn = document.getElementById("session-refresh-btn");
  if (sessionRefreshBtn) {
    sessionRefreshBtn.addEventListener("click", () => {
      renderSessions();
      showToast("Sessions refreshed", "info", 1500);
    });
  }

  // Initial loads and background intervals
  checkHealth();
  renderSessions();
  renderCrawls();
  
  // Visibility-aware polling (pauses when tab is not visible to save resources)
  visibleInterval(checkHealth, 30000);
  visibleInterval(renderSessions, 30000);
  setupCrawlPolling();
});
