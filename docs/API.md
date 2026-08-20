# Crawlix API Reference

**Base URL:** `http://localhost:8000`  
**Authentication:** All endpoints (except `/api/health`) require the header `x-api-key: <your-key>`  
**Rate Limiting:** Default limit is 60 requests per minute per IP / API key. Rate limit status is returned in every response header:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Seconds remaining until reset
- Returns HTTP `429 Too Many Requests` with a `Retry-After` header when limit is exceeded.

---

## Endpoints Overview

| Method | Endpoint | Category | Description |
|--------|----------|----------|-------------|
| `POST` | `/fetch` | Core | Fetch a single URL (curl-cffi or Playwright JS rendering) |
| `POST` | `/api/crawl` | Crawl | Start an asynchronous recursive site crawl |
| `GET` | `/api/crawl` | Crawl | List all recent crawl jobs |
| `GET` | `/api/crawl/{id}` | Crawl | Poll crawl job status & retrieved pages |
| `DELETE` | `/api/crawl/{id}` | Crawl | Delete a crawl job and its results |
| `POST` | `/api/crawl/batch` | Batch | Start a batch crawl job via file upload |
| `GET` | `/api/crawl/batch/{id}` | Batch | Poll batch crawl status & progress |
| `GET` | `/api/crawl/batch/{id}/download` | Batch | Download batch results in CSV/JSON format |
| `POST` | `/api/map` | Discovery | Discover site URLs via sitemap.xml + link-based BFS |
| `POST` | `/api/search` | Search | Web search with optional content fetching |
| `POST` | `/mcp` | MCP | Model Context Protocol server (tools: scrape, map, crawl, search) |
| `GET` | `/mcp` | MCP | MCP SSE transport endpoint |
| `GET` | `/api/sessions` | Sessions | List active browser sessions |
| `DELETE` | `/api/sessions/{id}` | Sessions | Destroy a browser session and release cookies |
| `POST` | `/api/destinations` | Admin | Create a webhook or Pinecone destination |
| `GET` | `/api/destinations` | Admin | List all registered destinations |
| `DELETE` | `/api/destinations/{id}` | Admin | Delete a destination |
| `POST` | `/api/schedule` | Admin | Create a recurring cron crawl schedule |
| `GET` | `/api/schedule` | Admin | List all active scheduled crawls |
| `DELETE` | `/api/schedule/{id}` | Admin | Delete a scheduled crawl |
| `POST` | `/api/proxies` | Admin | Add a proxy server URL (`http://user:pass@host:port`) |
| `GET` | `/api/proxies` | Admin | List all registered proxy servers |
| `DELETE` | `/api/proxies/{id}` | Admin | Delete a proxy server by ID |
| `GET` | `/api/health` | System | Service health check (no auth required) |

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
  "bypass_cache": false,
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
| `output_format` | string | `"html"` | `"html"` \| `"markdown"` \| `"structured"` \| `"css"` |
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
| `bypass_cache` | boolean | `false` | Skip the content cache and force a fresh fetch |
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
{ "type": "fill",  "selector": "#search", "value": "hello" }
{ "type": "scroll", "selector": null }
{ "type": "wait",  "selector": ".results", "duration": 2 }
{ "type": "hover", "selector": ".menu-item" }
```

| Type | Required fields | Description |
|------|----------------|-------------|
| `click` | `selector` | Click an element |
| `fill` | `selector`, `value` | Type text into an input |
| `scroll` | — | Scroll to bottom of page (or into view if `selector` given) |
| `wait` | `selector` or `duration` | Wait for selector, or pause for `duration` **seconds** |
| `hover` | `selector` | Hover over an element |
| `press` | `selector`, `value` | Press a key (e.g. `Enter`) while focused on `selector` |

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
| `cache_hit` | boolean | `true` if the response was served from the content cache |

#### Timing Object

| Field | Description |
|-------|-------------|
| `security_ms` | Time spent on SSRF/DNS safety check |
| `connect_ms` | TCP connect + TLS + first response (curl) or page navigation (Playwright) |
| `ttfb_ms` | Time to first byte / content body read start |
| `transfer_ms` | Content processing time (markdown conversion, LLM extraction, etc.) |
| `total_ms` | Full end-to-end duration measured server-side |

### CSS Selector Extraction (`output_format: "css"`)

Deterministic, LLM-free JSON extraction (no provider keys required, zero token cost). Provide a `json_schema` shaped like a CSS extraction strategy:

```json
{
  "output_format": "css",
  "json_schema": {
    "name": "Products",
    "baseSelector": "div.product",
    "fields": [
      { "name": "title", "selector": "h2", "type": "text" },
      { "name": "price", "selector": ".price", "type": "text", "transform": "strip" },
      { "name": "link", "selector": "a", "type": "attribute", "attribute": "href" }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `baseSelector` | (optional) CSS selector for the repeating container; omit to treat the document as one item |
| `fields[].name` | Output key |
| `fields[].selector` | CSS selector resolved **within** the container |
| `fields[].type` | `text` \| `attribute` (requires `attribute`) \| `html` \| `integer` \| `number` \| `boolean` |
| `fields[].transform` | `strip` \| `upper` \| `lower` |
| `fields[].fallback` | Value used when the selector matches nothing |

If a `structured` request also contains `baseSelector`/`fields`, the cheaper CSS path is used automatically instead of the LLM.

### Caching

GET fetches without custom headers/cookies/body are cached by default (TTL `CACHE_TTL_SECONDS`, default `3600`; disable with `CACHE_ENABLED=false`). Authenticated/stateful requests are never cached. The response includes `cache_hit` and responses can be force-refreshed with `bypass_cache: true`.

---

## POST /api/crawl

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
  "respect_robots": true,
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
| `respect_robots` | boolean | `true` | Honor robots.txt `Disallow` rules during the crawl |
| `extraction_prompt` | string | `null` | LLM extraction instruction applied to each page |
| `stealth` | boolean | `false` | Playwright stealth mode |

```json
{
  "crawl_id": "abc123",
  "status": "running"
}
```

### Crawl Lifecycle Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as FastAPI
    participant CM as CrawlManager
    participant Worker as Async Worker Pool
    participant Web as Target Website

    Client->>API: POST /api/crawl (start_url, max_pages, max_depth)
    API->>CM: Create Crawl Job & Spawn Background Task
    CM-->>API: Return crawl_id
    API-->>Client: 200 OK (crawl_id, status: "running")
    
    rect rgb(30, 30, 45)
        note over CM, Web: Background Crawl Execution
        loop Until max_pages reached or queue empty
            CM->>Worker: Dispatch URL task
            Worker->>Web: Fetch page & extract links
            Web-->>Worker: Page Content + Discovered URLs
            Worker->>CM: Store page result & filter new links
        end
    end

    loop Polling Status
        Client->>API: GET /api/crawl/{crawl_id}
        API->>CM: Query Job Status
        CM-->>API: Job State & Pages List
        API-->>Client: Status JSON (running / completed)
    end
```

---

## GET /api/crawl/{crawl_id}

Poll the status and results of a running or completed crawl.

### Response

```json
{
  "id": "abc123",
  "url": "https://example.com",
  "status": "completed",
  "created_at": "2026-07-22T14:00:00Z",
  "completed_at": "2026-07-22T14:01:00Z",
  "results": [
    {
      "url": "https://example.com/page",
      "title": "Page Title",
      "content": "...",
      "status_code": 200
    }
  ],
  "stats": { "pages_crawled": 8 },
  "error_message": null,
  "max_pages": 10,
  "max_depth": 3,
  "render_js": false,
  "output_format": "markdown",
  "webhook_url": null,
  "destinations": []
}
```

`status` values: `running` | `completed` | `failed` | `interrupted`. The crawl identifier is returned as `id` in this response (and `crawl_id` from the list/start endpoints).

---

## GET /api/sessions

List all active browser sessions.

### Response

```json
[
  {
    "session_id": "my-session",
    "engine": "playwright",
    "created_at": "2026-07-22T14:00:00Z",
    "last_active": "2026-07-22T14:05:00Z",
    "request_count": 3,
    "cookie_count": 2
  }
]
```

---

## DELETE /api/sessions/{session_id}

Destroy a browser session and release its resources.

### Response

```json
{ "deleted": true, "session_id": "my-session" }
```

---

## GET /api/health

Health check — no authentication required.

### Response

```json
{
  "status": "ok",
  "database": "ok",
  "redis": "ok",
  "active_sessions": 2,
  "playwright_slots_free": 3
}
```

`status` is `"ok"` when both database and Redis checks pass, otherwise `"degraded"`. `database`/`redis` report `"ok"` or an `"error: <message>"` string.

---

## Crawl Management (/api/crawl)

### GET /api/crawl
List all recent crawl jobs ordered by creation time.

#### Response
```json
[
  {
    "crawl_id": "95ae2021-1589-4bec-9d40-ca0d308ff5b9",
    "url": "https://example.com",
    "status": "completed",
    "pages_crawled": 5,
    "max_pages": 10,
    "created_at": "2026-08-03T12:00:00Z",
    "url_count": 5
  }
]
```

### DELETE /api/crawl/{crawl_id}
Delete a crawl job and its stored results.

#### Response
```json
{ "deleted": true, "crawl_id": "95ae2021-1589-4bec-9d40-ca0d308ff5b9" }
```

---

## Batch Crawls (/api/crawl/batch)

### POST /api/crawl/batch
Start a batch crawl job by uploading a CSV or text file containing a list of URLs (one per line).

#### Request (Multipart Form Data)
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | file | **required** | CSV or plain-text file upload containing target URLs |
| `render_js` | boolean | `false` | Enable Playwright JS rendering for batch URLs |
| `output_format` | string | `"markdown"` | `"markdown"` \| `"html"` \| `"structured"` |
| `webhook_url` | string | `null` | Optional webhook notification callback URL |

#### Response
```json
{
  "batch_id": "batch-884a22c0",
  "total_urls": 12,
  "status": "processing"
}
```

### GET /api/crawl/batch/{batch_id}
Poll the status and progress of a batch crawl job.

#### Response
```json
{
  "id": "batch-884a22c0",
  "status": "completed",
  "created_at": "2026-08-03T12:00:00Z",
  "completed_at": "2026-08-03T12:04:00Z",
  "total_urls": 12,
  "processed_urls": 12,
  "webhook_url": null,
  "export_path": "/path/to/export.json",
  "error_message": null
}
```

### GET /api/crawl/batch/{batch_id}/download
Download completed batch results as a JSON file (`batch_{id}.json`, `application/json`). Returns HTTP `400` if the batch job has not finished processing.

---

## POST /api/map

Discover the URLs of a site using its sitemap first, then link-based BFS as a fallback.

### Request Body

```json
{
  "url": "https://example.com",
  "limit": 100,
  "include_sitemap": true,
  "allow_subdomains": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | Site root to map |
| `limit` | integer | `100` | Maximum URLs to return |
| `include_sitemap` | boolean | `true` | Check `/sitemap.xml` before crawling links |
| `allow_subdomains` | boolean | `false` | Include subdomains of the target domain |
| `render_js` | boolean | `false` | Reserved for JS-rendered discovery |
| `timeout` | integer | `15` | Per-request timeout in seconds |
| `proxy` | object | `null` | `{ "url": "http://user:pass@host:port" }` |

### Response

```json
{
  "success": true,
  "error": null,
  "urls": ["https://example.com/", "https://example.com/about", "..."],
  "count": 42,
  "limit": 100,
  "base_domain": "example.com",
  "discovered_via": "sitemap",
  "latency_ms": 812
}
```

`discovered_via` is `"sitemap"` when a sitemap supplied the URLs, otherwise `"link"`.

---

## POST /api/search

Web search with optional fetching of the top results.

### Request Body

```json
{
  "query": "fastapi web scraping",
  "provider": "duckduckgo",
  "max_results": 10,
  "fetch_content": false,
  "content_limit": 3
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | **required** | Search query |
| `provider` | string | `"duckduckgo"` | `"duckduckgo"` (keyless) \| `"serper"` (needs `SERPER_API_KEY` or `api_key`) |
| `api_key` | string | `null` | Provider API key override (falls back to `SERPER_API_KEY`) |
| `max_results` | integer | `10` | Max results to return |
| `fetch_content` | boolean | `false` | Fetch markdown for the top results |
| `content_limit` | integer | `3` | How many top results to fetch when `fetch_content` is true |

### Response

```json
{
  "success": true,
  "error": null,
  "query": "fastapi web scraping",
  "provider": "duckduckgo",
  "results": [
    {
      "title": "FastAPI",
      "url": "https://fastapi.tiangolo.com/",
      "snippet": "FastAPI framework, high performance, easy to learn...",
      "markdown": "# FastAPI...",
      "status_code": 200
    }
  ],
  "latency_ms": 640
}
```

`markdown` and `status_code` are present only when `fetch_content` is `true`.

---

## MCP Server (/mcp)

Crawlix exposes a Model Context Protocol server compatible with Claude Desktop and other MCP clients. It uses the Streamable HTTP transport (JSON-RPC 2.0 over `POST /mcp`); a legacy SSE endpoint is available at `GET /mcp`.

Authenticate with the same API key via `x-api-key` or `Authorization: Bearer`.

Available tools (see `tools/list`):

| Tool | Description |
|------|-------------|
| `scrape` | Fetch a URL as html/markdown/structured/css |
| `map` | Discover site URLs via sitemap + BFS |
| `crawl` | Start an async crawl, returns `crawl_id` |
| `get_crawl` | Poll crawl status/results by `crawl_id` |
| `search` | Web search with optional content fetch |
| `health` | Server health |

Minimal example:

```bash
curl -X POST http://localhost:8000/mcp \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl -X POST http://localhost:8000/mcp \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scrape","arguments":{"url":"https://example.com","output_format":"markdown"}}}'
```

---

## Webhooks

When a crawl or batch job completes, Crawlix POSTs the job payload to the configured `webhook_url`. Webhooks are delivered with retries and exponential backoff (`WEBHOOK_MAX_RETRIES`, default 3).

If `WEBHOOK_SECRET` is set, every request is signed with an HMAC-SHA256 of the raw body:

```
X-Crawlix-Signature: sha256=<hex digest>
```

Verify it server-side:

```python
import hashlib, hmac
sig = hmac.new(b"your-secret", request.body, hashlib.sha256).hexdigest()
assert request.headers["X-Crawlix-Signature"] == f"sha256={sig}"
```

---

## Webhook & Vector Destinations (/api/destinations)

### POST /api/destinations
Register a webhook endpoint or vector DB index (Pinecone, Weaviate, Supabase) for automatic data ingestion.

#### Request Body
```json
{
  "name": "Production Pinecone",
  "type": "pinecone",
  "config": {
    "api_key": "pcsk-...",
    "index_name": "crawlix-index"
  }
}
```

#### Response
```json
{
  "id": "dest-7b3e10c0",
  "name": "Production Pinecone",
  "type": "pinecone",
  "config": { "api_key": "pcsk-...", "index_name": "crawlix-index" }
}
```

### GET /api/destinations
Retrieve a list of all registered destinations.

### DELETE /api/destinations/{dest_id}
Delete a registered destination by ID.

---

## Scheduled Crawls (/api/schedule)

### POST /api/schedule
Create a recurring crawl job using a standard cron expression.

#### Request Body
```json
{
  "cron_expression": "*/15 * * * *",
  "payload": {
    "url": "https://example.com",
    "max_pages": 10,
    "max_depth": 2
  }
}
```

#### Response
```json
{
  "id": "sched-f203810a",
  "cron_expression": "*/15 * * * *",
  "payload": { "url": "https://example.com", "max_pages": 10, "max_depth": 2 },
  "status": "active"
}
```

### GET /api/schedule
List all active scheduled crawl jobs.

### DELETE /api/schedule/{sched_id}
Delete a scheduled crawl job.

---

## Proxy Management (/api/proxies)

### POST /api/proxies
Add a proxy server URL for rotation during scraping requests.

#### Request Body
```json
{
  "url": "http://user:pass@proxy-host.example.com:8080"
}
```

#### Response
```json
{
  "status": "added",
  "id": "proxy-d03bc214"
}
```
*(Returns `"status": "already_exists"` if the proxy URL is already registered).*

### GET /api/proxies
Retrieve all registered proxy servers along with their activity status and error count.

#### Response
```json
[
  {
    "id": "proxy-d03bc214",
    "url": "http://user:pass@proxy-host.example.com:8080",
    "is_active": true,
    "fail_count": 0
  }
]
```

### DELETE /api/proxies/{id}
Delete a proxy server.

#### Response
```json
{
  "status": "deleted"
}
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

### Extraction Errors (returned inside the response body)

| Error | Description |
|-------|-------------|
| `css_extraction_failed` | CSS extraction schema missing/invalid, or no elements matched |
| `llm_api_failed` | All configured LLM providers failed after retries |
| `llm_parse_failed` | LLM returned non-JSON output (raw text included) |
| `llm_validation_failed` | LLM output failed JSON-Schema validation after retry |

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
