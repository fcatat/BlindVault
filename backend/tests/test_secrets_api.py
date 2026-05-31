"""
测试：Secret Store API

验证：
1. 创建 secret 后返回 secret_ref，不返回真实 value
2. Redis 中保存的是密文，不是明文
3. 列表 API 不返回真实 value
4. 撤销 API 正常工作
"""

from __future__ import annotations

import pytest

from backend.tests.conftest import TEST_KEY_RAW


@pytest.mark.asyncio
async def test_create_secret_returns_ref_not_value(test_client):
    """创建 secret 后返回 secret_ref，不返回真实 value。"""
    response = await test_client.post(
        "/api/secrets",
        json={
            "secret_type": "password",
            "label": "Test Password",
            "value": "my_super_secret_123",
            "allowed_tools": ["browser_login_mock"],
            "allowed_destinations": ["https://example.com"],
            "ttl_seconds": 3600,
            "max_reads": 1,
        },
        headers={
            "X-User-Id": "user1",
            "X-Session-Id": "session1",
        },
    )
    assert response.status_code == 201
    data = response.json()

    # 必须包含 secret_ref
    assert "secret_ref" in data
    assert data["secret_ref"].startswith("sec_live_")

    # 必须包含 placeholder
    assert "placeholder" in data
    assert data["placeholder"].startswith("{{secret:")

    # 绝不能包含真实 value
    assert "value" not in data
    assert "my_super_secret_123" not in str(data)

    # 绝不能包含 ciphertext
    assert "ciphertext" not in data


@pytest.mark.asyncio
async def test_redis_stores_ciphertext_not_plaintext(test_client, fake_redis):
    """Redis 中保存的是密文，不是明文。"""
    response = await test_client.post(
        "/api/secrets",
        json={
            "secret_type": "password",
            "label": "Cipher Test",
            "value": "plaintext_password_xyz",
            "allowed_tools": ["browser_login_mock"],
            "ttl_seconds": 3600,
            "max_reads": 1,
        },
        headers={
            "X-User-Id": "user1",
            "X-Session-Id": "session1",
        },
    )
    assert response.status_code == 201
    secret_ref = response.json()["secret_ref"]

    # 直接读取 Redis 中的数据
    redis_key = f"test:secret:{secret_ref}"
    stored_ciphertext = await fake_redis.hget(redis_key, "ciphertext")

    # Redis 中存的不是明文
    assert stored_ciphertext is not None
    assert stored_ciphertext != "plaintext_password_xyz"
    assert "plaintext_password_xyz" not in stored_ciphertext


@pytest.mark.asyncio
async def test_list_secrets_no_value(test_client):
    """列表 API 不返回真实 value 或 ciphertext。"""
    # 先创建一个 secret
    await test_client.post(
        "/api/secrets",
        json={
            "secret_type": "api_key",
            "label": "API Key",
            "value": "sk-secret-api-key-123",
            "allowed_tools": ["browser_login_mock"],
            "ttl_seconds": 3600,
            "max_reads": 5,
        },
        headers={
            "X-User-Id": "user2",
            "X-Session-Id": "session2",
        },
    )

    # 列出 secrets
    response = await test_client.get(
        "/api/secrets",
        headers={
            "X-User-Id": "user2",
            "X-Session-Id": "session2",
        },
    )
    assert response.status_code == 200
    data = response.json()

    assert len(data) >= 1
    for item in data:
        assert "value" not in item
        assert "ciphertext" not in item
        assert "sk-secret-api-key-123" not in str(item)


@pytest.mark.asyncio
async def test_revoke_secret(test_client):
    """撤销 secret 后 status 变为 revoked。"""
    # 创建 secret
    create_resp = await test_client.post(
        "/api/secrets",
        json={
            "secret_type": "password",
            "label": "To Revoke",
            "value": "revoke_me_123",
            "allowed_tools": ["browser_login_mock"],
            "ttl_seconds": 3600,
            "max_reads": 1,
        },
        headers={
            "X-User-Id": "user3",
            "X-Session-Id": "session3",
        },
    )
    secret_ref = create_resp.json()["secret_ref"]

    # 撤销
    revoke_resp = await test_client.post(
        f"/api/secrets/{secret_ref}/revoke",
        headers={
            "X-User-Id": "user3",
            "X-Session-Id": "session3",
        },
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["status"] == "revoked"
