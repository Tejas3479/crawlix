import { state, API_BASE, TABS, MAX_HISTORY, saveBuilderState, loadBuilderState } from './state.js';
import { showToast, timeAgo, escapeHtml, updateMetaBar, initCardEffects, animateViewEntrance, animateListItems, renderJsonTree, renderSkeletonCards } from './ui.js';
import { checkHealth, fetchSessions, deleteSessionAPI, performFetchAPI, saveToHistory, downloadSessionsCsv, downloadSessionsJson } from './api.js';
import { setupJsRenderingToggle, setupOutputFormatToggle, setupActionBuilder, parseActions, setupEnvPanel, createKvRow, parseKvContainer, generatePythonSnippet, isValidHttpUrl, validateJsonSchema, validateRequestBody, restoreBuilderStateUI } from './editor.js';
import { renderCrawls, startCrawlJob, setupCrawlPolling, setupCrawlDownload, setupCrawlCsvDownload, setupCrawlScheduling } from './crawler.js';
import { initAdmin, renderAdmin } from './admin.js';

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Crawlix Error Boundary] Unhandled Promise Rejection:", event.reason);
  const msg = event.reason?.message || (typeof event.reason === "string" ? event.reason : "An unexpected error occurred");
  showToast("Background error: " + msg, "error", 4000);
});

window.onerror = function (message, source, lineno, colno, error) {
  console.error("[Crawlix Error Boundary] Global JS Error:", message, source, lineno, colno, error);
  showToast("UI Error: " + message, "error", 4000);
  return false;
};

export function switchTab(tabName) {
  state.activeTab = tabName;
  TABS.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    const content = document.getElementById("content-" + t);
    if (btn) btn.classList.toggle("tab-active", t === tabName);
    if (content) content.classList.toggle("hidden", t !== tabName);
  });
  if (state.lastResponse) renderTab(tabName);
}

export function renderTab(tabName) {
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
    tree.innerHTML = renderJsonTree(state.lastResponse, 0);
  }
}


let sessionsHydrated = false;

