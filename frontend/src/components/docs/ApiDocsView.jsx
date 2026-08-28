import React, { useState } from 'react';
import { CodeBlock } from '../common/CodeBlock';
import {
  BookOpen,
  Terminal,
  Bot,
  Copy,
  Check,
  Coffee,
  Zap,
  Globe,
  Database,
  ExternalLink,
  Layers,
  Send,
  Key,
  Shield,
} from 'lucide-react';

export function ApiDocsView() {
  const [copiedSection, setCopiedSection] = useState(null);
  const [activeEndpointTab, setActiveEndpointTab] = useState('fetch'); // 'fetch' | 'crawl' | 'schema' | 'diff' | 'mcp'

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    addToast?.({ type: 'success', message: 'Copied to clipboard' });
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const mcpClaudeConfig = `{
  "mcpServers": {
    "crawlix": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "${window.location.origin.includes('localhost') ? 'c:/Users/tejas/Downloads/web' : '/app'}",
      "env": {
        "CRAWLIX_API_URL": "${window.location.origin}",
        "CRAWLIX_API_KEY": "your_api_key_here"
      }
    }
  }
}`;

  const fetchSnippets = {
    python: `import requests

url = "${window.location.origin}/fetch"
headers = {"x-api-key": "your_api_key"}
payload = {
    "url": "https://news.ycombinator.com",
    "output_format": "markdown",
    "compress_tokens": True,
    "auto_dismiss_banners": True,
    "render_js": True,
    "stealth": True
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
print("Content:", data["content"][:200])`,
    typescript: `import axios from 'axios';

async function fetchPage() {
  const response = await axios.post('${window.location.origin}/fetch', {
    url: 'https://news.ycombinator.com',
    output_format: 'markdown',
    compress_tokens: true,
    auto_dismiss_banners: true,
    render_js: true,
    stealth: true
  }, {
    headers: { 'x-api-key': 'your_api_key' }
  });

  console.log('Markdown:', response.data.content);
}

fetchPage();`,
    curl: `curl -X POST "${window.location.origin}/fetch" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: your_api_key" \\
  -d '{
    "url": "https://news.ycombinator.com",
    "output_format": "markdown",
    "compress_tokens": true,
    "stealth": true
  }'`,
  };

  const crawlSnippets = {
    python: `import requests

url = "${window.location.origin}/api/crawl"
headers = {"x-api-key": "your_api_key"}
payload = {
    "url": "https://news.ycombinator.com",
    "max_pages": 50,
    "max_depth": 2,
    "include_patterns": ["*/item?id=*"],
    "exclude_patterns": ["*/login*", "*.pdf"],
    "output_format": "markdown",
    "compress_tokens": True
}

response = requests.post(url, json=payload, headers=headers)
crawl_id = response.json()["crawl_id"]
print(f"Crawl enqueued: {crawl_id}")`,
    curl: `curl -X POST "${window.location.origin}/api/crawl" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: your_api_key" \\
  -d '{
    "url": "https://news.ycombinator.com",
    "max_pages": 50,
    "include_patterns": ["*/item?id=*"],
    "output_format": "markdown"
  }'`,
  };

  const schemaSnippets = {
    python: `import requests

url = "${window.location.origin}/api/schema/generate"
headers = {"x-api-key": "your_api_key"}
payload = {
    "url": "https://news.ycombinator.com",
    "extraction_goal": "Extract story titles, submitter, points, and comment counts."
}

response = requests.post(url, json=payload, headers=headers)
print("Inferred Schema:", response.json()["schema_definition"])`,
    curl: `curl -X POST "${window.location.origin}/api/schema/generate" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: your_api_key" \\
  -d '{
    "url": "https://news.ycombinator.com",
    "extraction_goal": "Extract story titles and points"
  }'`,
  };

  const diffSnippets = {
    python: `import requests

url = "${window.location.origin}/api/diff"
headers = {"x-api-key": "your_api_key"}
payload = {
    "url": "https://news.ycombinator.com",
    "old_content": "Initial snapshot markdown content here..."
}

response = requests.post(url, json=payload, headers=headers)
diff = response.json()
print("Has Changed:", diff["has_changed"])
print("Additions:", diff["additions_count"])`,
    curl: `curl -X POST "${window.location.origin}/api/diff" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: your_api_key" \\
  -d '{
    "url": "https://news.ycombinator.com",
    "old_content": "Snapshot A"
  }'`,
  };

  return (
    <div className="flex-1 flex flex-col bg-espresso-50/50 dark:bg-black/60 p-8 overflow-y-auto max-w-5xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 text-xl font-bold text-espresso-900 dark:text-white mb-1">
          <BookOpen className="w-6 h-6 text-caramel-500" />
          <span>API Reference & Model Context Protocol (MCP)</span>
        </div>
        <p className="text-xs text-espresso-600 dark:text-espresso-400">
          Seamlessly integrate Crawlix into LLM agents (Claude Desktop, Cursor, Antigravity) or enterprise microservices.
        </p>
      </div>

      {/* Model Context Protocol (MCP) Setup */}
      <div className="p-6 rounded-3xl border border-caramel-500/30 bg-gradient-to-b from-caramel-500/10 to-white dark:to-espresso-900 space-y-4 glow-caramel-subtle shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-sm font-bold text-espresso-900 dark:text-white">
            <Bot className="w-5 h-5 text-caramel-500" />
            <span>Claude Desktop, Cursor IDE & Antigravity MCP Server</span>
          </div>
          <button
            onClick={() => copyToClipboard(mcpClaudeConfig, 'mcp')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-caramel-500/20 text-caramel-700 dark:text-caramel-300 border border-caramel-500/40 text-xs font-bold hover:bg-caramel-500/30 transition shadow-sm"
          >
            {copiedSection === 'mcp' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSection === 'mcp' ? 'Copied' : 'Copy MCP Config'}</span>
          </button>
        </div>

        <p className="text-xs text-espresso-600 dark:text-espresso-300 leading-relaxed">
          Add Crawlix tools (<code>fetch_url</code>, <code>crawl_site</code>, <code>search_web</code>, <code>map_sitemap</code>) directly into your local AI assistant's <code>claude_desktop_config.json</code> or Cursor settings:
        </p>

        <CodeBlock code={mcpClaudeConfig} language="json" filename="claude_desktop_config.json" />
      </div>

      {/* Endpoint Explorer */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-espresso-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Terminal className="w-4 h-4 text-caramel-500" />
            <span>REST API Endpoint Explorer</span>
          </h3>

          <div className="flex gap-1.5 p-1 rounded-xl bg-white dark:bg-espresso-900 border border-caramel-500/15 text-xs font-semibold">
            {[
              { id: 'fetch', label: 'POST /fetch' },
              { id: 'crawl', label: 'POST /api/crawl' },
              { id: 'schema', label: 'POST /api/schema/generate' },
              { id: 'diff', label: 'POST /api/diff' },
            ].map((ep) => (
              <button
                key={ep.id}
                onClick={() => setActiveEndpointTab(ep.id)}
                className={`px-3 py-1 rounded-lg transition ${
                  activeEndpointTab === ep.id
                    ? 'bg-caramel-500 text-white font-bold shadow-md'
                    : 'text-espresso-600 dark:text-espresso-400 hover:text-espresso-900 dark:hover:text-white'
                }`}
              >
                {ep.label}
              </button>
            ))}
          </div>
        </div>

        {/* POST /fetch */}
        {activeEndpointTab === 'fetch' && (
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <div>
              <h4 className="text-sm font-bold text-espresso-900 dark:text-white font-mono">POST /fetch</h4>
              <p className="text-xs text-espresso-600 dark:text-espresso-400 mt-1">
                Fast TLS impersonation and full Playwright browser scraping with RAG token compression and banner auto-dismissal.
              </p>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300">Python Example:</h5>
              <CodeBlock code={fetchSnippets.python} language="python" filename="fetch_example.py" />

              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300 mt-3">TypeScript / Node Example:</h5>
              <CodeBlock code={fetchSnippets.typescript} language="typescript" filename="fetch_example.ts" />

              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300 mt-3">cURL:</h5>
              <CodeBlock code={fetchSnippets.curl} language="bash" filename="fetch.sh" />
            </div>
          </div>
        )}

        {/* POST /api/crawl */}
        {activeEndpointTab === 'crawl' && (
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <div>
              <h4 className="text-sm font-bold text-espresso-900 dark:text-white font-mono">POST /api/crawl</h4>
              <p className="text-xs text-espresso-600 dark:text-espresso-400 mt-1">
                Distributed BFS crawler with URL regex filtering, depth controls, and multi-format dataset streaming.
              </p>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300">Python Example:</h5>
              <CodeBlock code={crawlSnippets.python} language="python" filename="crawl_example.py" />

              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300 mt-3">cURL:</h5>
              <CodeBlock code={crawlSnippets.curl} language="bash" filename="crawl.sh" />
            </div>
          </div>
        )}

        {/* POST /api/schema/generate */}
        {activeEndpointTab === 'schema' && (
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <div>
              <h4 className="text-sm font-bold text-espresso-900 dark:text-white font-mono">POST /api/schema/generate</h4>
              <p className="text-xs text-espresso-600 dark:text-espresso-400 mt-1">
                AI Schema Auto-Generator that analyzes live DOM hierarchies and outputs strict extraction JSON schemas.
              </p>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300">Python Example:</h5>
              <CodeBlock code={schemaSnippets.python} language="python" filename="schema_generate.py" />

              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300 mt-3">cURL:</h5>
              <CodeBlock code={schemaSnippets.curl} language="bash" filename="schema_generate.sh" />
            </div>
          </div>
        )}

        {/* POST /api/diff */}
        {activeEndpointTab === 'diff' && (
          <div className="p-6 rounded-3xl border border-caramel-500/15 bg-white dark:bg-espresso-900/60 space-y-4 shadow-sm">
            <div>
              <h4 className="text-sm font-bold text-espresso-900 dark:text-white font-mono">POST /api/diff</h4>
              <p className="text-xs text-espresso-600 dark:text-espresso-400 mt-1">
                Content change detection and semantic difference analysis for automated price and inventory tracking.
              </p>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300">Python Example:</h5>
              <CodeBlock code={diffSnippets.python} language="python" filename="diff_example.py" />

              <h5 className="text-xs font-bold text-espresso-700 dark:text-espresso-300 mt-3">cURL:</h5>
              <CodeBlock code={diffSnippets.curl} language="bash" filename="diff.sh" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
