"""
BlindVault Agent 安全模块测试配置

提供 fakeredis mock + 加密密钥 + SecretStore fixture。
从 backend/tests/conftest.py 迁移，仅调整 import 路径。
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timezone, timedelta

import fakeredis.aioredis
import pytest
import pytest_asyncio

# ---- 迁移后的 import 路径 ----
from blindvault_agent.security.config import Settings, get_settings
from blindvault_agent.security.crypto import encrypt
from blindvault_agent.security.models import ExecutionContext, SecretRecord, SecretStatus, SecretType
from blindvault_agent.security.redis_store import SecretStore

# ============================================================
# 固定测试密钥（32 字节）
# ============================================================

TEST_KEY_RAW = os.urandom(32)
TEST_KEY_B64 = base64.urlsafe_b64encode(TEST_KEY_RAW).decode()

# ============================================================
# 设置环境变量（在测试开始前）
# ============================================================

os.environ["BLINDVAULT_ENCRYPTION_KEY"] = TEST_KEY_B64
os.environ["REDIS_URL"] = "redis://localhost:6379/0"


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
        tool_name="secure_shell",
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
        allowed_tools=allowed_tools or ["secure_shell"],
        allowed_destinations=allowed_destinations or ["https://example.com"],
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
        read_count=0,
        max_reads=max_reads,
        status=status,
    )

    await store.save_secret(record)
    return record
