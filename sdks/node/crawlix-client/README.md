# Crawlix Node.js Client

Official Node.js client for the Crawlix Web Scraping Engine.

## Installation

```bash
npm install crawlix-client
```

## Usage

```typescript
import { CrawlixClient } from 'crawlix-client';

const client = new CrawlixClient({
  apiKey: 'YOUR_API_KEY',
  baseUrl: 'http://localhost:8000',
});

async function run() {
  const response = await client.fetch('https://example.com', { render_js: true });
  console.log(response.content);

  // CSS selector extraction (no LLM)
  const css = await client.fetch('https://shop.example.com', {
    output_format: 'css',
    json_schema: {
      baseSelector: 'div.product',
      fields: [
        { name: 'title', selector: 'h2', type: 'text' },
        { name: 'price', selector: '.price', type: 'text' },
      ],
    },
  });
  console.log(css.content);

  // Map a site (sitemap + link discovery)
  const mapped = await client.map('https://example.com', { limit: 100 });
  console.log(mapped.urls);

  // Search the web
  const results = await client.search('fastapi web scraping', { max_results: 5 });
  console.log(results.results);

  // MCP tools list
  const tools = await client.mcp('tools/list');
  console.log(tools.result.tools);
}

run();
```
