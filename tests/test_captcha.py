import os
from unittest.mock import MagicMock

import pytest

from captcha_solver import CapSolver, CaptchaDetector, TwoCaptchaSolver


@pytest.mark.asyncio
async def test_captcha_detector_no_env():
    # When no env variables are set, detect_and_solve returns False
    mock_page = MagicMock()
    if "CAPTCHA_PROVIDER" in os.environ:
        del os.environ["CAPTCHA_PROVIDER"]
    if "CAPTCHA_API_KEY" in os.environ:
        del os.environ["CAPTCHA_API_KEY"]

    result = await CaptchaDetector.detect_and_solve(mock_page)
    assert result is False

@pytest.mark.asyncio
async def test_captcha_detector_unsupported_provider():
    os.environ["CAPTCHA_PROVIDER"] = "unknown_provider"
    os.environ["CAPTCHA_API_KEY"] = "some_key"
    mock_page = MagicMock()

    result = await CaptchaDetector.detect_and_solve(mock_page)
    assert result is False

    del os.environ["CAPTCHA_PROVIDER"]
    del os.environ["CAPTCHA_API_KEY"]

@pytest.mark.asyncio
async def test_2captcha_solver_initialization():
    solver = TwoCaptchaSolver("test_key")
    assert solver.api_key == "test_key"
    assert solver.BASE_URL == "https://2captcha.com"

@pytest.mark.asyncio
async def test_capsolver_initialization():
    solver = CapSolver("test_key")
    assert solver.api_key == "test_key"
    assert solver.BASE_URL == "https://api.capsolver.com"
