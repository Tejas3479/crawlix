# Crawlix API Reference

**Base URL:** `http://localhost:8000`  
**Authentication:** All endpoints (except `/health`) require the header `x-api-key: <your-key>`

---

## POST /fetch

Fetch a single URL. Supports both fast HTTP (`curl-cffi`) and full JS rendering (Playwright).

### Request Body

```json
{
  "url": "https://example.com",
  "method": "GET",
  "output_format": "markdown",
  "render_js": false,
  "headers": {},
  "cookies": {},
  "body": null,
  "json_body": null,
  "session_id": null,
  "scroll": false,
  "proxy": null,
  "max_retries": 0,
  "timeout": 30,
  "impersonate": "chrome120",
  "strip_links": false,
  "css_selector": null,
  "wait_for_selector": null,
  "wait_timeout": 30,
  "wait_until": "networkidle",
  "actions": [],
  "screenshot": false,
  "screenshot_format": "png",
  "llm_api_key": null,
  "llm_provider": "openai",
  "llm_model": null,
  "json_schema": null,
  "extraction_prompt": null,
  "stealth": false
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | Target URL to fetch |
| `method` | string | `"GET"` | HTTP method: GET, POST, PUT, DELETE, PATCH, HEAD |
| `output_format` | string | `"html"` | `"html"` \| `"markdown"` \| `"structured"` |
| `render_js` | boolean | `false` | Use Playwright (headless Chrome) instead of curl |
| `headers` | object | `{}` | Custom request headers |
| `cookies` | object | `{}` | Custom cookies |
| `body` | string | `null` | Raw request body (for POST) |
| `json_body` | object | `null` | JSON request body (sets Content-Type automatically) |
| `session_id` | string | `null` | Reuse a named browser session (persists cookies) |
| `scroll` | boolean | `false` | Auto-scroll to bottom before extracting (Playwright only) |
| `proxy` | object | `null` | `{ "url": "http://user:pass@host:port" }` |
| `max_retries` | integer | `0` | Number of retry attempts on failure |
| `timeout` | integer | `30` | Request timeout in seconds |
| `impersonate` | string | `"chrome120"` | curl-cffi browser fingerprint to impersonate |
| `strip_links` | boolean | `false` | Remove all hyperlinks from markdown output |
| `css_selector` | string | `null` | Extract only matching DOM element before processing |
| `wait_for_selector` | string | `null` | Wait for this CSS selector to appear (Playwright) |
| `wait_timeout` | integer | `30` | Timeout for `wait_for_selector` in seconds |
| `wait_until` | string | `"networkidle"` | Playwright navigation event: `load` \| `domcontentloaded` \| `networkidle` |
| `actions` | array | `[]` | Browser actions to perform before extracting (see below) |
| `screenshot` | boolean | `false` | Capture a screenshot after page load |
| `screenshot_format` | string | `"png"` | `"png"` \| `"jpeg"` |
| `llm_api_key` | string | `null` | API key for LLM extraction |
| `llm_provider` | string | `"openai"` | `"openai"` \| `"anthropic"` \| `"gemini"` |
| `llm_model` | string | `null` | Model override (e.g. `"gpt-4o"`, `"claude-3-5-haiku-20241022"`) |
| `json_schema` | object | `null` | JSON Schema for structured extraction |
| `extraction_prompt` | string | `null` | Natural language extraction instruction |
| `stealth` | boolean | `false` | Enable Playwright stealth mode to bypass bot detection |

### Browser Actions

Actions are executed in order before content is extracted. Each action is an object:

```json
{ "type": "click", "selector": "#load-more" }
{ "type": "type",  "selector": "#search", "value": "hello" }
{ "type": "scroll", "selector": null }
{ "type": "wait",  "selector": ".results", "duration": 2000 }
{ "type": "hover", "selector": ".menu-item" }
```

| Type | Required fields | Description |
|------|----------------|-------------|
| `click` | `selector` | Click an element |
| `type` | `selector`, `value` | Type text into an input |
| `scroll` | — | Scroll to bottom of page |
| `wait` | `selector` or `duration` | Wait for selector or N milliseconds |
| `hover` | `selector` | Hover over an element |

### Response

```json
{
  "success": true,
  "url": "https://example.com",
  "status_code": 200,
  "output_format": "markdown",
  "content": "# Example Domain\n\nThis domain is for use...",
  "session_id": null,
  "latency_ms": 423,
  "retries_used": 0,
  "error": null,
  "error_message": null,
  "screenshot": null,
  "timing": {
    "security_ms": 12,
    "connect_ms": 340,
    "ttfb_ms": 18,
    "transfer_ms": 53,
    "total_ms": 423
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `url` | string | Final URL after redirects |
| `status_code` | integer | HTTP status code |
| `output_format` | string | Format the content was returned in |
| `content` | string \| object | Scraped content (string for html/markdown, object for structured) |
| `session_id` | string \| null | Session ID used (if any) |
| `latency_ms` | integer | Total server-side latency in milliseconds |
| `retries_used` | integer | Number of retries performed |
| `error` | string \| null | Error code if failed |
| `error_message` | string \| null | Human-readable error detail |
| `screenshot` | string \| null | Base64 data URL of screenshot (if requested) |
| `timing` | object \| null | Phase timing breakdown (see below) |

#### Timing Object

| Field | Description |
|-------|-------------|
| `security_ms` | Time spent on SSRF/DNS safety check |
| `connect_ms` | TCP connect + TLS + first response (curl) or page navigation (Playwright) |
| `ttfb_ms` | Time to first byte / content body read start |
| `transfer_ms` | Content processing time (markdown conversion, LLM extraction, etc.) |
| `total_ms` | Full end-to-end duration measured server-side |

---

## POST /crawl

Start an asynchronous site crawl. Returns a `crawl_id` to poll for results.

### Request Body

```json
{
  "url": "https://example.com",
  "max_pages": 10,
  "max_depth": 3,
  "render_js": false,
  "output_format": "markdown",
  "strip_links": false,
  "css_selector": null,
  "limit_domain": true,
  "actions": [],
  "extraction_prompt": null,
  "stealth": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | Start URL for the crawl |
| `max_pages` | integer | `10` | Maximum pages to crawl |
| `max_depth` | integer | `3` | Maximum link depth from start URL |
| `render_js` | boolean | `false` | Use Playwright for JS-rendered pages |
| `output_format` | string | `"markdown"` | Output format per page |
| `strip_links` | boolean | `false` | Remove links from markdown |
| `css_selector` | string | `null` | Extract only matching element per page |
| `limit_domain` | boolean | `true` | Stay within the same domain |
| `extraction_prompt` | string | `null` | LLM extraction instruction applied to each page |
| `stealth` | boolean | `false` | Playwright stealth mode |

### Response

```json
{
  "crawl_id": "abc123",
  "status": "running",
  "message": "Crawl started"
}
```

---

## GET /crawl/{crawl_id}

Poll the status and results of a running or completed crawl.

### Response

```json
{
  "crawl_id": "abc123",
  "status": "completed",
  "pages_crawled": 8,
  "pages_found": 12,
  "results": [
    {
      "url": "https://example.com/page",
      "title": "Page Title",
      "content": "...",
      "status_code": 200,
      "depth": 1
    }
  ],
  "created_at": "2026-07-22T14:00:00Z"
}
```

`status` values: `running` | `completed` | `failed` | `cancelled`

---

## GET /api/sessions

List all active browser sessions.

### Response

```json
{
  "sessions": [
    {
      "session_id": "my-session",
      "engine": "playwright",
      "created_at": "2026-07-22T14:00:00Z",
      "last_used": "2026-07-22T14:05:00Z",
      "cookies": {}
    }
  ]
}
```

---

## DELETE /api/sessions/{session_id}

Destroy a browser session and release its resources.

### Response

```json
{ "message": "Session my-session closed." }
```

---

## GET /health

Health check — no authentication required.

### Response

```json
{ "status": "ok" }
```

---

## Error Codes

| HTTP Code | Error | Description |
|-----------|-------|-------------|
| `401` | `unauthorized` | Missing or invalid `x-api-key` header |
| `403` | `forbidden_address` | URL resolves to a private/internal IP (SSRF protection) |
| `422` | — | Request body validation failed (Pydantic) |
| `500` | `fetch_error` | Unhandled fetch error (check `error_message`) |
| `504` | `timeout` | Request exceeded the configured timeout |

---

## Code Examples

### Python

```python
import requests

API_KEY = "your-secret-key"
BASE_URL = "http://localhost:8000"

# Simple markdown fetch
resp = requests.post(f"{BASE_URL}/fetch",
    headers={"x-api-key": API_KEY},
    json={
        "url": "https://news.ycombinator.com",
        "output_format": "markdown",
        "render_js": False
    }
)
print(resp.json()["content"])
```

### JavaScript / Node.js

```js
const res = await fetch("http://localhost:8000/fetch", {
  method: "POST",
  headers: {
    "x-api-key": "your-secret-key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: "https://example.com",
    output_format: "markdown",
    render_js: false
  })
});
const data = await res.json();
console.log(data.content);
```

### cURL

```bash
curl -X POST http://localhost:8000/fetch \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","output_format":"markdown"}'
```
