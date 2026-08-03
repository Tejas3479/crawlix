import { state } from './state.js';
import { showToast, escapeHtml, animateViewEntrance } from './ui.js';
import { checkHealth } from './api.js';

export function isValidHttpUrl(string) {
  if (!string || typeof string !== "string") return false;
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

export function validateJsonSchema(schemaText) {
  if (!schemaText || !schemaText.trim()) return { valid: true, schema: null };
  try {
    const parsed = JSON.parse(schemaText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: "JSON Schema must be a valid JSON Object (e.g. { \"type\": \"object\", ... })" };
    }
    return { valid: true, schema: parsed };
  } catch (e) {
    return { valid: false, error: "Invalid JSON Schema syntax: " + e.message };
  }
}

export function validateRequestBody(bodyText) {
  if (!bodyText || !bodyText.trim()) return { valid: true };
  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
    } catch (e) {
      return { valid: false, error: "Invalid JSON syntax in Request Body: " + e.message };
    }
  }
  return { valid: true };
}

export function createKvRow(containerId, key = "", value = "") {
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
    <input type="text" class="kv-key-input" placeholder="Key" value="${escapeHtml(key)}" aria-label="Header or Cookie Key" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
    <input type="text" class="kv-value-input" placeholder="Value" value="${escapeHtml(value)}" aria-label="Header or Cookie Value" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
    <button class="remove-kv-btn icon-btn" aria-label="Remove item" style="height:36px; width:36px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:6px; color:var(--danger-color); border-color:rgba(248,113,113,0.2);">✕</button>
  `;

  row.querySelector(".remove-kv-btn").addEventListener("click", () => {
    row.remove();
  });

  container.appendChild(row);
}

export function parseKvContainer(containerId) {
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

export function generatePythonSnippet(req, response) {
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

export function setupJsRenderingToggle() {
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

export function setupOutputFormatToggle() {
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

export function setupActionBuilder() {
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
      <select class="action-type-select" aria-label="Action Type" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; cursor:pointer; width:100px; flex-shrink:0;">
        <option value="click">Click</option>
        <option value="fill">Fill Input</option>
        <option value="wait">Wait</option>
        <option value="scroll">Scroll</option>
        <option value="hover">Hover</option>
        <option value="press">Press Key</option>
      </select>
      <input type="text" class="action-selector-input" placeholder="CSS Selector" aria-label="Action CSS Selector" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
      <input type="text" class="action-value-input" placeholder="Value (for Fill/Press)" aria-label="Action Value" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; flex:1;">
      <input type="number" class="action-duration-input hidden" placeholder="Seconds" aria-label="Action Duration in Seconds" style="height:36px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:#e2e2e2; font-size:12px; width:70px; flex-shrink:0;">
      <button class="remove-action-btn icon-btn" aria-label="Remove browser action" style="height:36px; width:36px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:6px; color:var(--danger-color); border-color:rgba(248,113,113,0.2);">✕</button>
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

export function parseActions() {
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

const ENV_STORAGE_KEY = "crawlix_env_keys";

export function envLoadKeys() {
  try { return JSON.parse(localStorage.getItem(ENV_STORAGE_KEY) || "[]"); }
  catch (e) { return []; }
}

export function envSaveKeys(keys) {
  localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(keys));
}

export function envMaskKey(value) {
  if (!value || value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

export function envApplyKey(value) {
  state.apiKey = value;
  const input = document.getElementById("api-key-input");
  if (input) input.value = value;
  localStorage.setItem("crawlix_key", value);
  checkHealth();
}

export function envRender() {
  const keys = envLoadKeys();
  const chipsEl = document.getElementById("env-keys-chips");
  const listEl = document.getElementById("env-saved-list");

  if (chipsEl) {
    if (keys.length === 0) {
      chipsEl.innerHTML = "";
    } else {
      chipsEl.innerHTML = keys.map((k, i) => \`
        <span class="env-chip \${k.value === state.apiKey ? 'env-chip-active' : ''}"
              data-index="\${i}" title="\${escapeHtml(k.label)}" role="button" tabindex="0"
              aria-label="Switch active key to \${escapeHtml(k.label)}"
              aria-pressed="\${k.value === state.apiKey}">
          <span class="env-chip-dot" aria-hidden="true"></span>
          \${escapeHtml(k.label)}
        </span>
      \`).join("");

      chipsEl.querySelectorAll(".env-chip").forEach(chip => {
        const activateChip = () => {
          const key = keys[parseInt(chip.dataset.index, 10)];
          if (key) {
            envApplyKey(key.value);
            envRender();
            showToast(\`Active key: \${key.label}\`, "success", 1800);
          }
        };
        chip.addEventListener("click", activateChip);
        chip.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activateChip();
          }
        });
      });
    }
  }

  if (listEl) {
    if (keys.length === 0) {
      listEl.innerHTML = '<div style="font-size:11px; color:var(--text-tertiary); padding:4px 0;">No saved keys yet.</div>';
    } else {
      listEl.innerHTML = keys.map((k, i) => \`
        <div class="env-saved-row" data-index="\${i}" role="listitem">
          <span class="env-saved-label" title="\${escapeHtml(k.label)}">\${escapeHtml(k.label)}</span>
          <span class="env-saved-masked" aria-label="Masked key value">\${envMaskKey(k.value)}</span>
          <button class="env-use-btn \${k.value === state.apiKey ? 'env-use-active' : ''}"
                  data-index="\${i}" aria-label="Use key \${escapeHtml(k.label)}">\${k.value === state.apiKey ? '✓ Active' : 'Use'}</button>
          <button class="env-delete-btn" data-index="\${i}" title="Delete" aria-label="Delete key \${escapeHtml(k.label)}">✕</button>
        </div>
      \`).join("");

      listEl.querySelectorAll(".env-use-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const key = keys[parseInt(btn.dataset.index, 10)];
          if (key) {
            envApplyKey(key.value);
            envRender();
            showToast(\`Active key: \${key.label}\`, "success", 1800);
          }
        });
      });

      listEl.querySelectorAll(".env-delete-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.index, 10);
          const key = keys[idx];
          if (!confirm(\`Delete key "\${key.label}"?\`)) return;
          keys.splice(idx, 1);
          envSaveKeys(keys);
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

export function setupEnvPanel() {
  const toggleBtn = document.getElementById("env-manage-toggle");
  const managePanel = document.getElementById("env-manage-panel");
  const addBtn = document.getElementById("env-add-btn");
  const labelInput = document.getElementById("env-new-label");
  const valueInput = document.getElementById("env-new-value");

  if (!toggleBtn || !managePanel) return;

  toggleBtn.addEventListener("click", () => {
    const isCurrentlyHidden = managePanel.classList.contains("hidden");
    managePanel.classList.toggle("hidden", !isCurrentlyHidden);
    if (isCurrentlyHidden) animateViewEntrance(managePanel);
    toggleBtn.classList.toggle("active", isCurrentlyHidden);
    toggleBtn.setAttribute("aria-expanded", String(isCurrentlyHidden));
  });

  const doAdd = () => {
    const label = labelInput?.value.trim();
    const value = valueInput?.value.trim();
    if (!label) { showToast("Enter a label for this key", "error", 2000); return; }
    if (!value) { showToast("Enter the API key value", "error", 2000); return; }

    const keys = envLoadKeys();
    if (keys.some(k => k.label.toLowerCase() === label.toLowerCase())) {
      showToast(\`A key named "\${label}" already exists\`, "error", 2000);
      return;
    }
    keys.push({ label, value, createdAt: new Date().toISOString() });
    envSaveKeys(keys);
    if (labelInput) labelInput.value = "";
    if (valueInput) valueInput.value = "";
    envRender();
    showToast(\`Saved key: \${label}\`, "success", 2000);
  };

  if (addBtn) addBtn.addEventListener("click", doAdd);

  if (valueInput) {
    valueInput.addEventListener("keydown", e => {
      if (e.key === "Enter") doAdd();
    });
  }

  envRender();

  const rawInput = document.getElementById("api-key-input");
  if (rawInput) {
    rawInput.addEventListener("input", e => {
      state.apiKey = e.target.value.trim();
      localStorage.setItem("crawlix_key", state.apiKey);
      envRender();
      checkHealth();
    });
  }
}

export function restoreBuilderStateUI(savedRequest) {
  if (!savedRequest) return;
  document.getElementById("url-input").value = savedRequest.url || "";
  document.getElementById("method-select").value = savedRequest.method || "GET";
  
  if (savedRequest.body) {
    document.getElementById("body-textarea").value = savedRequest.body;
  }
  
  document.getElementById("render-js-checkbox").checked = !!savedRequest.render_js;
  document.getElementById("stealth-checkbox").checked = !!savedRequest.stealth;
  document.getElementById("scroll-checkbox").checked = !!savedRequest.scroll;
  document.getElementById("strip-links-checkbox").checked = !!savedRequest.strip_links;
  
  const formatSelect = document.getElementById("output-format-select");
  if (formatSelect) {
    formatSelect.value = savedRequest.output_format || "markdown";
    formatSelect.dispatchEvent(new Event("change"));
  }
  
  document.getElementById("impersonate-select").value = savedRequest.impersonate || "chrome120";
  
  // Re-trigger JS visibility
  document.getElementById("render-js-checkbox").dispatchEvent(new Event("change"));
}
