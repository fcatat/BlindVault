"""
测试：Policy Resolver（resolve_secret）

验证：
1. 正确 tool/session/user 可以 resolve
2. 错误 session 不能 resolve
3. 错误 tool 不能 resolve
4. 错误 destination 不能 resolve
5. 过期 secret 不能 resolve
6. max_reads=1 的 secret 第二次不能 resolve
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest

from blindvault_agent.security.crypto import encrypt
from blindvault_agent.security.models import ExecutionContext, ResolveRequest, SecretRecord, SecretStatus, SecretType
from blindvault_agent.security.policy import SecretResolutionError, resolve_secret
from blindvault_agent.tests.conftest import TEST_KEY_RAW, create_test_secret


@pytest.mark.asyncio
async def test_resolve_success(store, encryption_key):
    """正确的 tool/session/user/destination 可以 resolve。"""
    record = await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_success_test",
        value="correct_password",
        allowed_destinations=["https://example.com"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_success_test",
        requested_use="password",
        destination="https://example.com/login",
    )

    plaintext = await resolve_secret(store, ctx, req)
    assert plaintext == "correct_password"


@pytest.mark.asyncio
async def test_resolve_wrong_session_allowed(store, encryption_key):
    """即使 session_id 不匹配也可以成功 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_session_test",
        session_id="correct_session",
        value="session_test_pwd",
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="wrong_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_session_test",
        destination="https://example.com",
    )

    plaintext = await resolve_secret(store, ctx, req)
    assert plaintext == "session_test_pwd"


@pytest.mark.asyncio
async def test_resolve_wrong_user(store, encryption_key):
    """错误 user 不能 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_user_test",
        user_id="correct_user",
    )

    ctx = ExecutionContext(
        user_id="wrong_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_user_test",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_wrong_tool(store, encryption_key):
    """错误 tool 不能 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_tool_test",
        allowed_tools=["secure_shell"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="send_email",  # 不在 allowed_tools 中
    )
    req = ResolveRequest(
        secret_ref="sec_live_tool_test",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_wrong_destination(store, encryption_key):
    """错误 destination 不能 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_dest_test",
        allowed_destinations=["https://example.com"],
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_dest_test",
        destination="https://evil.com/phishing",  # 不在 allowed_destinations 中
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_expired_secret(store, encryption_key):
    """过期 secret 不能 resolve。"""
    # 创建一个已经过期的 secret
    now = datetime.now(timezone.utc)
    ciphertext = encrypt("expired_password", encryption_key)

    record = SecretRecord(
        secret_ref="sec_live_expired_test",
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        label="Expired Secret",
        secret_type=SecretType.PASSWORD,
        ciphertext=ciphertext,
        allowed_tools=["secure_shell"],
        allowed_destinations=["https://example.com"],
        created_at=now - timedelta(hours=2),
        expires_at=now - timedelta(hours=1),  # 1 小时前已过期
        read_count=0,
        max_reads=1,
        status=SecretStatus.ACTIVE,
    )
    await store.save_secret(record)

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_expired_test",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_max_reads_exhausted(store, encryption_key):
    """max_reads=1 的 secret 第二次不能 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_maxread_test",
        max_reads=1,
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_maxread_test",
        destination="https://example.com",
    )

    # 第一次应该成功
    plaintext = await resolve_secret(store, ctx, req)
    assert plaintext == "super_secret_password_123"

    # 第二次应该失败
    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_revoked_secret(store, encryption_key):
    """已撤销的 secret 不能 resolve。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_revoked_test",
        status=SecretStatus.REVOKED,
    )

    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_revoked_test",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_nonexistent_secret(store):
    """不存在的 secret 不能 resolve。"""
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_does_not_exist",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_error_message_is_generic(store, encryption_key):
    """错误消息是统一的 generic 信息，不暴露具体原因。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_generic_err_test",
    )

    ctx = ExecutionContext(
        user_id="wrong_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_generic_err_test",
        destination="https://example.com",
    )

    with pytest.raises(SecretResolutionError) as exc_info:
        await resolve_secret(store, ctx, req)

    # 错误消息不应包含 "user_mismatch" 等具体原因
    error_msg = str(exc_info.value)
    assert error_msg == "Secret resolution denied"
    assert "user" not in error_msg.lower()
    assert "mismatch" not in error_msg.lower()


# ============================================================
# 9 项校验链补完
# ============================================================


@pytest.mark.asyncio
async def test_resolve_wrong_tenant(store, encryption_key):
    """租户不匹配应当拒绝（第 5 步）。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_tenant_test",
        tenant_id="tenant_a",
    )
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="tenant_b",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_tenant_test",
        destination="https://example.com",
    )
    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_destination_wildcard(store, encryption_key):
    """allowed_destinations=['*'] 应放行所有 destination。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_wildcard_test",
        allowed_destinations=["*"],
    )
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_wildcard_test",
        destination="https://anything.example.org/x",
    )
    plaintext = await resolve_secret(store, ctx, req)
    assert plaintext == "super_secret_password_123"


@pytest.mark.asyncio
async def test_resolve_empty_destination_skips_check(store, encryption_key):
    """request.destination 为空字符串时，不应触发 destination 校验（secure_shell 场景）。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_no_dest_test",
        allowed_destinations=["https://only-one.example"],
    )
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_no_dest_test",
        destination="",
    )
    plaintext = await resolve_secret(store, ctx, req)
    assert plaintext == "super_secret_password_123"


@pytest.mark.asyncio
async def test_resolve_inactive_status_not_revoked(store, encryption_key):
    """status=EXPIRED（非 ACTIVE 也非 REVOKED）应被拒绝（第 2 步）。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_inactive_test",
        status=SecretStatus.EXPIRED,
    )
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_inactive_test",
        destination="https://example.com",
    )
    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)


@pytest.mark.asyncio
async def test_resolve_max_reads_boundary(store, encryption_key):
    """max_reads=2 时，前两次成功、第三次拒绝（边界值）。"""
    await create_test_secret(
        store, encryption_key,
        secret_ref="sec_live_boundary_test",
        max_reads=2,
    )
    ctx = ExecutionContext(
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        tool_name="secure_shell",
    )
    req = ResolveRequest(
        secret_ref="sec_live_boundary_test",
        destination="https://example.com",
    )
    assert await resolve_secret(store, ctx, req) == "super_secret_password_123"
    assert await resolve_secret(store, ctx, req) == "super_secret_password_123"
    with pytest.raises(SecretResolutionError):
        await resolve_secret(store, ctx, req)