export async function renderSessions() {
  const grid = document.getElementById("session-grid");
  if (!grid) return;

  if (!sessionsHydrated) {
    sessionsHydrated = true;
    grid.innerHTML = renderSkeletonCards(3);
  }
  
  try {
    const sessions = await fetchSessions();
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
        <button class="delete-session-btn" data-session-id="${s.session_id}" title="Delete session" aria-label="Delete session ${escapeHtml(s.session_id)}"><svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg></button>
      </div>
    `).join("");
    
    grid.querySelectorAll(".delete-session-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sessionId;
        if (!confirm("Delete session " + sid.slice(0, 8) + "…?")) return;
        try {
          const ok = await deleteSessionAPI(sid);
          if (ok) {
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
    animateListItems("#session-grid > .session-card");
  } catch (e) {
    grid.innerHTML = `
      <div class="error-state-container">
        <span class="error-icon"><svg class="icon" aria-hidden="true"><use href="#icon-alert"/></svg></span>
        <span>${escapeHtml(e.message || "Network error")}</span>
        <button class="error-retry-btn" id="sessions-retry-btn"><svg class="icon" aria-hidden="true"><use href="#icon-refresh"/></svg><span>Retry</span></button>
      </div>`;
    const retryBtn = document.getElementById("sessions-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", () => renderSessions());
    showToast("Error loading sessions: " + (e.message || "Network error"), "error");
  }
}

export function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  let history;
  try { history = JSON.parse(localStorage.getItem("crawlix_history") || "[]"); } 
  catch (e) { history = []; }
  
  if (history.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 24px; text-align: center;">
        <div style="margin-bottom: 8px; font-weight: 500; color: var(--text-primary);">Welcome to Crawlix</div>
        <div style="margin-bottom: 16px; font-size: 13px; color: var(--text-secondary);">Set API key &rarr; Fetch example.com</div>
        <button id="first-run-fetch-btn" class="send-btn" style="padding: 8px 16px; font-size: 13px;">Set API key &rarr; Fetch example.com</button>
      </div>`;
    const firstRunBtn = document.getElementById("first-run-fetch-btn");
    if (firstRunBtn) {
      firstRunBtn.addEventListener("click", () => {
        if (!state.apiKey) {
          const manageToggle = document.getElementById("env-manage-toggle");
          if (manageToggle) manageToggle.click();
          showToast("Please enter and save your API key first!", "warning", 3500);
          const keyInput = document.getElementById("api-key-input");
          if (keyInput) keyInput.focus();
          return;
        }
        const urlInput = document.getElementById("url-input");
        if (urlInput) urlInput.value = "https://example.com";
        const sendBtn = document.getElementById("send-btn");
        if (sendBtn) sendBtn.click();
      });
    }
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
      
      const urlInput = document.getElementById("url-input");
      const methodSelect = document.getElementById("method-select");
      if (urlInput) urlInput.value = h.url;
      if (methodSelect) methodSelect.value = h.method;
      
      document.getElementById("nav-builder")?.click();
      
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
  animateListItems("#history-list > .history-item");
}

function setupRouting() {
  const links = {
    "nav-builder": "builder-section",
    "nav-crawler": "crawler-section",
    "nav-history": "history-section",
    "nav-sessions": "session-panel",
    "nav-admin": "admin-section"
  };
  const allSections = Object.values(links);

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
      animateViewEntrance("#" + sectionId);

      if (sectionId === "session-panel") renderSessions();
      if (sectionId === "history-section") renderHistory();
      if (sectionId === "admin-section") renderAdmin();
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      document.getElementById("send-btn")?.click();
      return;
    }
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

function setupPreviewThemeToggle() {
  const tabContent = document.getElementById("content-preview");
  if (!tabContent) return;
  const btn = document.createElement("button");
  btn.className = "preview-theme-btn";
  btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-sun"/></svg><span>Light preview</span>';
  btn.title = "Toggle preview background (dark/light)";
  btn.addEventListener("click", () => {
    state.previewDark = !state.previewDark;
    btn.innerHTML = state.previewDark
      ? '<svg class="icon" aria-hidden="true"><use href="#icon-sun"/></svg><span>Light preview</span>'
      : '<svg class="icon" aria-hidden="true"><use href="#icon-moon"/></svg><span>Dark preview</span>';
    if (state.lastResponse) renderTab("preview");
  });
  tabContent.insertBefore(btn, tabContent.firstChild);
}

function visibleInterval(fn, ms) {
  let id = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  return id;
}

// Attach export functionality to session buttons (needs HTML update)
function attachSessionExportListeners() {
  const csvBtn = document.getElementById("session-export-csv-btn");
  const jsonBtn = document.getElementById("session-export-json-btn");
  if (csvBtn) csvBtn.addEventListener("click", () => downloadSessionsCsv(state.sessions));
  if (jsonBtn) jsonBtn.addEventListener("click", () => downloadSessionsJson(state.sessions));
}


document.addEventListener("DOMContentLoaded", () => {
  setupRouting();
  setupActionBuilder();
  setupCrawlDownload();
  setupCrawlCsvDownload();
  setupCrawlScheduling();
  attachSessionExportListeners();
  setupJsRenderingToggle();
  setupOutputFormatToggle();
  setupKeyboardShortcuts();
  setupPreviewThemeToggle();

  const savedState = loadBuilderState();
  if (savedState) {
    restoreBuilderStateUI(savedState);
  }

  const historyClearBtn = document.getElementById("history-clear-btn");
  if (historyClearBtn) {
    historyClearBtn.addEventListener("click", () => {
      if (!confirm("Clear all request history?")) return;
      localStorage.removeItem("crawlix_history");
      renderHistory();
      showToast("History cleared", "info", 1500);
    });
  }
  
  const addHeaderBtn = document.getElementById("add-header-btn");
  if (addHeaderBtn) addHeaderBtn.addEventListener("click", () => createKvRow("headers-list"));
  
  const addCookieBtn = document.getElementById("add-cookie-btn");
  if (addCookieBtn) addCookieBtn.addEventListener("click", () => createKvRow("cookies-list"));

  // Only add defaults if we didn't restore from state
  if (!savedState) {
    createKvRow("headers-list", "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    createKvRow("headers-list", "Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    createKvRow("cookies-list");
  }

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "crawlix-selector-select") {
      const selector = e.data.selector;
      const fieldName = prompt("Auto-generate schema field from this element?\\n\\nEnter a field name (e.g., 'title', 'price', 'author'):");
      
      if (fieldName) {
        // Build or append to JSON Schema
        const schemaInput = document.getElementById("json-schema-textarea");
        let schemaObj = { type: "object", properties: {}, required: [] };
        
        try {
          if (schemaInput.value.trim()) {
            schemaObj = JSON.parse(schemaInput.value);
            if (schemaObj.type !== "object") schemaObj = { type: "object", properties: {}, required: [] };
            if (!schemaObj.properties) schemaObj.properties = {};
            if (!schemaObj.required) schemaObj.required = [];
          }
        } catch(err) {
          // invalid json, start fresh
        }
        
        // Use the selector as a description to guide the LLM
        schemaObj.properties[fieldName] = { type: "string", description: `Extracted from CSS selector: ${selector}` };
        if (!schemaObj.required.includes(fieldName)) schemaObj.required.push(fieldName);
        
        schemaInput.value = JSON.stringify(schemaObj, null, 2);
        
        const schemaToggle = document.querySelector("#json-schema-collapsible .collapsible-toggle");
        if (schemaToggle && schemaToggle.getAttribute("aria-expanded") !== "true") {
          schemaToggle.click();
        }
        
        showToast(`Added field '${fieldName}' to JSON schema`, "success", 2500);
      } else {
        // Fallback to updating the target CSS selector input
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
    }
  });

  const templateSelect = document.getElementById("template-select");
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (!val) return;
      
      const urlInput = document.getElementById("url-input");
      const extractInput = document.getElementById("extraction-prompt-textarea");
      const schemaInput = document.getElementById("json-schema-textarea");
      const outFormatSelect = document.getElementById("output-format-select");
      
      if (val === "amazon") {
        if (urlInput) urlInput.value = "https://www.amazon.com/dp/B08J5F3G18";
        if (extractInput) extractInput.value = "Extract the product name, price, rating out of 5, and total number of reviews.";
        if (schemaInput) schemaInput.value = JSON.stringify({
          type: "object",
          properties: {
            product_name: { type: "string" },
            price: { type: "number" },
            rating: { type: "number" },
            reviews_count: { type: "integer" }
          },
          required: ["product_name", "price"]
        }, null, 2);
        if (outFormatSelect) outFormatSelect.value = "structured";
      } else if (val === "linkedin") {
        if (urlInput) urlInput.value = "https://www.linkedin.com/in/williamhgates";
        if (extractInput) extractInput.value = "Extract the person's name, current job title, company, and a list of their past 3 roles.";
        if (schemaInput) schemaInput.value = JSON.stringify({
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            company: { type: "string" },
            past_roles: { type: "array", items: { type: "string" } }
          },
          required: ["name"]
        }, null, 2);
        if (outFormatSelect) outFormatSelect.value = "structured";
      } else if (val === "news") {
        if (urlInput) urlInput.value = "https://news.ycombinator.com/";
        if (extractInput) extractInput.value = "Extract the top 5 frontpage articles with their titles and URLs.";
        if (schemaInput) schemaInput.value = JSON.stringify({
          type: "object",
          properties: {
            articles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" }
                }
              }
            }
          }
        }, null, 2);
        if (outFormatSelect) outFormatSelect.value = "structured";
      }
      
      showToast("Template loaded!", "info", 1500);
      e.target.value = ""; // Reset dropdown
    });
  }

  const crawlStartBtn = document.getElementById("crawl-start-btn");
  if (crawlStartBtn) crawlStartBtn.addEventListener("click", startCrawlJob);

  const mapStartBtn = document.getElementById("map-start-btn");
  if (mapStartBtn) {
    mapStartBtn.addEventListener("click", async () => {
      const mapUrlInput = document.getElementById("map-url-input");
      let mapUrl = mapUrlInput ? mapUrlInput.value.trim() : "";
      if (!mapUrl) {
        showToast("Map URL is required", "error");
        if (mapUrlInput) mapUrlInput.focus();
        return;
      }
      if (!mapUrl.startsWith("http://") && !mapUrl.startsWith("https://")) {
        mapUrl = "https://" + mapUrl;
        if (mapUrlInput) mapUrlInput.value = mapUrl;
      }
      if (!isValidHttpUrl(mapUrl)) {
        showToast("Please enter a valid HTTP or HTTPS URL", "error");
        return;
      }

      const limitEl = document.getElementById("map-limit-input");
      const limit = Math.max(1, parseInt(limitEl ? limitEl.value : "100", 10) || 100);
      const resultsEl = document.getElementById("map-results");
      if (resultsEl) resultsEl.innerHTML = '<div class="empty-state" style="padding:16px;">Mapping…</div>';

      mapStartBtn.disabled = true;
      mapStartBtn.textContent = "Mapping…";
      try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch("/api/map", {
          method: "POST",
          headers,
          body: JSON.stringify({ url: mapUrl, limit })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error_message || data.detail || "Map failed");
        }
        if (!data.urls || data.urls.length === 0) {
          if (resultsEl) resultsEl.innerHTML = '<div class="empty-state" style="padding:16px;">No URLs discovered.</div>';
          return;
        }
        if (resultsEl) {
          resultsEl.innerHTML = `
            <div style="padding:8px 12px; font-size:12px; color:var(--text-secondary); border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between;">
              <span>${data.count} URL${data.count === 1 ? "" : "s"} (via ${escapeHtml(data.discovered_via || "link")})</span>
              <button id="map-copy-btn" class="icon-btn" style="height:28px; font-size:12px;">Copy</button>
            </div>
            ${data.urls.map((u) => `
              <div style="padding:6px 12px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:13px;">
                <a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color); text-decoration:none; word-break:break-all;">${escapeHtml(u)}</a>
              </div>`).join("")}
          `;
          const copyBtn = document.getElementById("map-copy-btn");
          if (copyBtn) {
            copyBtn.addEventListener("click", () => {
              navigator.clipboard.writeText(data.urls.join("\n")).then(() => showToast("URLs copied", "success", 1500));
            });
          }
        }
        showToast(`Mapped ${data.count} URLs`, "success", 2000);
      } catch (err) {
        if (resultsEl) resultsEl.innerHTML = `<div class="error-state-container" style="padding:16px;"><span>${escapeHtml(err.message || "Map failed")}</span></div>`;
        showToast("Map failed: " + (err.message || "unknown"), "error");
      } finally {
        mapStartBtn.disabled = false;
        mapStartBtn.textContent = "Map";
      }
    });
  }

  setupEnvPanel();
  const apiKeyInput = document.getElementById("api-key-input");
  if (apiKeyInput) apiKeyInput.value = state.apiKey;

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

  TABS.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    if (btn) btn.addEventListener("click", () => switchTab(t));
  });

  const tabBar = document.getElementById("tab-bar");
  if (tabBar) {
    tabBar.addEventListener("keydown", (e) => {
      const activeIdx = TABS.indexOf(state.activeTab);
      if (activeIdx === -1) return;
      let newIdx = activeIdx;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") newIdx = (activeIdx + 1) % TABS.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") newIdx = (activeIdx - 1 + TABS.length) % TABS.length;
      else if (e.key === "Home") newIdx = 0;
      else if (e.key === "End") newIdx = TABS.length - 1;
      else return;
      
      e.preventDefault();
      const targetTab = TABS[newIdx];
      switchTab(targetTab);
      const targetBtn = document.getElementById("tab-" + targetTab);
      if (targetBtn) targetBtn.focus();
    });
  }

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

  const sendBtn = document.getElementById("send-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const urlInput = document.getElementById("url-input");
      let urlVal = urlInput ? urlInput.value.trim() : "";
      if (!urlVal) {
        showToast("URL is required", "error");
        if (urlInput) urlInput.focus();
        return;
      }

      if (!urlVal.startsWith("http://") && !urlVal.startsWith("https://")) {
        urlVal = "https://" + urlVal;
        if (urlInput) urlInput.value = urlVal;
      }

      if (!isValidHttpUrl(urlVal)) {
        showToast("Please enter a valid HTTP or HTTPS URL", "error");
        if (urlInput) urlInput.focus();
        return;
      }

      const schemaText = document.getElementById("json-schema-textarea").value.trim();
      const schemaResult = validateJsonSchema(schemaText);
      if (!schemaResult.valid) {
        showToast(schemaResult.error, "error");
        return;
      }
      
      const bodyText = document.getElementById("body-textarea").value.trim();
      const bodyResult = validateRequestBody(bodyText);
      if (!bodyResult.valid) {
        showToast(bodyResult.error, "error");
        return;
      }

      sendBtn.disabled = true;
      sendBtn.classList.add("loading");
      sendBtn.textContent = "Fetching…";
      sendBtn.setAttribute("aria-busy", "true");
      document.getElementById("response-panel")?.setAttribute("aria-busy", "true");

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
        bypass_cache: document.getElementById("bypass-cache-checkbox").checked,
        output_format: document.getElementById("output-format-select").value,
        impersonate: document.getElementById("impersonate-select").value,
        max_retries: 2,
        timeout: 30,
        proxy: document.getElementById("proxy-input").value.trim() ? { url: document.getElementById("proxy-input").value.trim() } : null,
        wait_for_selector: document.getElementById("wait-selector-input").value.trim() || null,
        css_selector: document.getElementById("css-selector-input").value.trim() || null,
        llm_model: document.getElementById("llm-model-input").value.trim() || null,
        llm_provider: document.getElementById("llm-provider-select").value || "openai",
        json_schema: schemaResult.schema,
        actions: parseActions(),
        screenshot: document.getElementById("screenshot-checkbox").checked,
        screenshot_format: "png",
        extraction_prompt: document.getElementById("extraction-prompt-textarea").value.trim() || null,
        wait_until: document.getElementById("wait-until-select").value
      };
      
      state.lastRequest = reqBody;
      saveBuilderState(); // User requirement: State Persistence

      const respPanel = document.getElementById("response-panel");
      const loadingEl = document.getElementById("response-loading");
      const errorEl = document.getElementById("response-error");

      if (respPanel) {
        respPanel.classList.remove("hidden");
        animateViewEntrance(respPanel);
      }
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:20px;">
            <div class="skeleton-loader" style="height:14px; width:45%; margin-bottom:12px;"></div>
            <div class="skeleton-loader" style="height:14px; margin-bottom:10px;"></div>
            <div class="skeleton-loader" style="height:220px;"></div>
          </div>`;
        loadingEl.classList.remove("hidden");
      }
      if (errorEl) errorEl.classList.add("hidden");

      try {
        const data = await performFetchAPI(reqBody);
        state.lastResponse = data;
        if (data.session_id) state.currentSessionId = data.session_id;

        saveToHistory(reqBody, data);

        if (loadingEl) loadingEl.classList.add("hidden");

        updateMetaBar(data);
        renderTab(state.activeTab);
        renderSessions();

        if (!data.success) {
          if (errorEl) {
            errorEl.innerHTML = `
              <div class="error-state-container">
                <span class="error-icon"><svg class="icon" aria-hidden="true"><use href="#icon-alert"/></svg></span>
                <span>${escapeHtml(data.error_message || data.error || "Request failed")}</span>
              </div>`;
            errorEl.classList.remove("hidden");
          }
          showToast("Fetch returned error: " + (data.error || "unknown"), "warning");
        }
      } catch (e) {
        if (loadingEl) loadingEl.classList.add("hidden");
        if (errorEl) {
          errorEl.innerHTML = `
            <div class="error-state-container">
              <span class="error-icon"><svg class="icon" aria-hidden="true"><use href="#icon-alert"/></svg></span>
              <span>${escapeHtml(e.message || "Connection failed")}</span>
            </div>`;
          errorEl.classList.remove("hidden");
        }
        showToast(e.message || "Connection failed", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove("loading");
        sendBtn.textContent = "Send request";
        sendBtn.setAttribute("aria-busy", "false");
        document.getElementById("response-panel")?.setAttribute("aria-busy", "false");
      }
    });
  }

  const sessionRefreshBtn = document.getElementById("session-refresh-btn");
  if (sessionRefreshBtn) {
    sessionRefreshBtn.addEventListener("click", () => {
      renderSessions();
      showToast("Sessions refreshed", "info", 1500);
    });
  }

  checkHealth();
  renderSessions();
  renderCrawls();
  
  visibleInterval(checkHealth, 30000);
  visibleInterval(renderSessions, 30000);
  setupCrawlPolling();
  initAdmin();

  initCardEffects();
});
