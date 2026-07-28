# Changelog

All notable changes to Crawlix are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.2.0] — 2026-07-28

### Added
- **AI Vector Pipelines** — Push embeddings natively to Pinecone, Weaviate, and Supabase via new `Destination` configurations.
- **Scheduled Crawls** — Schedule recurring extractions using `croniter` and the ARQ background worker.
- **Client SDKs** — Official Python and Node.js (TypeScript) SDKs for easy integration.
- **Captcha Solving** — Integration with 2Captcha and CapSolver for bypassing complex anti-bot challenges during scraping.
- **Database Backend** — Shifted core states (Jobs, API Keys, Proxies, Destinations) to SQLite via SQLModel/SQLAlchemy.
- **API Key DB Support** — `verify_api_key` now checks both `VALID_KEYS` environment variable and SQLite `ApiKey` table.
- **Docker Image CI** — Automated Docker build testing in GitHub Actions.

### Changed
- Replaced legacy `SESSIONS_FILE` and `CRAWLS_FILE` disk writes with proper SQLite database backend.
- Updated `worker.py` and `app.py` with Python 3.9+ type annotations (`dict` instead of `Dict`) for `ruff` compliance.
- Dockerfile now runs `apt-get` update prior to `playwright install-deps` to fix broken package cache.

---



## [1.1.0] — 2026-07-22

### Added
- **Environment Variables Panel** — Save named API keys (Production, Test, Staging) in sidebar. Chip UI for instant switching. Masked display (`myke••••3x9a`). Persisted in `localStorage`.
- **Request Timing Waterfall** — Real server-side timing breakdown below meta bar: Security / Connect / TTFB / Processing phases. Proportional colored segments with hover tooltips and ms legend.
- **Request History** — Last 20 requests stored in `localStorage`. Sidebar panel with click-to-replay. Keyboard accessible (Enter/Space to replay). Clear button with confirmation.
- **Keyboard Shortcuts** — `Ctrl+Enter` / `Cmd+Enter` sends request. `Ctrl+K` / `Cmd+K` focuses URL bar. Works cross-platform.
- **Preview Theme Toggle** — Light/dark background switcher above iframe preview. State persists within session.
- **Visibility-aware Polling** — Health checks and session refresh pause when the browser tab is hidden. Resumes on tab focus.
- **Crawl extraction prompt** — Separate `<textarea>` for the crawl section, no longer shared with request builder.
- **XSS-safe JSON tree** — `renderJsonTree()` now HTML-escapes all keys and values via `escapeHtml()` before `innerHTML`.
- **SEO/A11y improvements** — `<title>`, `<meta name="description">`, SVG favicon, `<h1 class="sr-only">`, `prefers-reduced-motion` media query, `focus-visible` rings on all interactive elements.
- **JetBrains Mono font** — Code and monospace elements now use JetBrains Mono.
- **Timing fields in API response** — `FetchResponse` now includes a `timing` object with `security_ms`, `connect_ms`, `ttfb_ms`, `transfer_ms`, `total_ms`.

### Fixed
- **CRITICAL** — CORS misconfiguration: `allow_origins=["*"]` + `allow_credentials=True` is invalid per spec. Fixed to `allow_credentials=False`.
- **CRITICAL** — `is_ssrf_safe()` was synchronous DNS resolution inside an async route, blocking the event loop. Converted to `async def` using `loop.run_in_executor()`.
- **CRITICAL** — Race condition on `playwright_mgr.slots_free` counter. Added `asyncio.Lock` (`_slots_lock`) to guard all read-modify-write operations.
- **CRITICAL** — `import uuid` and `import base64` were mid-file (line 856+). Moved to top-of-file import block.
- **CRITICAL** — Duplicate `logging.basicConfig()` call in `fetcher.py`. Removed — `app.py` is the single source of truth.
- **CRITICAL** — `datetime.utcnow()` deprecated in Python 3.12+. All instances replaced with `datetime.now(timezone.utc)`.
- **HIGH** — Anthropic model `claude-3-haiku-20240307` deprecated. Updated to `claude-3-5-haiku-20241022`.
- **HIGH** — `cleanup_loop` did not handle `asyncio.CancelledError` on shutdown. Wrapped in `try/except asyncio.CancelledError`.
- **HIGH** — `MAX_SESSIONS` eviction used `>` instead of `>=`, allowing one extra session beyond the limit.
- **HIGH** — Crawl section shared `#extraction-prompt-textarea` with the request builder. Now uses dedicated `#crawl-extraction-prompt`.
- **MEDIUM** — Dead code: `parseHeaders()` and `parseCookies()` (128 lines) removed. Superseded by `parseKvContainer()`.
- **MEDIUM** — Duplicate `import os as _os` in `app.py`. Removed.
- **MEDIUM** — Wrong LLM placeholder model `gemini-3.1` (non-existent). Fixed to `gemini-3.6-flash`.
- **MEDIUM** — `outline: none` on all elements broke keyboard focus visibility. Replaced with `*:focus-visible` accessible outline.
- **LOW** — Proxy regex `r'[,\n\r]+'` → `r'[,\r\n]+'` to correctly handle Windows CRLF in textareas.

### Renamed
- Project renamed from **FetchAPI** to **Crawlix** across all files (app.py, fetcher.py, index.html, app.js, docker-compose.yml, localStorage keys, CSS classes, logger namespaces).

---

## [1.0.0] — Initial Release

- FastAPI backend with `/fetch`, `/crawl`, `/api/sessions`, `/health` endpoints
- `curl-cffi` for fast, TLS-fingerprint-aware HTTP requests
- Playwright for headless JS rendering (Chromium)
- LLM extraction via OpenAI, Anthropic, Gemini
- Session management with TTL-based cleanup
- Browser actions: click, type, scroll, wait, hover
- Screenshot capture (PNG/JPEG, base64)
- CSS selector targeting
- Proxy rotation support
- SSRF protection via DNS validation
- Web dashboard (vanilla HTML/CSS/JS)
- Docker + docker-compose support
- API key authentication
