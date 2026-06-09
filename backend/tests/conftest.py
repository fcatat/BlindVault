"""
BlindVault 测试配置

提供：
- fakeredis mock Redis 客户端
- 预设的加密密钥
- SecretStore fixture
- FastAPI TestClient fixture
- 辅助函数（创建测试 secret 等）
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timezone, timedelta

import fakeredis.aioredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from backend.config import Settings, get_settings
from backend.crypto import encrypt
from backend.models import ExecutionContext, SecretRecord, SecretStatus, SecretType
from backend.redis_store import SecretStore
from backend.tools.browser_login_mock import browser_login_mock, BROWSER_LOGIN_MOCK_SCHEMA
from backend.tools.registry import register_tool

# ============================================================
# 固定测试密钥（32 字节）
# ============================================================

TEST_KEY_RAW = os.urandom(32)
TEST_KEY_B64 = base64.urlsafe_b64encode(TEST_KEY_RAW).decode()


# ============================================================
# 设置环境变量（在导入 app 前）
# ============================================================

os.environ["BLINDVAULT_ENCRYPTION_KEY"] = TEST_KEY_B64
os.environ["REDIS_URL"] = "redis://localhost:6379/0"  # 不会真正使用
os.environ["LLM_PROVIDER"] = "mock"
os.environ["DATABASE_URL"] = "postgresql://blindvault:blindvault_default_pg_pass@127.0.0.1:5433/blindvault"


# ============================================================
# Fixtures
# ============================================================


@pytest_asyncio.fixture
async def fake_redis():
    """创建 fakeredis 异步客户端。"""
    server = fakeredis.aioredis.FakeServer()
    client = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def store(fake_redis):
    """创建使用 fakeredis 的 SecretStore。"""
    return SecretStore(fake_redis, key_prefix="test:")


@pytest_asyncio.fixture
async def test_client(fake_redis, store, monkeypatch):
    """创建 FastAPI 异步测试客户端。"""
    # 用 fakeredis 替换全局 redis 客户端和 store
    import backend.redis_store as rs
    monkeypatch.setattr(rs, "_redis_client", fake_redis)
    monkeypatch.setattr(rs, "_store_instance", store)

    # 清除 settings 缓存以使用测试环境变量
    get_settings.cache_clear()

    # 注册测试工具
    register_tool(
        name="browser_login_mock",
        description="模拟浏览器登录",
        parameters=BROWSER_LOGIN_MOCK_SCHEMA,
        func=browser_login_mock,
    )

    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def encryption_key() -> bytes:
    """测试用加密密钥。"""
    return TEST_KEY_RAW


@pytest.fixture
def test_ctx() -> ExecutionContext:
    """测试用执行上下文。"""
    return ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="browser_login_mock",
    )


# ============================================================
# 辅助函数
# ============================================================


async def create_test_secret(
    store: SecretStore,
    key: bytes,
    secret_ref: str = "sec_live_test123456789",
    value: str = "super_secret_password_123",
    user_id: str = "test_user",
    session_id: str = "test_session",
    tenant_id: str = "default",
    allowed_tools: list[str] | None = None,
    allowed_destinations: list[str] | None = None,
    ttl_seconds: int = 3600,
    max_reads: int = 1,
    status: SecretStatus = SecretStatus.ACTIVE,
) -> SecretRecord:
    """创建并保存测试 secret。"""
    now = datetime.now(timezone.utc)
    ciphertext = encrypt(value, key)

    record = SecretRecord(
        secret_ref=secret_ref,
        user_id=user_id,
        session_id=session_id,
        tenant_id=tenant_id,
        label="Test Secret",
        secret_type=SecretType.PASSWORD,
        ciphertext=ciphertext,
        allowed_tools=allowed_tools or ["browser_login_mock"],
        allowed_destinations=allowed_destinations or ["https://example.com"],
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
        read_count=0,
        max_reads=max_reads,
        status=status,
    )

    await store.save_secret(record)
    return record
