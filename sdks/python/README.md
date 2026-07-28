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
```
