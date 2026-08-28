"""
Crawlix Model Context Protocol (MCP) Stdio Server
Provides direct STDIO communication for Claude Desktop, Cursor, and MCP clients.
Usage:
    python -m mcp_server
    or
    python mcp_server.py
"""

import asyncio
import json
import logging
import sys
from typing import Any

from database import init_db
from fetcher import crawl_manager, playwright_mgr, run_fetch
from services.map import map_site
from services.search import search

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger("crawlix.mcp_stdio")

SERVER_INFO = {"name": "crawlix", "version": "1.0.0"}
PROTOCOL_VERSION = "2025-06-18"

TOOLS: list[dict] = [
    {
        "name": "scrape",
        "description": "Fetch a single URL and extract its content as HTML, markdown, structured JSON (LLM), or selector-based JSON (css).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Target URL to scrape."},
                "output_format": {
                    "type": "string",
                    "enum": ["html", "markdown", "structured", "css"],
                    "default": "markdown",
                },
                "strip_links": {"type": "boolean", "default": False},
                "render_js": {"type": "boolean", "default": False},
                "css_selector": {"type": "string", "description": "DOM pruning selector."},
                "json_schema": {"type": "object", "description": "JSON schema for structured or css extraction."},
                "extraction_prompt": {"type": "string"},
                "bypass_cache": {"type": "boolean", "default": False},
            },
            "required": ["url"],
        },
    },
    {
        "name": "map",
        "description": "Discover the URLs of a site via sitemap.xml and link-based BFS.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "limit": {"type": "integer", "default": 100},
                "include_sitemap": {"type": "boolean", "default": True},
                "allow_subdomains": {"type": "boolean", "default": False},
            },
            "required": ["url"],
        },
    },
    {
        "name": "crawl",
        "description": "Start an asynchronous crawl of a site. Returns a crawl_id to poll with the get_crawl tool.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "max_pages": {"type": "integer", "default": 10},
                "max_depth": {"type": "integer", "default": 3},
                "render_js": {"type": "boolean", "default": False},
                "output_format": {
                    "type": "string",
                    "enum": ["html", "markdown", "structured", "css"],
                    "default": "markdown",
                },
                "limit_domain": {"type": "boolean", "default": True},
                "respect_robots": {"type": "boolean", "default": True},
            },
            "required": ["url"],
        },
    },
    {
        "name": "get_crawl",
        "description": "Poll the status and results of a crawl started with the crawl tool.",
        "inputSchema": {
            "type": "object",
            "properties": {"crawl_id": {"type": "string"}},
            "required": ["crawl_id"],
        },
    },
    {
        "name": "search",
        "description": "Search the web and optionally fetch content of the top results.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "provider": {"type": "string", "enum": ["duckduckgo", "serper"], "default": "duckduckgo"},
                "max_results": {"type": "integer", "default": 10},
                "fetch_content": {"type": "boolean", "default": False},
            },
            "required": ["query"],
        },
    },
    {
        "name": "health",
        "description": "Check the Crawlix server health.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


async def _handle_tool_call(name: str, arguments: dict) -> dict[str, Any]:
    if name == "scrape":
        result = await run_fetch(
            url=arguments["url"],
            method="GET",
            headers={},
            cookies={},
            body=None,
            json_body=None,
            session=None,
            render_js=bool(arguments.get("render_js", False)),
            scroll=True,
            proxy_url=None,
            max_retries=1,
            timeout=30,
            impersonate="chrome120",
            playwright_mgr=playwright_mgr,
            output_format=arguments.get("output_format", "markdown"),
            strip_links=bool(arguments.get("strip_links", False)),
            llm_api_key=None,
            llm_provider="openai",
            json_schema=arguments.get("json_schema"),
            css_selector=arguments.get("css_selector"),
            extraction_prompt=arguments.get("extraction_prompt"),
            bypass_cache=bool(arguments.get("bypass_cache", False)),
        )
        return {
            "url": result.get("final_url"),
            "status_code": result.get("status_code"),
            "content": result.get("content"),
            "error": result.get("error"),
            "error_message": result.get("error_message"),
        }

    if name == "map":
        result = await map_site(
            url=arguments["url"],
            limit=int(arguments.get("limit", 100)),
            include_sitemap=bool(arguments.get("include_sitemap", True)),
            allow_subdomains=bool(arguments.get("allow_subdomains", False)),
        )
        return {
            "urls": result.get("urls", []),
            "count": result.get("count", 0),
            "discovered_via": result.get("discovered_via"),
            "error": result.get("error"),
        }

    if name == "crawl":
        crawl_id = await crawl_manager.create_crawl(
            url=arguments["url"],
            max_pages=int(arguments.get("max_pages", 10)),
            max_depth=int(arguments.get("max_depth", 3)),
            render_js=bool(arguments.get("render_js", False)),
            output_format=arguments.get("output_format", "markdown"),
            strip_links=False,
            css_selector=None,
            limit_domain=bool(arguments.get("limit_domain", True)),
            actions=None,
            respect_robots=bool(arguments.get("respect_robots", True)),
            json_schema=arguments.get("json_schema"),
        )
        return {"crawl_id": crawl_id, "status": "running"}

    if name == "get_crawl":
        crawl = await crawl_manager.get_crawl(arguments["crawl_id"])
        if crawl is None:
            return {"error": "crawl_not_found"}
        return {
            "status": crawl.get("status"),
            "pages_crawled": (crawl.get("stats") or {}).get("pages_crawled", 0),
            "results": crawl.get("results", []),
            "error_message": crawl.get("error_message"),
        }

    if name == "search":
        result = await search(
            query=arguments["query"],
            provider=arguments.get("provider", "duckduckgo"),
            max_results=int(arguments.get("max_results", 10)),
        )
        return {"results": result.get("results", []), "error": result.get("error")}

    if name == "health":
        return {"status": "ok"}

    return {"error": f"unknown tool: {name}"}


async def _dispatch_rpc(req: dict) -> dict | None:
    msg_id = req.get("id")
    method = req.get("method")
    params = req.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        }

    if method in ("notifications/initialized", "notifications/cancelled"):
        return None

    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {"tools": TOOLS},
        }

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not name:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32602, "message": "Missing tool name"},
            }
        try:
            payload = await _handle_tool_call(name, arguments)
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}],
                    "isError": False,
                },
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": f"Tool {name} failed: {e}"}],
                    "isError": True,
                },
            }

    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}}

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


async def main():
    await init_db()
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode("utf-8").strip()
        if not text:
            continue
        try:
            req = json.loads(text)
            resp = await _dispatch_rpc(req)
            if resp is not None:
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()
        except Exception as e:
            err = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {e}"}}
            sys.stdout.write(json.dumps(err) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
