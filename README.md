<div align="center">

<h1>⬡ Crawlix</h1>
<p><strong>Self-hosted web scraping & browser automation API with a beautiful dashboard</strong></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6cf0.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-60a5fa.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-34d399.svg)](https://fastapi.tiangolo.com/)
[![Docker](https://img.shields.io/badge/Docker-ready-60a5fa.svg)](docker-compose.yml)

</div>

---

Crawlix is a **self-hosted scraping API** that gives you a single `/fetch` endpoint capable of:

- **Rendering JavaScript** via headless Chromium (Playwright)
- **Impersonating real browsers** via `curl-cffi` (no bot detection)
- **Extracting structured data** using LLMs (OpenAI, Anthropic, Gemini)
- **Crawling entire websites** with configurable depth and domain limits
- **Managing browser sessions** with persistent cookies

It ships with a full **web dashboard** so you can use it without writing any code.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| 🌐 **JS Rendering** | Headless Chromium via Playwright — handles SPAs, infinite scroll, dynamic content |
| 🕵️ **Browser Impersonation** | `curl-cffi` impersonates Chrome/Firefox/Edge TLS fingerprints |
| 🤖 **LLM Extraction** | Extract structured JSON via OpenAI, Anthropic, or Gemini |
| 🕷️ **Site Crawling** | Recursive crawl with max pages, max depth, domain limiting |
| 🔐 **Session Management** | Persistent browser sessions with cookie sharing |
| 🛡️ **SSRF Protection** | Async DNS validation blocks internal/private address access |
| 🎯 **CSS Selector Targeting** | Extract specific DOM subtrees before processing |
| 📷 **Screenshots** | Capture full-page screenshots as base64 PNG/JPEG |
| ⚡ **Proxy Support** | Rotate proxies per request (comma/newline separated) |
| 🧩 **Browser Actions** | Click, type, scroll, wait, hover — before scraping |
| 🔑 **API Key Auth** | Multi-key authentication via environment variable |
| 📊 **Timing Waterfall** | Real server-side timing: Security / Connect / TTFB / Processing |

### Dashboard Features
- 🕐 **Request History** — last 20 requests in localStorage, click-to-replay
- 🗝️ **Environment Variables Panel** — save named API keys (Production, Test, Staging)
- ⌨️ **Keyboard Shortcuts** — `Ctrl+Enter` sends, `Ctrl+K` focuses URL
- 🌓 **Preview Theme Toggle** — light/dark iframe background
- 👁️ **Visibility-aware Polling** — pauses health checks when tab is hidden
- 🔒 **XSS-safe JSON Tree** — HTML-escaped key/value rendering

---

## 🚀 Quick Start

### Docker (recommended)

```bash
git clone https://github.com/Tejas3479/crawlix.git
cd crawlix

# Set your API key and start
API_KEYS=your-secret-key docker-compose up -d
```

Open **http://localhost:8000** in your browser.

### Local (Python)

```bash
git clone https://github.com/Tejas3479/crawlix.git
cd crawlix

python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/Mac

pip install -r requirements.txt
playwright install chromium

API_KEYS=your-secret-key uvicorn app:app --reload
```

---

## 🔧 Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS` | *(required)* | Comma-separated list of valid API keys |
| `MAX_PLAYWRIGHT_INSTANCES` | `3` | Max concurrent headless browser contexts |
| `SESSION_TTL_MINUTES` | `30` | Browser session idle timeout |
| `MAX_SESSIONS` | `100` | Maximum concurrent sessions |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `DISABLE_SSRF_CHECK` | `false` | Set `true` to allow private IPs (dev only) |

---

## 📡 API Reference

See [docs/API.md](docs/API.md) for full request/response schemas.

**Base URL:** `http://localhost:8000`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/fetch` | Fetch a URL (curl or Playwright) |
| `POST` | `/crawl` | Start a recursive site crawl |
| `GET` | `/crawl/{id}` | Get crawl job status & results |
| `GET` | `/api/sessions` | List active browser sessions |
| `DELETE` | `/api/sessions/{id}` | Destroy a session |
| `GET` | `/health` | Health check (no auth required) |

### Quick example

```bash
curl -X POST http://localhost:8000/fetch \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "output_format": "markdown",
    "render_js": false
  }'
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│         FastAPI  (app.py)           │
│   /fetch  /crawl  /api/sessions     │
└──────────────┬──────────────────────┘
               │
        ┌──────▼──────┐
        │  fetcher.py  │
        │              │
        │  ┌────────┐  │   JS rendering
        │  │Playwright│◄─────────────── Chromium
        │  └────────┘  │
        │  ┌─────────┐ │   Fast HTTP
        │  │curl-cffi│◄──────────────── TLS impersonation
        │  └─────────┘ │
        │  ┌─────────┐ │   AI extraction
        │  │   LLM   │◄──────────────── OpenAI / Anthropic / Gemini
        │  └─────────┘ │
        └──────────────┘
               │
        ┌──────▼──────┐
        │  static/     │
        │  index.html  │  Dashboard UI
        │  app.js      │
        │  style.css   │
        └─────────────┘
```

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push and open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
