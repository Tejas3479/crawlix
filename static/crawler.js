import { state, API_BASE } from './state.js';
import { timeAgo, escapeHtml, showToast, animateListItems, animateModalOpen, getMotion, renderSkeletonCards, focusModal, blurModal } from './ui.js';
import { isValidHttpUrl } from './editor.js';
// We will rely on custom events or app.js exports for tab switching, 
// to avoid circular imports.
import { switchTab, renderTab } from './app.js';

let activeCrawlPollInterval = null;
let currentCrawlObj = null;
let currentCrawlPage = 1;
const CRAWL_PAGE_SIZE = 15;

function renderCrawlResultsTable(page = 1) {
  const tableBody = document.getElementById("crawl-results-table-body");
  const paginationControls = document.getElementById("crawl-pagination-controls");
  if (!tableBody || !currentCrawlObj) return;

  const results = currentCrawlObj.results || [];
  if (results.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-tertiary);">No pages scraped successfully yet</td></tr>';
    if (paginationControls) paginationControls.style.display = "none";
    return;
  }

  const totalPages = Math.ceil(results.length / CRAWL_PAGE_SIZE);
  const p = Math.max(1, Math.min(page, totalPages));
  currentCrawlPage = p;

  const startIndex = (p - 1) * CRAWL_PAGE_SIZE;
  const slice = results.slice(startIndex, startIndex + CRAWL_PAGE_SIZE);

  tableBody.innerHTML = slice.map((r, sliceIdx) => {
    const actualIndex = startIndex + sliceIdx;
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition:background 0.15s ease;" class="crawl-result-row">
        <td style="padding: 10px 16px; font-family: monospace; font-size: 11px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.url}">${r.url}</td>
        <td style="padding: 10px 16px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.title || '—'}">${r.title || '—'}</td>
        <td style="padding: 10px 16px;">
          <span class="status-pill ${r.status_code >= 200 && r.status_code < 300 ? 'status-2xx' : 'status-4xx'}" style="font-size:10px; padding:2px 8px;">
            ${r.status_code || r.error || 'error'}
          </span>
        </td>
        <td style="padding: 10px 16px;">
          <button class="icon-btn view-scraped-btn" data-index="${actualIndex}" style="font-size:11px; padding:3px 8px;">View</button>
        </td>
      </tr>
    `;
  }).join("");

  tableBody.querySelectorAll(".view-scraped-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = currentCrawlObj.results[parseInt(btn.dataset.index, 10)];
      state.lastResponse = {
        success: !r.error,
        url: r.url,
        status_code: r.status_code || 0,
        output_format: currentCrawlObj.output_format || "markdown",
        content: r.content,
        session_id: null,
        latency_ms: 0,
        retries_used: 0,
        error: r.error || null
      };
      state.lastRequest = {
        url: r.url,
        method: "GET",
        render_js: currentCrawlObj.render_js,
        output_format: currentCrawlObj.output_format
      };
      
      document.getElementById("nav-builder").click();
      document.getElementById("response-panel").classList.remove("hidden");
      document.getElementById("response-loading")?.classList.add("hidden");
      document.getElementById("response-error")?.classList.add("hidden");
      switchTab("preview");
      showToast("Loaded page details in Request Builder", "info", 2000);
    });
  });

  if (paginationControls) {
    if (totalPages <= 1) {
      paginationControls.style.display = "none";
    } else {
      paginationControls.style.display = "flex";
      paginationControls.innerHTML = `
        <div>Page <b>${p}</b> of <b>${totalPages}</b> (${results.length} total pages)</div>
        <div style="display:flex; gap:8px;">
          <button id="crawl-page-prev" class="icon-btn" style="padding:4px 10px; font-size:12px;" ${p === 1 ? "disabled" : ""}><svg class="icon" aria-hidden="true"><use href="#icon-chevron-left"/></svg><span>Prev</span></button>
          <button id="crawl-page-next" class="icon-btn" style="padding:4px 10px; font-size:12px;" ${p === totalPages ? "disabled" : ""}><span>Next</span><svg class="icon" aria-hidden="true"><use href="#icon-chevron-right"/></svg></button>
        </div>
      `;
      const prevBtn = document.getElementById("crawl-page-prev");
      const nextBtn = document.getElementById("crawl-page-next");
      if (prevBtn) prevBtn.addEventListener("click", () => renderCrawlResultsTable(p - 1));
      if (nextBtn) nextBtn.addEventListener("click", () => renderCrawlResultsTable(p + 1));
    }
  }
}

export async function renderCrawls(animate = true) {
  const grid = document.getElementById("crawl-history-grid");
  if (!grid) return;

  if (animate && !grid.querySelector(".session-card")) {
    grid.innerHTML = renderSkeletonCards(3);
  }

  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    const res = await fetch("/api/crawl", { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    const crawls = await res.json();
    state.crawls = crawls;

    if (crawls.length === 0) {
      grid.innerHTML = '<div class="empty-state">No crawls started yet</div>';
      return;
    }

    grid.innerHTML = crawls.map(c => {
      const pagesCrawled = c.pages_crawled ?? c.stats?.pages_crawled ?? 0;
      const pct = c.max_pages > 0 ? Math.round((pagesCrawled / c.max_pages) * 100) : 0;
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
            <span>Pages: ${pagesCrawled} / ${c.max_pages}</span>
            <span>${timeAgo(c.created_at)}</span>
          </div>
          <button class="delete-crawl-btn" data-crawl-id="${c.crawl_id}" aria-label="Delete crawl" style="position:absolute; top:12px; right:12px; background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:14px;"><svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg></button>
        </div>
      `;
    }).join("");

    grid.querySelectorAll(".crawl-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-crawl-btn")) return;
        viewCrawlDetails(card.dataset.crawlId);
      });
    });

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
    if (animate) animateListItems("#crawl-history-grid > .crawl-card");
  } catch (err) {
    grid.innerHTML = `
      <div class="error-state-container">
        <span class="error-icon"><svg class="icon" aria-hidden="true"><use href="#icon-alert"/></svg></span>
        <span>${escapeHtml(err.message || "Error loading crawls")}</span>
        <button class="error-retry-btn" id="crawls-retry-btn"><svg class="icon" aria-hidden="true"><use href="#icon-refresh"/></svg><span>Retry</span></button>
      </div>`;
    const retryBtn = document.getElementById("crawls-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", () => renderCrawls());
    showToast("Error loading crawls: " + (err.message || "Network error"), "error");
  }
}

