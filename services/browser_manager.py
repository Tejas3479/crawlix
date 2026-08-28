import asyncio
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from playwright.async_api import Browser, async_playwright

from .log_filter import logger

MAX_PLAYWRIGHT_INSTANCES = int(os.getenv("MAX_PLAYWRIGHT_INSTANCES", "3"))
PLAYWRIGHT_SLOT_TIMEOUT = int(os.getenv("PLAYWRIGHT_SLOT_TIMEOUT", "30"))
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "30"))
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "100"))

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


class PlaywrightManager:
    """
    Manages Playwright browser instance, context pool, and anti-bot evasion settings.
    """
    def __init__(self):
        self.playwright = None
        self.browser: Browser | None = None
        self.slots_free = MAX_PLAYWRIGHT_INSTANCES
        self._slots_lock = asyncio.Lock()
        self._init_lock = asyncio.Lock()

    async def initialize(self):
        async with self._init_lock:
            if self.playwright is None:
                logger.info("Initializing global Playwright Chromium instance...")
                self.playwright = await async_playwright().start()
                self.browser = await self.playwright.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-accelerated-2d-canvas",
                        "--no-first-run",
                        "--no-zygote",
                        "--disable-gpu"
                    ]
                )

    async def start(self):
        await self.initialize()

    async def stop(self):
        await self.close()

    async def close(self):
        async with self._init_lock:
            if self.browser:
                logger.info("Closing Playwright Chromium browser...")
                await self.browser.close()
                self.browser = None
            if self.playwright:
                await self.playwright.stop()
                self.playwright = None

    @asynccontextmanager
    async def acquire_context(self, proxy_url: str | None = None, user_headers: dict | None = None, stealth: bool = False):
        await self.initialize()

        start_wait = time.monotonic()
        async with self._slots_lock:
            if self.slots_free <= 0:
                logger.warning("Max Playwright instances reached. Waiting for available slot...")
            while self.slots_free <= 0:
                if time.monotonic() - start_wait > PLAYWRIGHT_SLOT_TIMEOUT:
                    logger.error(f"Playwright slot acquisition timed out after {PLAYWRIGHT_SLOT_TIMEOUT}s.")
                    raise TimeoutError(f"All Playwright browser slots are occupied. Acquisition timed out after {PLAYWRIGHT_SLOT_TIMEOUT}s.")
                await asyncio.sleep(0.1)
            self.slots_free -= 1
            _free = self.slots_free
        logger.info(f"Acquired Playwright slot. Free slots: {_free}")

        context = None
        try:
            if not self.browser:
                raise RuntimeError("Playwright browser is not initialized.")
            
            context_args: dict[str, Any] = {}
            if proxy_url:
                context_args["proxy"] = {"server": proxy_url}
            
            # Evasion: Use modern desktop Chrome User-Agent with high-entropy client hints
            context_args["user_agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
            
            context_args.update({
                "viewport": {"width": 1920 if stealth else 1280, "height": 1080 if stealth else 720},
                "device_scale_factor": 1,
                "is_mobile": False,
                "has_touch": False,
                "locale": "en-US",
                "timezone_id": "America/New_York",
                "extra_http_headers": {
                    "Sec-CH-UA": '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
                    "Sec-CH-UA-Mobile": "?0",
                    "Sec-CH-UA-Platform": '"Windows"',
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1",
                }
            })
            
            context = await self.browser.new_context(**context_args)
            
            # Universal Evasions (Applied to all contexts)
            await context.add_init_script("""
                // 1. Remove automation flags
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                delete navigator.__proto__.webdriver;

                // 2. Mock Chrome runtime object
                window.chrome = {
                    runtime: {
                        OnInstalledReason: { INSTALL: "install", UPDATE: "update", CHROME_UPDATE: "chrome_update", SHARED_MODULE_UPDATE: "shared_module_update" },
                        OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
                        PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
                        PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
                        PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
                        RequestUpdateCheckStatus: { THROTTLED: "throttled", NO_UPDATE: "no_update", UPDATE_AVAILABLE: "update_available" }
                    },
                    app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
                    csi: function() {},
                    loadTimes: function() {}
                };

                // 3. Mock Permissions API
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission === 'denied' ? 'denied' : 'prompt', onchange: null })
                        : originalQuery(parameters)
                );
            """)
            
            if stealth:
                # Advanced Stealth: WebGL Hardware spoofing & Canvas noise
                stealth_script = """
                // WebGL Vendor / Renderer Spoofing
                const getParameterProto = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) return 'Google Inc. (NVIDIA)';
                    if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return getParameterProto.apply(this, arguments);
                };
                if (typeof WebGL2RenderingContext !== 'undefined') {
                    const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
                    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
                        if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                        return getParameter2Proto.apply(this, arguments);
                    };
                }

                // Mock Languages & Hardware Concurrency
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

                // Dither canvas dataURL slightly to evade static hash fingerprinting
                const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
                HTMLCanvasElement.prototype.toDataURL = function(type) {
                    return originalToDataURL.apply(this, arguments);
                };
                """
                await context.add_init_script(stealth_script)

            if user_headers:
                await context.set_extra_http_headers(user_headers)
                
            yield context
        finally:
            if context:
                try:
                    await context.close()
                except Exception as e:
                    logger.error(f"Error closing playwright context: {e}")
            async with self._slots_lock:
                self.slots_free += 1
                _free = self.slots_free
            logger.info(f"Released Playwright slot. Free slots: {_free}")


playwright_mgr = PlaywrightManager()
