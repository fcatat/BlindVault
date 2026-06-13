"""
集成测试：secure_shell × HITL 审批接线（拦截点 B 审批）

🔴 安全关键测试

验证：
1. 高危命令触发 interrupt（审批时命令仅含占位符，无明文）
2. approve 后执行，且 resolve_secret 只调一次（不重复消耗 read_count）
3. reject 后不执行
4. 非高危命令不触发 interrupt
"""

from __future__ import annotations

import asyncio
import base64
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import fakeredis.aioredis
import pytest
import pytest_asyncio

from blindvault_agent.security.crypto import encrypt
from blindvault_agent.security.models import (
    ExecutionContext, SecretRecord, SecretStatus, SecretType,
)
from blindvault_agent.security.redis_store import SecretStore
from blindvault_agent.tools.secure_shell import secure_shell
from blindvault_agent.middleware.hitl import HighRiskCommandRejected
from blindvault_agent.tests.conftest import TEST_KEY_RAW


# ============================================================
# Fixtures
# ============================================================


@pytest_asyncio.fixture
async def fake_redis():
    server = fakeredis.aioredis.FakeServer()
    client = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def store(fake_redis):
    return SecretStore(fake_redis, key_prefix="test:")


@pytest.fixture
def ctx():
    return ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )


async def create_secret(store, ref="sec_live_test123", value="RealPassword123", max_reads=99):
    """创建测试 secret 并返回 ref。"""
    now = datetime.now(timezone.utc)
    ciphertext = encrypt(value, TEST_KEY_RAW)
    record = SecretRecord(
        secret_ref=ref,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        label="test",
        secret_type=SecretType.PASSWORD,
        ciphertext=ciphertext,
        allowed_tools=["secure_shell"],
        allowed_destinations=[],
        created_at=now,
        expires_at=now + timedelta(hours=1),
        read_count=0,
        max_reads=max_reads,
        status=SecretStatus.ACTIVE,
    )
    await store.save_secret(record)
    return ref


class MockExecutor:
    """记录收到的命令。"""
    def __init__(self, stdout="ok", stderr="", exit_code=0):
        self.commands = []
        self._stdout = stdout
        self._stderr = stderr
        self._exit_code = exit_code

    async def __call__(self, command):
        self.commands.append(command)
        return {
            "stdout": self._stdout,
            "stderr": self._stderr,
            "exit_code": self._exit_code,
        }


# ============================================================
# 集成测试
# ============================================================


@pytest.mark.asyncio
async def test_high_risk_triggers_interrupt(store, ctx):
    """
    高危命令应触发 interrupt。

    mock interrupt 使其直接返回 approve 决策，
    验证 interrupt 被调用且命令中只有占位符。
    """
    await create_secret(store, "sec_live_drop", "DropPwd123")
    executor = MockExecutor()

    # mock interrupt 返回 approve
    mock_interrupt = MagicMock(return_value={
        "decisions": [{"type": "approve"}]
    })

    with patch("blindvault_agent.middleware.hitl.interrupt", mock_interrupt):
        result = await secure_shell(
            command="psql postgresql://user:$SECRET@host/db -c 'DROP DATABASE prod'",
            secret_ref="sec_live_drop",
            store=store,
            ctx=ctx,
            executor=executor,
        )

    # interrupt 应被调用
    assert mock_interrupt.called
    call_args = mock_interrupt.call_args[0][0]
    assert call_args["type"] == "high_risk_command"
    assert "DROP DATABASE" in call_args["command"]
    # 审批时命令中只有占位符 $SECRET，不含真实密码
    assert "DropPwd123" not in call_args["command"]
    assert "$SECRET" in call_args["command"]

    # approve 后应成功执行
    assert result["status"] == "success"
    # executor 收到的命令应含真实密码（resolve 后）
    assert len(executor.commands) == 1
    assert "DropPwd123" in executor.commands[0]


