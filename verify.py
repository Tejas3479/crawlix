import asyncio
import os
import sys
import httpx

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
API_KEY = os.getenv("API_KEY", "")

async def run_tests():
    headers = {"x-api-key": API_KEY} if API_KEY else {}
    passed = 0
    total = 10

    async with httpx.AsyncClient(timeout=90.0) as client:
        # TEST 1 — health endpoint
        try:
            r1 = await client.get(f"{BASE_URL}/api/health")
            assert r1.status_code == 200, f"Expected status code 200, got {r1.status_code}"
            data = r1.json()
            assert data.get("status") == "ok", f"Expected health status 'ok', got {data.get('status')}"
            print("[PASS] Health endpoint")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Health endpoint: {e}")

        # TEST 2 — curl_cffi basic fetch
        try:
            payload = {"url": "https://httpbin.org/get", "output_format": "html"}
            r2 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r2.status_code == 200, f"Expected status code 200, got {r2.status_code}"
            data = r2.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            assert data.get("status_code") == 200, f"Expected site status code 200, got {data.get('status_code')}"
            content = data.get("content", "")
            assert "httpbin" in content.lower() or len(content) > 100, "Content assertion failed"
            print("[PASS] curl_cffi basic fetch")
            passed += 1
        except Exception as e:
            print(f"[FAIL] curl_cffi basic fetch: {e}")

        # TEST 3 — markdown output + noise stripped
        try:
            payload = {"url": "https://example.com", "output_format": "markdown"}
            r3 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r3.status_code == 200, f"Expected status code 200, got {r3.status_code}"
            data = r3.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            content = data.get("content", "")
            assert "<script" not in content, "Found script tag in clean markdown"
            assert "<style" not in content, "Found style tag in clean markdown"
            assert len(content.strip()) > 0, "Clean markdown is empty"
            print("[PASS] Markdown output clean")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Markdown output clean: {e}")

        # TEST 4 — structured JSON extraction
        try:
            payload = {"url": "https://example.com", "output_format": "structured"}
            r4 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r4.status_code == 200, f"Expected status code 200, got {r4.status_code}"
            data = r4.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            content = data.get("content")
            assert isinstance(content, dict), f"Expected dict content, got {type(content)}"
            assert "title" in content, "Title key not in content"
            assert "links" in content, "Links key not in content"
            assert "h1" in content, "h1 key not in content"
            assert isinstance(content["links"], list), f"Expected links to be list, got {type(content['links'])}"
            print("[PASS] Structured extraction schema correct")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Structured extraction schema correct: {e}")

        # TEST 5 — session cookie persistence
        try:
            p5_1 = {
                "url": "https://httpbin.org/cookies/set?fetchtest=hello123",
                "session_id": "verify-session-001",
                "output_format": "html"
            }
            r5_1 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=p5_1)
            assert r5_1.status_code == 200, f"Request 1 expected status 200, got {r5_1.status_code}"
            
            p5_2 = {
                "url": "https://httpbin.org/cookies",
                "session_id": "verify-session-001",
                "output_format": "html"
            }
            r5_2 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=p5_2)
            assert r5_2.status_code == 200, f"Request 2 expected status 200, got {r5_2.status_code}"
            data = r5_2.json()
            assert "hello123" in data.get("content", ""), "Cookie not found in response content"
            print("[PASS] Session cookie persistence")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Session cookie persistence: {e}")

        # TEST 6 — session list + delete
        try:
            r6_1 = await client.get(f"{BASE_URL}/api/sessions", headers=headers)
            assert r6_1.status_code == 200, f"GET sessions expected status 200, got {r6_1.status_code}"
            sessions = r6_1.json()
            assert isinstance(sessions, list), f"Expected sessions list, got {type(sessions)}"
            
            session_ids = [s["session_id"] for s in sessions]
            assert "verify-session-001" in session_ids, "verify-session-001 not found in session list"
            
            r6_2 = await client.delete(f"{BASE_URL}/api/sessions/verify-session-001", headers=headers)
            assert r6_2.status_code == 200, f"DELETE session expected status 200, got {r6_2.status_code}"
            del_data = r6_2.json()
            assert del_data.get("deleted") is True, f"Expected deleted True, got {del_data.get('deleted')}"
            
            r6_3 = await client.get(f"{BASE_URL}/api/sessions", headers=headers)
            assert r6_3.status_code == 200, f"GET sessions 2 expected status 200, got {r6_3.status_code}"
            sessions_after = r6_3.json()
            session_ids_after = [s["session_id"] for s in sessions_after]
            assert "verify-session-001" not in session_ids_after, "verify-session-001 was not removed from sessions list"
            print("[PASS] Session list + delete")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Session list + delete: {e}")

        # TEST 7 — CSS Selector Targeted Pruning
        try:
            payload = {
                "url": "https://example.com",
                "output_format": "html",
                "css_selector": "h1"
            }
            r7 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r7.status_code == 200, f"Expected status code 200, got {r7.status_code}"
            data = r7.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            content = data.get("content", "")
            # Only h1 should be returned, body or html tags should not be present in the pruned content
            assert "example domain" in content.lower(), f"Expected header text not found: {content}"
            assert "<body>" not in content.lower(), f"Found body tag in pruned content: {content}"
            print("[PASS] Targeted CSS selector DOM pruning")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Targeted CSS selector DOM pruning: {e}")

        # TEST 8 — screenshot basic capture
        try:
            payload = {
                "url": "https://example.com",
                "render_js": True,
                "screenshot": True
            }
            r8 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r8.status_code == 200, f"Expected status code 200, got {r8.status_code}"
            data = r8.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            screenshot = data.get("screenshot")
            assert screenshot is not None, "Screenshot was not returned"
            assert screenshot.startswith("data:image/png;base64,"), f"Invalid screenshot format: {screenshot[:30]}"
            print("[PASS] Screenshot capture returned base64 data URL")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Screenshot capture: {e}")

        # TEST 9 — browser actions (click)
        try:
            payload = {
                "url": "https://example.com",
                "render_js": True,
                "actions": [
                    {"type": "click", "selector": "a"},
                    {"type": "wait", "duration": 1}
                ]
            }
            r9 = await client.post(f"{BASE_URL}/fetch", headers=headers, json=payload)
            assert r9.status_code == 200, f"Expected status code 200, got {r9.status_code}"
            data = r9.json()
            assert data.get("success") is True, f"Expected success True, got {data.get('success')}"
            final_url = data.get("url", "")
            assert "iana.org" in final_url.lower(), f"Expected final url to be iana.org, got {final_url}"
            print("[PASS] Browser action click navigated successfully")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Browser action click: {e}")

        # TEST 10 — background website crawler
        try:
            payload = {
                "url": "https://httpbin.org",
                "max_pages": 2,
                "limit_domain": True,
                "output_format": "markdown"
            }
            r10 = await client.post(f"{BASE_URL}/api/crawl", headers=headers, json=payload)
            assert r10.status_code == 200, f"Expected status code 200 starting crawl, got {r10.status_code}"
            crawl_data = r10.json()
            crawl_id = crawl_data.get("crawl_id")
            assert crawl_id is not None, "Crawl ID not returned"
            
            # Poll for crawl completion
            completed = False
            for _ in range(15):
                await asyncio.sleep(2)
                r_status = await client.get(f"{BASE_URL}/api/crawl/{crawl_id}", headers=headers)
                assert r_status.status_code == 200, f"Status check failed: {r_status.status_code}"
                status_data = r_status.json()
                if status_data.get("status") in ("completed", "failed"):
                    completed = True
                    assert len(status_data.get("results", [])) > 0, "Crawl results empty"
                    assert status_data["pages_crawled"] > 0, "Crawl pages crawled is 0"
                    break
            assert completed, f"Crawl did not finish in time"
            
            # Delete crawl
            r_del = await client.delete(f"{BASE_URL}/api/crawl/{crawl_id}", headers=headers)
            assert r_del.status_code == 200, f"DELETE crawl expected status 200, got {r_del.status_code}"
            
            # Confirm deleted
            r_check = await client.get(f"{BASE_URL}/api/crawl", headers=headers)
            crawls = r_check.json()
            assert not any(c["crawl_id"] == crawl_id for c in crawls), "Crawl job was not deleted"
            
            print("[PASS] Background website crawler and details polling")
            passed += 1
        except Exception as e:
            print(f"[FAIL] Background website crawler: {e}")

    print(f"\n{passed}/{total} tests passed")

if __name__ == "__main__":
    asyncio.run(run_tests())
