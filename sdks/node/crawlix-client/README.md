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
}

run();
```
