"""
测试：Tool Execution

验证：
1. secure_shell 不在输出中泄漏真实密码
2. secure_shell 成功执行后 read_count 递增
3. secure_shell 无效 secret_ref 格式应返回 error
4. secure_shell 危险命令被拦截
"""

from __future__ import annotations

import pytest

from backend.models import ExecutionContext
from backend.tools.secure_shell import secure_shell
from backend.tests.conftest import TEST_KEY_RAW, create_test_secret


@pytest.mark.asyncio
async def test_secure_shell_no_password_in_output(store, encryption_key):
    """secure_shell 输出结果中不包含真实密码（自动脱敏）。"""
    secret_value = "my_real_password_456"
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_tool_result_test",
        value=secret_value,
        allowed_tools=["secure_shell"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )

    result = await secure_shell(
        command="echo $SECRET",
        secret_ref="sec_live_tool_result_test",
        store=store,
        ctx=ctx,
    )

    # ⚠️ 核心安全检查：输出中不包含真实密码
    result_str = str(result)
    assert secret_value not in result_str


@pytest.mark.asyncio
async def test_secure_shell_consumes_read(store, encryption_key):
    """secure_shell 执行后 read_count 递增。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_consume_test",
        max_reads=1,
        allowed_tools=["secure_shell"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )

    # 第一次调用成功
    result1 = await secure_shell(
        command="echo $SECRET",
        secret_ref="sec_live_consume_test",
        store=store,
        ctx=ctx,
    )
    assert result1["status"] == "success"

    # 第二次调用应失败（reads 耗尽）
    result2 = await secure_shell(
        command="echo $SECRET",
        secret_ref="sec_live_consume_test",
        store=store,
        ctx=ctx,
    )
    assert result2["status"] == "error"
    assert "denied" in result2.get("reason", "").lower() or "失败" in result2.get("reason", "")


@pytest.mark.asyncio
async def test_secure_shell_invalid_ref_format(store):
    """无效的 secret_ref 格式应该返回 error。"""
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )

    result = await secure_shell(
        command="echo $SECRET",
        secret_ref="not_a_valid_ref",
        store=store,
        ctx=ctx,
    )
    assert result["status"] == "error"
    assert "invalid" in result.get("reason", "").lower()


@pytest.mark.asyncio
async def test_secure_shell_dangerous_command_blocked(store):
    """危险命令（如 rm -rf /）应该被拦截。"""
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )

    result = await secure_shell(
        command="rm -rf /",
        store=store,
        ctx=ctx,
    )
    assert result["status"] == "error"
    assert "dangerous" in result.get("reason", "").lower() or "拦截" in result.get("reason", "")
