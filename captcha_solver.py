import asyncio
import logging
import os
from abc import ABC, abstractmethod

import httpx
from playwright.async_api import Page

logger = logging.getLogger("crawlix.captcha")

class BaseCaptchaSolver(ABC):
    def __init__(self, api_key: str):
        self.api_key = api_key

    @abstractmethod
    async def solve_recaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        pass

    @abstractmethod
    async def solve_hcaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        pass

    @abstractmethod
    async def solve_turnstile(self, page: Page, sitekey: str, url: str) -> str | None:
        pass

class TwoCaptchaSolver(BaseCaptchaSolver):
    """
    Integration for 2Captcha service via 2captcha HTTP API.
    """
    BASE_URL = "https://2captcha.com"

    async def _create_task(self, payload: dict) -> str | None:
        payload["key"] = self.api_key
        payload["json"] = 1
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(f"{self.BASE_URL}/in.php", data=payload)
                data = res.json()
                if data.get("status") == 1:
                    return data.get("request")
                logger.warning(f"2Captcha task creation failed: {data}")
                return None
        except Exception as e:
            logger.error(f"Error creating 2Captcha task: {e}")
            return None

    async def _get_result(self, task_id: str, timeout: int = 120) -> str | None:
        start = asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() - start < timeout:
            await asyncio.sleep(5)
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    params = {
                        "key": self.api_key,
                        "action": "get",
                        "id": task_id,
                        "json": 1
                    }
                    res = await client.get(f"{self.BASE_URL}/res.php", params=params)
                    data = res.json()
                    if data.get("status") == 1:
                        return data.get("request")
                    if data.get("request") != "CAPCHA_NOT_READY":
                        logger.warning(f"2Captcha resolution failed: {data}")
                        return None
            except Exception as e:
                logger.error(f"Error checking 2Captcha result: {e}")
        return None

    async def solve_recaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving reCAPTCHA via 2Captcha for sitekey={sitekey}...")
        task_id = await self._create_task({
            "method": "userrecaptcha",
            "googlekey": sitekey,
            "pageurl": url
        })
        if not task_id:
            return None
        return await self._get_result(task_id)

    async def solve_hcaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving hCaptcha via 2Captcha for sitekey={sitekey}...")
        task_id = await self._create_task({
            "method": "hcaptcha",
            "sitekey": sitekey,
            "pageurl": url
        })
        if not task_id:
            return None
        return await self._get_result(task_id)

    async def solve_turnstile(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving Cloudflare Turnstile via 2Captcha for sitekey={sitekey}...")
        task_id = await self._create_task({
            "method": "turnstile",
            "sitekey": sitekey,
            "pageurl": url
        })
        if not task_id:
            return None
        return await self._get_result(task_id)


class CapSolver(BaseCaptchaSolver):
    """
    Integration for CapSolver service via CapSolver API v1.
    """
    BASE_URL = "https://api.capsolver.com"

    async def _create_and_get(self, task_payload: dict, timeout: int = 120) -> str | None:
        payload = {
            "clientKey": self.api_key,
            "task": task_payload
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(f"{self.BASE_URL}/createTask", json=payload)
                data = res.json()
                if data.get("errorId") != 0:
                    logger.warning(f"CapSolver createTask failed: {data}")
                    return None
                task_id = data.get("taskId")
                if not task_id:
                    return None

                # Poll for result
                start = asyncio.get_running_loop().time()
                while asyncio.get_running_loop().time() - start < timeout:
                    await asyncio.sleep(3)
                    check_res = await client.post(
                        f"{self.BASE_URL}/getTaskResult",
                        json={"clientKey": self.api_key, "taskId": task_id}
                    )
                    check_data = check_res.json()
                    status = check_data.get("status")
                    if status == "ready":
                        solution = check_data.get("solution", {})
                        return solution.get("gRecaptchaResponse") or solution.get("token")
                    if status == "failed":
                        logger.warning(f"CapSolver task failed: {check_data}")
                        return None
        except Exception as e:
            logger.error(f"CapSolver request exception: {e}")
        return None

    async def solve_recaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving reCAPTCHA via CapSolver for sitekey={sitekey}...")
        return await self._create_and_get({
            "type": "ReCaptchaV2TaskProxyless",
            "websiteURL": url,
            "websiteKey": sitekey
        })

    async def solve_hcaptcha(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving hCaptcha via CapSolver for sitekey={sitekey}...")
        return await self._create_and_get({
            "type": "HCaptchaTaskProxyless",
            "websiteURL": url,
            "websiteKey": sitekey
        })

    async def solve_turnstile(self, page: Page, sitekey: str, url: str) -> str | None:
        logger.info(f"Solving Cloudflare Turnstile via CapSolver for sitekey={sitekey}...")
        return await self._create_and_get({
            "type": "AntiTurnstileTaskProxyless",
            "websiteURL": url,
            "websiteKey": sitekey
        })


class CaptchaDetector:
    """
    Inspects Playwright Page DOM to detect Captchas and Cloudflare challenges.
    """

    @staticmethod
    async def detect_and_solve(page: Page) -> bool:
        provider = os.getenv("CAPTCHA_PROVIDER", "").lower()
        api_key = os.getenv("CAPTCHA_API_KEY", "")

        if not provider or not api_key:
            return False

        solver: BaseCaptchaSolver | None = None
        if provider in ("2captcha", "twocaptcha"):
            solver = TwoCaptchaSolver(api_key)
        elif provider in ("capsolver",):
            solver = CapSolver(api_key)

        if not solver:
            logger.warning(f"Unsupported CAPTCHA_PROVIDER: {provider}")
            return False

        url = page.url

        # Check reCAPTCHA
        recaptcha_elem = await page.query_selector("iframe[src*='recaptcha'], [data-sitekey], #g-recaptcha")
        if recaptcha_elem:
            sitekey = await recaptcha_elem.get_attribute("data-sitekey")
            if not sitekey:
                src = await recaptcha_elem.get_attribute("src") or ""
                if "k=" in src:
                    sitekey = src.split("k=")[1].split("&")[0]
            if sitekey:
                logger.info(f"reCAPTCHA challenge detected (sitekey: {sitekey}). Solving...")
                token = await solver.solve_recaptcha(page, sitekey, url)
                if token:
                    await page.evaluate("""(token) => {
                        const inputs = document.querySelectorAll('[name="g-recaptcha-response"], #g-recaptcha-response, textarea.g-recaptcha-response');
                        inputs.forEach(el => {
                            el.value = token;
                            el.innerHTML = token;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                        if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
                            try {
                                Object.values(window.___grecaptcha_cfg.clients).forEach(client => {
                                    if (client && client.callback) client.callback(token);
                                });
                            } catch(e) {}
                        }
                    }""", token)
                    await asyncio.sleep(1)
                    return True

        # Check hCaptcha
        hcaptcha_elem = await page.query_selector("iframe[src*='hcaptcha'], [data-hcaptcha-sitekey], .h-captcha")
        if hcaptcha_elem:
            sitekey = await hcaptcha_elem.get_attribute("data-hcaptcha-sitekey") or await hcaptcha_elem.get_attribute("data-sitekey")
            if not sitekey:
                src = await hcaptcha_elem.get_attribute("src") or ""
                if "sitekey=" in src:
                    sitekey = src.split("sitekey=")[1].split("&")[0]
            if sitekey:
                logger.info(f"hCaptcha challenge detected (sitekey: {sitekey}). Solving...")
                token = await solver.solve_hcaptcha(page, sitekey, url)
                if token:
                    await page.evaluate("""(token) => {
                        const inputs = document.querySelectorAll('[name="h-captcha-response"], [name="g-recaptcha-response"], textarea[name="h-captcha-response"]');
                        inputs.forEach(el => {
                            el.value = token;
                            el.innerHTML = token;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                        if (window.hcaptcha && typeof window.hcaptcha.callback === 'function') {
                            try { window.hcaptcha.callback(token); } catch(e) {}
                        }
                    }""", token)
                    await asyncio.sleep(1)
                    return True

        # Check Cloudflare Turnstile
        turnstile_elem = await page.query_selector("iframe[src*='challenges.cloudflare.com'], .cf-turnstile, [data-turnstile-sitekey]")
        if turnstile_elem:
            sitekey = await turnstile_elem.get_attribute("data-sitekey") or await turnstile_elem.get_attribute("data-turnstile-sitekey")
            if not sitekey:
                src = await turnstile_elem.get_attribute("src") or ""
                if "sitekey=" in src:
                    sitekey = src.split("sitekey=")[1].split("&")[0]
            if sitekey:
                logger.info(f"Cloudflare Turnstile challenge detected (sitekey: {sitekey}). Solving...")
                token = await solver.solve_turnstile(page, sitekey, url)
                if token:
                    await page.evaluate("""(token) => {
                        const inputs = document.querySelectorAll('[name="cf-turnstile-response"], input[name="cf-turnstile-response"]');
                        inputs.forEach(el => {
                            el.value = token;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                        if (window.turnstile && typeof window.turnstile.callback === 'function') {
                            try { window.turnstile.callback(token); } catch(e) {}
                        }
                    }""", token)
                    await asyncio.sleep(1)
                    return True

        return False
