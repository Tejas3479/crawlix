import { state } from './state.js';
import { showToast, escapeHtml, animateListItems, renderSkeletonRows } from './ui.js';

const BATCH_STORAGE_KEY = "crawlix_active_batch";
const BATCH_POLL_MS = 2000;
let batchPollTimer = null;

function saveActiveBatch(id, totalUrls) {
  try {
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ id, total_urls: totalUrls }));
  } catch (e) { /* ignore */ }
}

function loadActiveBatch() {
  try {
    const raw = localStorage.getItem(BATCH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

function stopBatchPolling() {
  if (batchPollTimer) {
    clearInterval(batchPollTimer);
    batchPollTimer = null;
  }
}

function renderBatchStatus(batchId, data) {
  const statusDiv = document.getElementById("admin-batch-status");
  if (!statusDiv) return;

  const status = data.status || "unknown";
  const total = data.total_urls || 0;
  const processed = data.processed_urls || 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const labels = {
    pending: "Queued",
    processing: "Running",
    completed: "Completed",
    failed: "Failed",
    error: "Error"
  };
  const label = labels[status] || status;
  const isBad = status === "failed" || status === "error";

  let progressHtml = "";
  if (status === "pending" || status === "processing" || status === "completed") {
    progressHtml = `
      <div style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-secondary); margin-bottom:4px;">
          <span>Progress</span>
          <span>${processed} / ${total} URLs</span>
        </div>
        <div style="background:rgba(255,255,255,0.06); height:6px; border-radius:3px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--accent-color); transition:width 0.3s ease;"></div>
        </div>
      </div>`;
  }

  let downloadHtml = "";
  if (status === "completed") {
    downloadHtml = `
      <button id="admin-batch-download-btn" class="icon-btn" style="margin-top:10px;" aria-label="Download batch results as JSON"><svg class="icon" aria-hidden="true"><use href="#icon-download"/></svg><span>Download results</span></button>`;
  }

  let errorHtml = "";
  if (isBad && data.error_message) {
    errorHtml = `<div style="margin-top:8px; font-size:12px; color:var(--danger-color);">${escapeHtml(data.error_message)}</div>`;
  }

  statusDiv.innerHTML = `
    <div style="font-size:12px; color:var(--text-secondary);">
      Batch <b style="color:var(--text-primary);">${escapeHtml(batchId)}</b> — <span style="color:${isBad ? 'var(--danger-color)' : 'var(--text-primary)'};">${escapeHtml(label)}</span>
    </div>
    ${progressHtml}
    ${downloadHtml}
    ${errorHtml}
  `;

  const downloadBtn = document.getElementById("admin-batch-download-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", async () => {
      try {
        const headers = {};
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch(`/api/crawl/batch/${batchId}/download`, { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast("Download failed: " + (err.detail || res.statusText), "error");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `batch-${batchId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Batch results downloaded!", "success", 1500);
      } catch (err) {
        showToast("Download error: " + (err.message || "Network error"), "error");
      }
    });
  }
}

async function pollBatchStatus(batchId) {
  stopBatchPolling();
  let done = false;

  const tick = async () => {
    if (done) return;
    try {
      const headers = {};
      if (state.apiKey) headers["x-api-key"] = state.apiKey;
      const res = await fetch(`/api/crawl/batch/${batchId}`, { headers });
      if (!res.ok) {
        done = true;
        stopBatchPolling();
        renderBatchStatus(batchId, { status: "error", error_message: `HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      renderBatchStatus(batchId, data);
      if (data.status === "completed" || data.status === "failed") {
        done = true;
        stopBatchPolling();
      }
    } catch (err) {
      done = true;
      stopBatchPolling();
      renderBatchStatus(batchId, { status: "error", error_message: err.message || "Network error" });
    }
  };

  await tick();
  if (!done) batchPollTimer = setInterval(tick, BATCH_POLL_MS);
}

export function initAdmin() {
  const refreshBtn = document.getElementById("admin-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => renderAdmin());
  }

  const destAddBtn = document.getElementById("admin-dest-add-btn");
  if (destAddBtn) {
    destAddBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("admin-dest-name");
      const typeSelect = document.getElementById("admin-dest-type");
      const configInput = document.getElementById("admin-dest-config");

      const name = nameInput ? nameInput.value.trim() : "";
      const type = typeSelect ? typeSelect.value : "pinecone";
      const configStr = configInput ? configInput.value.trim() : "{}";

      if (!name) {
        showToast("Destination name is required", "error");
        return;
      }

      let config = {};
      try {
        config = JSON.parse(configStr || "{}");
      } catch (err) {
        showToast("Invalid Config JSON format: " + err.message, "error");
        return;
      }

      try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch("/api/destinations", {
          method: "POST",
          headers,
          body: JSON.stringify({ name, type, config })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        showToast("Destination created successfully", "success");
        if (nameInput) nameInput.value = "";
        if (configInput) configInput.value = "";
        renderAdmin();
      } catch (err) {
        showToast("Failed to create destination: " + err.message, "error");
      }
    });
  }

  const schedAddBtn = document.getElementById("admin-sched-add-btn");
  if (schedAddBtn) {
    schedAddBtn.addEventListener("click", async () => {
      const urlInput = document.getElementById("admin-sched-url");
      const cronInput = document.getElementById("admin-sched-cron");

      const url = urlInput ? urlInput.value.trim() : "";
      const cron_expression = cronInput ? cronInput.value.trim() : "";

      if (!url || !cron_expression) {
        showToast("URL and Cron Expression are required", "error");
        return;
      }

      try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch("/api/schedule", {
          method: "POST",
          headers,
          body: JSON.stringify({
            cron_expression,
            payload: { url, max_pages: 10 }
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        showToast("Schedule created successfully", "success");
        if (urlInput) urlInput.value = "";
        if (cronInput) cronInput.value = "";
        renderAdmin();
      } catch (err) {
        showToast("Failed to create schedule: " + err.message, "error");
      }
    });
  }

  const batchStartBtn = document.getElementById("admin-batch-start-btn");
  if (batchStartBtn) {
    batchStartBtn.addEventListener("click", async () => {
      const fileInput = document.getElementById("admin-batch-file");
      const webhookInput = document.getElementById("admin-batch-webhook");

      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showToast("Please select a CSV or TXT file first", "error");
        return;
      }

      const file = fileInput.files[0];
      const webhook_url = webhookInput ? webhookInput.value.trim() : "";

      const formData = new FormData();
      formData.append("file", file);
      if (webhook_url) formData.append("webhook_url", webhook_url);

      try {
        const headers = {};
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch("/api/crawl/batch", {
          method: "POST",
          headers,
          body: formData
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        const data = await res.json();
        showToast("Batch job started! ID: " + data.batch_id, "success");
        saveActiveBatch(data.batch_id, data.total_urls);
        renderBatchStatus(data.batch_id, {
          status: "pending",
          total_urls: data.total_urls,
          processed_urls: 0
        });
        pollBatchStatus(data.batch_id);
        fileInput.value = "";
      } catch (err) {
        showToast("Failed to start batch crawl: " + err.message, "error");
      }
    });
  }

  const proxyAddBtn = document.getElementById("admin-proxy-add-btn");
  if (proxyAddBtn) {
    proxyAddBtn.addEventListener("click", async () => {
      const proxyInput = document.getElementById("admin-proxy-url");
      const url = proxyInput ? proxyInput.value.trim() : "";

      if (!url) {
        showToast("Proxy URL is required", "error");
        return;
      }

      try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        const res = await fetch("/api/proxies", {
          method: "POST",
          headers,
          body: JSON.stringify({ url })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        showToast("Proxy added successfully", "success");
        if (proxyInput) proxyInput.value = "";
        renderAdmin();
      } catch (err) {
        showToast("Failed to add proxy: " + err.message, "error");
      }
    });
  }
}

export async function renderAdmin() {
  const adminSec = document.getElementById("admin-section");
  adminSec?.setAttribute("aria-busy", "true");

  const storedBatch = loadActiveBatch();
  if (storedBatch && storedBatch.id) {
    renderBatchStatus(storedBatch.id, {
      status: "pending",
      total_urls: storedBatch.total_urls || 0,
      processed_urls: 0
    });
    pollBatchStatus(storedBatch.id);
  }

  try {
    const headers = {};
    if (state.apiKey) headers["x-api-key"] = state.apiKey;

    // Load Destinations
    const destList = document.getElementById("admin-dest-list");
    if (destList) {
      destList.innerHTML = renderSkeletonRows(3);
      try {
        const res = await fetch("/api/destinations", { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        const list = await res.json();
        if (!list || list.length === 0) {
          destList.innerHTML = '<div class="empty-state">No destinations configured</div>';
        } else {
          destList.innerHTML = list.map(d => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:6px;">
              <div>
                <b style="color:var(--text-primary); font-size:13px;">${escapeHtml(d.name)}</b>
                <span style="color:var(--accent); font-size:11px; margin-left:6px;">(${escapeHtml(d.type)})</span>
              </div>
              <button class="delete-dest-btn icon-btn" data-id="${d.id}" style="color:#ef4444;" title="Delete" aria-label="Delete destination ${escapeHtml(d.name)}"><svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg></button>
            </div>
          `).join("");

          destList.querySelectorAll(".delete-dest-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
              try {
                const resDel = await fetch(`/api/destinations/${btn.dataset.id}`, { method: "DELETE", headers });
                if (!resDel.ok) {
                  const err = await resDel.json().catch(() => ({}));
                  throw new Error(err.detail || resDel.statusText);
                }
                showToast("Destination deleted", "success");
                renderAdmin();
              } catch (err) {
                showToast("Error deleting destination: " + err.message, "error");
              }
            });
          });
        }
      } catch (err) {
        destList.innerHTML = `<div class="empty-state" style="color:#ef4444;">Error: ${escapeHtml(err.message)}</div>`;
        showToast("Failed to load destinations: " + err.message, "error");
      }
    }

    // Load Schedules
    const schedList = document.getElementById("admin-sched-list");
    if (schedList) {
      schedList.innerHTML = renderSkeletonRows(3);
      try {
        const res = await fetch("/api/schedule", { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        const list = await res.json();
        if (!list || list.length === 0) {
          schedList.innerHTML = '<div class="empty-state">No schedules configured</div>';
        } else {
          schedList.innerHTML = list.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:6px;">
              <div>
                <b style="color:var(--text-primary); font-size:13px;">${escapeHtml((s.payload && s.payload.url) || 'Schedule')}</b>
                <span style="color:var(--accent); font-size:11px; margin-left:6px;">[${escapeHtml(s.cron_expression)}]</span>
              </div>
              <button class="delete-sched-btn icon-btn" data-id="${s.id}" style="color:#ef4444;" title="Delete" aria-label="Delete schedule ${escapeHtml((s.payload && s.payload.url) || s.id)}"><svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg></button>
            </div>
          `).join("");

          schedList.querySelectorAll(".delete-sched-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
              try {
                const resDel = await fetch(`/api/schedule/${btn.dataset.id}`, { method: "DELETE", headers });
                if (!resDel.ok) {
                  const err = await resDel.json().catch(() => ({}));
                  throw new Error(err.detail || resDel.statusText);
                }
                showToast("Schedule deleted", "success");
                renderAdmin();
              } catch (err) {
                showToast("Error deleting schedule: " + err.message, "error");
              }
            });
          });
        }
      } catch (err) {
        schedList.innerHTML = `<div class="empty-state" style="color:#ef4444;">Error: ${escapeHtml(err.message)}</div>`;
        showToast("Failed to load schedules: " + err.message, "error");
      }
    }

    // Load Proxies
    const proxyList = document.getElementById("admin-proxy-list");
    if (proxyList) {
      proxyList.innerHTML = renderSkeletonRows(3);
      try {
        const res = await fetch("/api/proxies", { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        const list = await res.json();
        if (!list || list.length === 0) {
          proxyList.innerHTML = '<div class="empty-state">No proxies configured</div>';
        } else {
          proxyList.innerHTML = list.map(p => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:6px;">
              <div>
                <span style="color:var(--text-primary); font-size:13px;">${escapeHtml(p.url)}</span>
                <span style="color:${p.is_active ? '#22c55e' : '#ef4444'}; font-size:11px; margin-left:6px;">
                  ${p.is_active ? 'Active' : 'Inactive'} (Fails: ${p.fail_count})
                </span>
              </div>
              <button class="delete-proxy-btn icon-btn" data-id="${p.id}" style="color:#ef4444;" title="Delete" aria-label="Delete proxy ${escapeHtml(p.url)}"><svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg></button>
            </div>
          `).join("");

          proxyList.querySelectorAll(".delete-proxy-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
              try {
                const resDel = await fetch(`/api/proxies/${btn.dataset.id}`, { method: "DELETE", headers });
                if (!resDel.ok) {
                  const err = await resDel.json().catch(() => ({}));
                  throw new Error(err.detail || resDel.statusText);
                }
                showToast("Proxy deleted", "success");
                renderAdmin();
              } catch (err) {
                showToast("Error deleting proxy: " + err.message, "error");
              }
            });
          });
        }
      } catch (err) {
        proxyList.innerHTML = `<div class="empty-state" style="color:#ef4444;">Error: ${escapeHtml(err.message)}</div>`;
        showToast("Failed to load proxies: " + err.message, "error");
      }
    }
  } finally {
    animateListItems("#admin-dest-list > div, #admin-sched-list > div, #admin-proxy-list > div");
    adminSec?.setAttribute("aria-busy", "false");
  }
}