export async function startCrawlJob() {
  const crawlUrlInput = document.getElementById("crawl-url-input");
  let urlVal = crawlUrlInput ? crawlUrlInput.value.trim() : "";
  if (!urlVal) {
    showToast("URL is required to start crawl", "error");
    if (crawlUrlInput) crawlUrlInput.focus();
    return;
  }

  if (!urlVal.startsWith("http://") && !urlVal.startsWith("https://")) {
    urlVal = "https://" + urlVal;
    if (crawlUrlInput) crawlUrlInput.value = urlVal;
  }

  if (!isValidHttpUrl(urlVal)) {
    showToast("Please enter a valid HTTP or HTTPS crawl URL (e.g. https://example.com)", "error");
    if (crawlUrlInput) crawlUrlInput.focus();
    return;
  }

  const startBtn = document.getElementById("crawl-start-btn");
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  startBtn.setAttribute("aria-busy", "true");
  document.getElementById("crawler-section")?.setAttribute("aria-busy", "true");

  // Parse destinations
  let destinations = [];
  const destInput = document.getElementById("crawl-destinations-input");
  if (destInput && destInput.value.trim()) {
    destinations = destInput.value.split(",").map(s => s.trim()).filter(Boolean);
  }

  const payload = {
    url: urlVal,
    max_pages: parseInt(document.getElementById("crawl-max-pages-select").value, 10),
    max_depth: 3,
    render_js: document.getElementById("crawl-render-js-checkbox").checked,
    stealth: document.getElementById("crawl-stealth-checkbox").checked,
    output_format: document.getElementById("crawl-format-select").value,
    limit_domain: document.getElementById("crawl-limit-domain-checkbox").checked,
    destinations: destinations,
    actions: [],
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
    showToast("Connection failed: " + (err.message || "Unknown error"), "error");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start Crawl";
    startBtn.setAttribute("aria-busy", "false");
    document.getElementById("crawler-section")?.setAttribute("aria-busy", "false");
  }
}

