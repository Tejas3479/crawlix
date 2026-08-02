import { state, API_BASE, MAX_HISTORY } from './state.js';
import { timeAgo, escapeHtml, showToast, updateMetaBar } from './ui.js';

export async function checkHealth() {
  const badge = document.getElementById("status-badge");
  if (!badge) return;
  
  try {
    const res = await fetch(API_BASE + "/api/health");
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok") {
        const headers = {};
        if (state.apiKey) headers["x-api-key"] = state.apiKey;
        
        const authRes = await fetch(API_BASE + "/api/sessions", { headers });
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

export async function fetchSessions() {
  const headers = {};
  if (state.apiKey) headers["x-api-key"] = state.apiKey;
  const res = await fetch(API_BASE + "/api/sessions", { headers });
  if (!res.ok) throw new Error("Failed to fetch sessions: " + res.statusText);
  return await res.json();
}

export async function deleteSessionAPI(sid) {
  const headers = { "Content-Type": "application/json" };
  if (state.apiKey) headers["x-api-key"] = state.apiKey;
  const res = await fetch(API_BASE + "/api/sessions/" + sid, { method: "DELETE", headers });
  if (!res.ok) throw new Error("Failed to delete: " + res.statusText);
  return res.ok;
}

export async function performFetchAPI(reqBody) {
  const headers = { "Content-Type": "application/json" };
  if (state.apiKey) headers["x-api-key"] = state.apiKey;
  
  const res = await fetch(API_BASE + "/fetch", {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody)
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Error " + res.status + ": " + (err.detail || "Request failed"));
  }
  
  return await res.json();
}

export function saveToHistory(req, response) {
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
  } catch (e) { }
}

// Added Data Export for Sessions (User Requested)
export function downloadSessionsCsv(sessions) {
  if (!sessions || sessions.length === 0) {
    showToast("No active sessions to download", "warning");
    return;
  }
  let csvContent = "Session ID,Engine,Requests,Cookies,Created At,Last Active\n";
  sessions.forEach(s => {
    csvContent += \`"\${s.session_id}","\${s.engine}",\${s.request_count},\${s.cookie_count},"\${s.created_at}","\${s.last_active}"\n\`;
  });
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = \`crawlix-sessions-\${Date.now()}.csv\`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Sessions CSV downloaded", "success", 1500);
}

// Added Data Export for Sessions JSON
export function downloadSessionsJson(sessions) {
  if (!sessions || sessions.length === 0) {
    showToast("No active sessions to download", "warning");
    return;
  }
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = \`crawlix-sessions-\${Date.now()}.json\`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Sessions JSON downloaded", "success", 1500);
}
