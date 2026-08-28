import os
import pytest
from httpx import AsyncClient, ASGITransport
from app import app
from services.content import clean_markdown_for_llm, auto_generate_schema


@pytest.mark.asyncio
async def test_clean_markdown_for_llm():
    sample = """# Title
[Home](/) | [About](/about) | [Pricing](/pricing) | [Blog](/blog)
This is genuine valuable content for an LLM to read and summarize.
![decorative image](https://example.com/logo.png)
Accept our cookie policy and privacy policy terms. All rights reserved.
"""
    cleaned = clean_markdown_for_llm(sample)
    assert "genuine valuable content" in cleaned
    assert "cookie policy" not in cleaned
    assert "![decorative" not in cleaned


@pytest.mark.asyncio
async def test_schema_generator_heuristic():
    sample_html = """
    <html>
        <body>
            <div class="product-card">
                <h2>MacBook Pro 16</h2>
                <span class="price">$2,499</span>
                <p class="description">Apple M3 Max chip with 36GB Unified Memory.</p>
                <a href="/products/macbook-16">View Details</a>
            </div>
            <div class="product-card">
                <h2>MacBook Air 15</h2>
                <span class="price">$1,299</span>
                <p class="description">Apple M3 chip, thin and lightweight.</p>
                <a href="/products/macbook-air">View Details</a>
            </div>
        </body>
    </html>
    """
    res = await auto_generate_schema(html=sample_html, url="https://example.com/shop")
    assert res["schema_definition"]["baseSelector"] == ".product-card"
    field_names = [f["name"] for f in res["suggested_fields"]]
    assert "title" in field_names
    assert "price" in field_names


@pytest.mark.asyncio
async def test_api_keys_lifecycle_and_webhooks():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create key
        create_res = await client.post(
            "/api/keys",
            json={"name": "Test Key", "rate_limit": 120}
        )
        assert create_res.status_code == 200
        key_data = create_res.json()
        assert key_data["key"].startswith("crawlix_")
        assert key_data["rate_limit"] == 120

        tenant_headers = {"x-api-key": key_data["key"]}

        # List keys using the newly created tenant key
        list_res = await client.get("/api/keys", headers=tenant_headers)
        assert list_res.status_code == 200
        assert any(k["key"] == key_data["key"] for k in list_res.json())

        # Test Webhook simulator endpoint
        wh_res = await client.post(
            "/api/webhooks/test",
            json={"target_url": "https://httpbin.org/post", "secret": "test_secret"},
            headers=tenant_headers
        )
        assert wh_res.status_code == 200
        assert wh_res.json()["signature_header"].startswith("sha256=")

        # Delete key
        del_res = await client.delete(f"/api/keys/{key_data['key']}", headers=tenant_headers)
        assert del_res.status_code == 200


@pytest.mark.asyncio
async def test_document_parser_and_diff():
    from services.content import parse_document_to_markdown, compute_content_diff

    # Test CSV parsing to Markdown
    csv_bytes = b"Product,Price,Stock\nMacBook Pro,$2499,In Stock\nAirPods,$199,Available"
    md_table = parse_document_to_markdown(csv_bytes, file_type="csv")
    assert "| Product | Price | Stock |" in md_table
    assert "| MacBook Pro | $2499 | In Stock |" in md_table

    # Test Content Diff
    old_text = "Price: $1,299\nStock: Out of Stock\nRating: 4.8"
    new_text = "Price: $1,199\nStock: In Stock\nRating: 4.8"
    diff_res = compute_content_diff(old_text, new_text)
    assert diff_res["has_changed"] is True
    assert diff_res["additions_count"] > 0
    assert diff_res["deletions_count"] > 0

    # Test POST /api/diff endpoint
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/diff",
            json={"old_content": old_text, "new_content": new_text}
        )
        assert res.status_code == 200
        assert res.json()["has_changed"] is True
