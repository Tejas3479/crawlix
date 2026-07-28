import httpx
from typing import Optional, Dict, Any, List

class CrawlixError(Exception):
    pass

class CrawlixClient:
    """Synchronous client for the Crawlix API."""
    def __init__(self, api_key: str, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {"x-api-key": self.api_key}
        self.client = httpx.Client(base_url=self.base_url, headers=self.headers, timeout=120.0)

    def fetch(self, url: str, **kwargs) -> Dict[str, Any]:
        """Send a single fetch request."""
        payload = {"url": url}
        payload.update(kwargs)
        response = self.client.post("/fetch", json=payload)
        self._check_response(response)
        return response.json()

    # --- Crawl Endpoints ---
    def start_crawl(self, url: str, **kwargs) -> Dict[str, Any]:
        payload = {"url": url}
        payload.update(kwargs)
        response = self.client.post("/api/crawl", json=payload)
        self._check_response(response)
        return response.json()

    def get_crawl(self, crawl_id: str) -> Dict[str, Any]:
        response = self.client.get(f"/api/crawl/{crawl_id}")
        self._check_response(response)
        return response.json()

    def list_crawls(self) -> List[Dict[str, Any]]:
        response = self.client.get("/api/crawl")
        self._check_response(response)
        return response.json()

    def delete_crawl(self, crawl_id: str) -> Dict[str, Any]:
        response = self.client.delete(f"/api/crawl/{crawl_id}")
        self._check_response(response)
        return response.json()

    def _check_response(self, response: httpx.Response):
        if not response.is_success:
            try:
                detail = response.json().get("detail", response.text)
            except Exception:
                detail = response.text
            raise CrawlixError(f"HTTP {response.status_code}: {detail}")


class AsyncCrawlixClient:
    """Asynchronous client for the Crawlix API."""
    def __init__(self, api_key: str, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {"x-api-key": self.api_key}
        self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers, timeout=120.0)

    async def fetch(self, url: str, **kwargs) -> Dict[str, Any]:
        payload = {"url": url}
        payload.update(kwargs)
        response = await self.client.post("/fetch", json=payload)
        self._check_response(response)
        return response.json()

    async def start_crawl(self, url: str, **kwargs) -> Dict[str, Any]:
        payload = {"url": url}
        payload.update(kwargs)
        response = await self.client.post("/api/crawl", json=payload)
        self._check_response(response)
        return response.json()

    async def get_crawl(self, crawl_id: str) -> Dict[str, Any]:
        response = await self.client.get(f"/api/crawl/{crawl_id}")
        self._check_response(response)
        return response.json()

    async def list_crawls(self) -> List[Dict[str, Any]]:
        response = await self.client.get("/api/crawl")
        self._check_response(response)
        return response.json()

    async def delete_crawl(self, crawl_id: str) -> Dict[str, Any]:
        response = await self.client.delete(f"/api/crawl/{crawl_id}")
        self._check_response(response)
        return response.json()

    def _check_response(self, response: httpx.Response):
        if not response.is_success:
            try:
                detail = response.json().get("detail", response.text)
            except Exception:
                detail = response.text
            raise CrawlixError(f"HTTP {response.status_code}: {detail}")
