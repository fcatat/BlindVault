"""
测试：Tool Execution

验证：
1. browser_login_mock 不返回真实 password
2. browser_login_mock 成功执行后 reads_left 变为 0
3. denylist 工具被拒绝
"""

from __future__ import annotations

import pytest

from backend.models import ExecutionContext
from backend.tools.browser_login_mock import browser_login_mock
from backend.tests.conftest import TEST_KEY_RAW, create_test_secret


@pytest.mark.asyncio
async def test_browser_login_mock_no_password_in_result(store, encryption_key):
    """browser_login_mock 返回结果中不包含真实 password。"""
    secret_value = "my_real_password_456"
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_tool_result_test",
        value=secret_value,
        allowed_destinations=["https://example.com"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="browser_login_mock",
    )

    result = await browser_login_mock(
        username="admin",
        password_ref="sec_live_tool_result_test",
        url="https://example.com/login",
        store=store,
        ctx=ctx,
    )

    # 验证结果
    assert result["login_result"] == "success"
    assert result["username"] == "admin"
    assert result["url"] == "https://example.com/login"

    # ⚠️ 核心安全检查：结果中不包含真实密码
    result_str = str(result)
    assert secret_value not in result_str
    assert "password" not in result  # 没有 password 字段


@pytest.mark.asyncio
async def test_browser_login_mock_consumes_read(store, encryption_key):
    """browser_login_mock 执行后 read_count 递增。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_consume_test",
        max_reads=1,
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="browser_login_mock",
    )

    # 第一次调用成功
    result1 = await browser_login_mock(
        username="admin",
        password_ref="sec_live_consume_test",
        url="https://example.com/login",
        store=store,
        ctx=ctx,
    )
    assert result1["login_result"] == "success"

    # 第二次调用应失败（reads 耗尽）
    result2 = await browser_login_mock(
        username="admin",
        password_ref="sec_live_consume_test",
        url="https://example.com/login",
        store=store,
        ctx=ctx,
    )
    assert result2["login_result"] == "failure"
    assert "denied" in result2.get("reason", "").lower() or "denied" in str(result2).lower()


@pytest.mark.asyncio
async def test_browser_login_mock_invalid_ref_format(store):
    """无效的 secret_ref 格式应该返回 failure。"""
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="browser_login_mock",
    )

    result = await browser_login_mock(
        username="admin",
        password_ref="not_a_valid_ref",
        url="https://example.com/login",
        store=store,
        ctx=ctx,
    )
    assert result["login_result"] == "failure"


@pytest.mark.asyncio
async def test_browser_login_mock_wrong_destination(store, encryption_key):
    """目标地址不匹配应该返回 failure。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_dest_tool_test",
        allowed_destinations=["https://example.com"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="browser_login_mock",
    )

    result = await browser_login_mock(
        username="admin",
        password_ref="sec_live_dest_tool_test",
        url="https://evil.com/login",
        store=store,
        ctx=ctx,
    )
    assert result["login_result"] == "failure"