export function setupCrawlPolling() {
  if (activeCrawlPollInterval) clearInterval(activeCrawlPollInterval);
  activeCrawlPollInterval = setInterval(async () => {
    await renderCrawls(false);
    
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

export async function viewCrawlDetails(crawlId, silent = false) {
  const detailsView = document.getElementById("crawl-details-view");
  const tableBody = document.getElementById("crawl-results-table-body");
  const titleEl = document.getElementById("crawl-details-title");
  if (!detailsView || !tableBody || !titleEl) return;

  detailsView.dataset.currentCrawlId = crawlId;
  if (!silent) {
    detailsView.classList.remove("hidden");
    detailsView.setAttribute("aria-busy", "true");
    titleEl.textContent = "Loading crawl results…";
    tableBody.innerHTML = `
      <tr>
        <td colspan="4">
          <div class="loading-state-container">
            <div class="spinner"></div>
            <span>Fetching crawl results...</span>
          </div>
        </td>
      </tr>`;
  }

  const renderErrorState = (msg) => {
    detailsView.setAttribute("aria-busy", "false");
    titleEl.textContent = "Error loading results";
    tableBody.innerHTML = `
      <tr>
        <td colspan="4">
          <div class="error-state-container">
            <span class="error-icon"><svg class="icon" aria-hidden="true"><use href="#icon-alert"/></svg></span>
            <span>${escapeHtml(msg)}</span>
            <button class="error-retry-btn" onclick="viewCrawlDetails('${crawlId}')"><svg class="icon" aria-hidden="true"><use href="#icon-refresh"/></svg><span>Retry</span></button>
          </div>
        </td>
      </tr>`;
  };

  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;
    const res = await fetch(`/api/crawl/${crawlId}`, { headers });
    if (!res.ok) {
      renderErrorState(`Failed to load crawl results (HTTP ${res.status})`);
      return;
    }
    const crawl = await res.json();
    const pagesCrawled = crawl.stats?.pages_crawled ?? 0;
    titleEl.textContent = `Crawl Results: ${crawl.url} (${pagesCrawled} pages)`;
    detailsView.dataset.crawlData = JSON.stringify(crawl);

    const totalPages = crawl.results.length;
    let successfulPages = 0;
    const statusCounts = {};

    crawl.results.forEach(r => {
      if (r.status_code && r.status_code >= 200 && r.status_code < 400) successfulPages++;
      const code = r.status_code || r.error || "error";
      statusCounts[code] = (statusCounts[code] || 0) + 1;
    });

    const successRate = totalPages > 0 ? Math.round((successfulPages / totalPages) * 100) : 0;
    const statusCodeStr = Object.entries(statusCounts).map(([code, count]) => `${code}: ${count}`).join(", ");

    const successRateEl = document.getElementById("stat-success-rate");
    const pagesScrapedEl = document.getElementById("stat-pages-scraped");
    const statusCodesEl = document.getElementById("stat-status-codes");

    if (successRateEl) {
      successRateEl.textContent = `${successRate}%`;
      successRateEl.style.color = successRate > 80 ? "var(--success-color)" : (successRate > 50 ? "var(--warning-color)" : "var(--danger-color)");
    }
    if (pagesScrapedEl) {
      const pagesCrawled = crawl.stats?.pages_crawled ?? 0;
      pagesScrapedEl.textContent = `${pagesCrawled} / ${crawl.max_pages}`;
    }
    if (statusCodesEl) {
      statusCodesEl.textContent = statusCodeStr || "—";
      statusCodesEl.title = statusCodeStr;
    }

    currentCrawlObj = crawl;
    detailsView.setAttribute("aria-busy", "false");
    renderCrawlResultsTable(1);
  } catch (err) {
    detailsView.setAttribute("aria-busy", "false");
    renderErrorState(err.message || "Network error loading crawl results");
  }
}

export function setupCrawlDownload() {
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
    a.download = `crawl-results-${(crawl.id || crawl.crawl_id).slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded results!", "success", 1500);
  });
}

export function setupCrawlCsvDownload() {
  const btn = document.getElementById("crawl-download-csv-btn");
  const detailsView = document.getElementById("crawl-details-view");
  if (!btn || !detailsView) return;

  btn.addEventListener("click", () => {
    const rawData = detailsView.dataset.crawlData;
    if (!rawData) return;
    const crawl = JSON.parse(rawData);

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
    a.download = `crawl-results-${(crawl.id || crawl.crawl_id).slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded CSV results!", "success", 1500);
  });
}

export function setupCrawlScheduling() {
  const schedBtn = document.getElementById("crawl-schedule-btn");
  const modal = document.getElementById("schedule-modal");
  const cancelBtn = document.getElementById("schedule-cancel-btn");
  const confirmBtn = document.getElementById("schedule-confirm-btn");
  
  if (!schedBtn || !modal) return;
  
  schedBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    animateModalOpen(modal, modal.querySelector(".lightbox-content"));
    focusModal(modal, { focusTarget: document.getElementById("schedule-cron-input") });
  });
  
  const closeModal = () => {
    blurModal(modal, { restoreFocus: true });
    const Motion = getMotion();
    if (Motion && typeof Motion.animate === "function") {
      Motion.animate(modal, { opacity: 0 }, { duration: 0.18 }).finished.then(() => {
        modal.classList.add("hidden");
      }).catch(() => modal.classList.add("hidden"));
    } else {
      modal.classList.add("hidden");
    }
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });

  cancelBtn.addEventListener("click", closeModal);
  
  confirmBtn.addEventListener("click", async () => {
    const cronExpr = document.getElementById("schedule-cron-input").value.trim();
    if (!cronExpr) {
      showToast("Cron expression is required", "error");
      return;
    }
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Scheduling...";
    confirmBtn.setAttribute("aria-busy", "true");
    
    // Construct the payload exactly as startCrawlJob does
    const crawlUrlInput = document.getElementById("crawl-url-input");
    let urlVal = crawlUrlInput ? crawlUrlInput.value.trim() : "";
    if (!urlVal || !isValidHttpUrl(urlVal.startsWith("http") ? urlVal : "https://" + urlVal)) {
      showToast("A valid URL is required to schedule a crawl", "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Schedule";
      return;
    }
    if (!urlVal.startsWith("http")) urlVal = "https://" + urlVal;
    
    // Destinations
    let destinations = [];
    const destInput = document.getElementById("crawl-destinations-input");
    if (destInput && destInput.value.trim()) {
      destinations = destInput.value.split(",").map(s => s.trim()).filter(Boolean);
    }
    
    const payload = {
      url: urlVal,
      max_pages: parseInt(document.getElementById("crawl-max-pages-select").value, 10),
      max_depth: 3,
      render_js: document.getElementById("crawl-render-js-checkbox").checked,
      stealth: document.getElementById("crawl-stealth-checkbox").checked,
      output_format: document.getElementById("crawl-format-select").value,
      limit_domain: document.getElementById("crawl-limit-domain-checkbox").checked,
      destinations: destinations,
      actions: [],
      extraction_prompt: document.getElementById("crawl-extraction-prompt")?.value.trim() || null
    };
    
    try {
      const headers = { "Content-Type": "application/json" };
      if (state.apiKey) headers["x-api-key"] = state.apiKey;
      
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers,
        body: JSON.stringify({
          cron_expression: cronExpr,
          payload: payload
        })
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast("Schedule failed: " + (err.detail || "Invalid cron"), "error");
        return;
      }
      
      showToast("Crawl scheduled successfully!", "success", 2000);
      blurModal(modal, { restoreFocus: true });
      modal.classList.add("hidden");
    } catch(err) {
      showToast("Schedule error: " + (err.message || "Connection failed"), "error");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Schedule";
      confirmBtn.setAttribute("aria-busy", "false");
    }
  });
}

window.viewCrawlDetails = viewCrawlDetails;
