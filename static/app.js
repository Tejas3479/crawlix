import { state, API_BASE, TABS, MAX_HISTORY, saveBuilderState, loadBuilderState } from './state.js';
import { showToast, timeAgo, escapeHtml, updateMetaBar, initFramerMotion } from './ui.js';
import { checkHealth, fetchSessions, deleteSessionAPI, performFetchAPI, saveToHistory, downloadSessionsCsv, downloadSessionsJson } from './api.js';
import { setupJsRenderingToggle, setupOutputFormatToggle, setupActionBuilder, parseActions, setupEnvPanel, createKvRow, parseKvContainer, generatePythonSnippet, isValidHttpUrl, validateJsonSchema, validateRequestBody, restoreBuilderStateUI } from './editor.js';
import { renderCrawls, startCrawlJob, setupCrawlPolling, setupCrawlDownload, setupCrawlCsvDownload, setupCrawlScheduling } from './crawler.js';

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
    // renderJsonTree imported from ui, but we avoided circular dep by inline rendering it or using it from ui.js
    // wait, renderJsonTree is in ui.js. We need to import it. I'll add it to imports from ui.js dynamically here if needed
    // Let me just import it: Wait, I missed it in the ui import above!
  }
}

// Ensure json rendering uses ui.js
import { renderJsonTree } from './ui.js';
// Patch renderTab for json
const originalRenderTab = renderTab;
export function renderTabPatched(tabName) {
    if (tabName === 'json' && state.lastResponse) {
       const tree = document.getElementById("json-tree");
       if (tree) tree.innerHTML = renderJsonTree(state.lastResponse, 0);
    } else {
        originalRenderTab(tabName);
    }
}


export async function renderSessions() {
  const grid = document.getElementById("session-grid");
  if (!grid) return;
  
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
        <button class="delete-session-btn" data-session-id="${s.session_id}" title="Delete session">✕</button>
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
  } catch (e) { }
}

export function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  let history;
  try { history = JSON.parse(localStorage.getItem("crawlix_history") || "[]"); } 
  catch (e) { history = []; }
  
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
      renderTabPatched(state.activeTab);
      showToast(`Loaded: ${h.method} ${h.url.substring(0, 40)}…`, "info", 2000);
    };
    item.addEventListener("click", handler);
    item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") handler(); });
  });
}

function setupRouting() {
  const links = {
    "nav-builder": "builder-section",
    "nav-crawler": "crawler-section",
    "nav-history": "history-section",
    "nav-sessions": "session-panel"
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

      if (sectionId === "session-panel") renderSessions();
      if (sectionId === "history-section") renderHistory();
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
  btn.textContent = "☀ Light preview";
  btn.title = "Toggle preview background (dark/light)";
  btn.addEventListener("click", () => {
    state.previewDark = !state.previewDark;
    btn.textContent = state.previewDark ? "☀ Light preview" : "☾ Dark preview";
    if (state.lastResponse) renderTabPatched("preview");
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
        json_schema: schemaResult.schema,
        actions: parseActions(),
        screenshot: document.getElementById("screenshot-checkbox").checked,
        screenshot_format: "png",
        extraction_prompt: document.getElementById("extraction-prompt-textarea").value.trim() || null,
        wait_until: document.getElementById("wait-until-select").value
      };
      
      state.lastRequest = reqBody;
      saveBuilderState(); // User requirement: State Persistence

      try {
        const data = await performFetchAPI(reqBody);
        state.lastResponse = data;
        if (data.session_id) state.currentSessionId = data.session_id;

        saveToHistory(reqBody, data);

        const respPanel = document.getElementById("response-panel");
        if (respPanel) respPanel.classList.remove("hidden");
        
        updateMetaBar(data);
        renderTabPatched(state.activeTab);
        renderSessions();
        
        if (!data.success) {
          showToast("Fetch returned error: " + (data.error || "unknown"), "warning");
        }
      } catch (e) {
        showToast(e.message || "Connection failed", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove("loading");
        sendBtn.textContent = "Send request";
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

  initFramerMotion();
});
