# Crawlix Python Client

Official Python client for the Crawlix Web Scraping Engine.

## Installation

```bash
pip install crawlix-client
```

## Usage

```python
from crawlix_client import CrawlixClient

client = CrawlixClient(api_key="YOUR_API_KEY", base_url="http://localhost:8000")

# Simple fetch
response = client.fetch("https://example.com", render_js=True)
print(response["content"])

# Markdown with content caching
response = client.fetch("https://example.com", output_format="markdown")
# Force a fresh fetch (bypass cache)
response = client.fetch("https://example.com", output_format="markdown", bypass_cache=True)

# CSS selector extraction (no LLM, deterministic)
schema = {
    "name": "Products",
    "baseSelector": "div.product",
    "fields": [
        {"name": "title", "selector": "h2", "type": "text"},
        {"name": "price", "selector": ".price", "type": "text"},
    ],
}
response = client.fetch("https://shop.example.com", output_format="css", json_schema=schema)
print(response["content"])

# Map a site (sitemap + link discovery)
mapped = client.map("https://example.com", limit=100)
print(mapped["urls"])

# Search the web
results = client.search("fastapi web scraping", max_results=5, fetch_content=True)
print(results["results"])

# MCP (Model Context Protocol) — list available tools
tools = client.mcp("tools/list")
print(tools["result"]["tools"])
```