@pytest.mark.asyncio
async def test_high_risk_reject_blocks_execution(store, ctx):
    """
    高危命令 reject 后不执行。

    mock interrupt 返回 reject，验证工具不执行。
    """
    await create_secret(store, "sec_live_rejecttest", "RejectPwd")
    executor = MockExecutor()

    # mock interrupt 返回 reject
    mock_interrupt = MagicMock(return_value={
        "decisions": [{"type": "reject"}]
    })

    with patch("blindvault_agent.middleware.hitl.interrupt", mock_interrupt):
        result = await secure_shell(
            command="rm -rf / --no-preserve-root",
            store=store,
            ctx=ctx,
            executor=executor,
        )

    # 应返回 error
    assert result["status"] == "error"
    assert "拒绝" in result["reason"]
    # executor 不应被调用
    assert len(executor.commands) == 0


@pytest.mark.asyncio
async def test_non_high_risk_no_interrupt(store, ctx):
    """
    非高危命令不触发 interrupt，直接执行。
    """
    executor = MockExecutor(stdout="disk usage")

    # mock interrupt —— 不应被调用
    mock_interrupt = MagicMock()

    with patch("blindvault_agent.middleware.hitl.interrupt", mock_interrupt):
        result = await secure_shell(
            command="df -h",
            store=store,
            ctx=ctx,
            executor=executor,
        )

    # interrupt 不应被调用
    assert not mock_interrupt.called
    assert result["status"] == "success"
    assert result["stdout"] == "disk usage"


@pytest.mark.asyncio
async def test_approve_resolves_only_once(store, ctx):
    """
    核心验证：approve 后 resolve_secret 只调用一次。

    interrupt 后节点从头重跑，必须确认 resolve 在 interrupt 之后，
    不会重复消耗 read_count。

    验证方式：设 max_reads=1 的 secret，高危命令 approve 后执行成功
    （如果 resolve 被调了两次，第二次会因 read_count 耗尽而失败）。
    """
    await create_secret(store, "sec_live_once", "OncePwd!", max_reads=1)
    executor = MockExecutor()

    # mock interrupt 返回 approve
    mock_interrupt = MagicMock(return_value={
        "decisions": [{"type": "approve"}]
    })

    with patch("blindvault_agent.middleware.hitl.interrupt", mock_interrupt):
        result = await secure_shell(
            command="psql postgresql://user:$SECRET@host/db -c 'DROP TABLE temp'",
            secret_ref="sec_live_once",
            store=store,
            ctx=ctx,
            executor=executor,
        )

    # 高危命令，interrupt 应被调用
    assert mock_interrupt.called

    # approve 后应成功（如果 resolve 调了两次会失败，因为 max_reads=1）
    assert result["status"] == "success"
    assert "OncePwd!" in executor.commands[0]

    # 验证 read_count 恰好为 1（只 resolve 了一次）
    record = await store.get_secret("sec_live_once")
    assert record.read_count == 1


@pytest.mark.asyncio
async def test_interrupt_sees_placeholder_not_plaintext(store, ctx):
    """
    安全铁律验证：interrupt 审批数据中绝不含明文密码。

    即使命令含 {{secret:xxx}} 格式占位符，审批数据中也只有占位符。
    """
    await create_secret(store, "sec_live_safe_review", "TopSecret!")
    executor = MockExecutor()

    mock_interrupt = MagicMock(return_value={
        "decisions": [{"type": "approve"}]
    })

    with patch("blindvault_agent.middleware.hitl.interrupt", mock_interrupt):
        result = await secure_shell(
            command="psql postgresql://user:{{secret:sec_live_safe_review}}@host/db -c 'DROP DATABASE staging'",
            store=store,
            ctx=ctx,
            executor=executor,
        )

    # interrupt 被调用
    assert mock_interrupt.called
    call_data = mock_interrupt.call_args[0][0]
    # 审批数据中绝不含明文
    assert "TopSecret!" not in str(call_data)
    # 审批数据中含占位符
    assert "{{secret:" in call_data["command"] or "$SECRET" in call_data["command"]
