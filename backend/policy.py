"""
BlindVault 权限校验引擎

resolve_secret 是整个系统的安全核心：
- 只能被 Tool Executor 内部调用，不暴露给 API
- 9 项校验链，任何一项失败都返回统一的 generic forbidden
- 校验通过后原子递增 read_count，再解密返回明文
- 所有错误信息不暴露具体失败原因
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from backend.config import get_settings
from backend.crypto import decrypt
from backend.models import ExecutionContext, ResolveRequest, SecretRecord, SecretStatus
from backend.redis_store import SecretStore

logger = logging.getLogger(__name__)


class SecretResolutionError(Exception):
    """
    Secret 解析失败。

    错误信息统一为 generic 内容，不暴露具体失败原因。
    内部 reason 仅用于服务端日志（脱敏后）。
    """

    def __init__(self, reason: str = ""):
        self._reason = reason  # 内部使用，不暴露给调用者
        super().__init__("Secret resolution denied")


def _match_origin(destination: str, allowed_destinations: list[str]) -> bool:
    """
    检查 destination 是否匹配 allowed_destinations（origin 级别匹配）。

    匹配规则：
    - 比较 scheme + netloc（忽略路径）
    - 支持通配符 "*"（匹配所有）
    - 空 allowed_destinations 列表表示不限制
    """
    if not allowed_destinations:
        return True

    if "*" in allowed_destinations:
        return True

    try:
        parsed = urlparse(destination)
        dest_origin = f"{parsed.scheme}://{parsed.netloc}".lower().rstrip("/")
    except Exception:
        return False

    for allowed in allowed_destinations:
        try:
            parsed_allowed = urlparse(allowed)
            allowed_origin = f"{parsed_allowed.scheme}://{parsed_allowed.netloc}".lower().rstrip("/")
            if dest_origin == allowed_origin:
                return True
        except Exception:
            continue

    return False


async def resolve_secret(
    store: SecretStore,
    ctx: ExecutionContext,
    request: ResolveRequest,
) -> str:
    """
    解析 secret_ref 为真实 secret 值。

    **安全核心函数**——只能被 Tool Executor 内部调用。

    校验链（按顺序，任何一步失败都抛出 SecretResolutionError）：
    1. Secret 存在性
    2. status == active
    3. user_id 匹配
    4. session_id 匹配
    5. tenant_id 匹配
    6. tool_name 在 allowed_tools 中
    7. destination 在 allowed_destinations 中
    8. 未过期
    9. read_count < max_reads

    校验通过 → 原子递增 read_count → 解密返回明文。

    Args:
        store: Redis 存储实例
        ctx: 执行上下文（user_id, session_id, tenant_id, tool_name）
        request: 解析请求（secret_ref, destination）

    Returns:
        解密后的明文 secret

    Raises:
        SecretResolutionError: 任何校验失败（统一错误信息）
    """
    secret_ref = request.secret_ref

    # 1. 检查 secret 存在性
    record = await store.get_secret(secret_ref)
    if record is None:
        logger.warning("Secret 解析失败: ref 不存在")
        raise SecretResolutionError("not_found")

    # 2. 检查 status
    if record.status != SecretStatus.ACTIVE:
        logger.warning("Secret 解析失败: status=%s", record.status.value)
        raise SecretResolutionError("inactive")

    # 3. 检查 user_id
    if record.user_id != ctx.user_id:
        logger.warning("Secret 解析失败: user_id 不匹配")
        raise SecretResolutionError("user_mismatch")

    # 4. 检查 session_id
    if record.session_id != ctx.session_id:
        logger.warning("Secret 解析失败: session_id 不匹配")
        raise SecretResolutionError("session_mismatch")

    # 5. 检查 tenant_id
    if record.tenant_id != ctx.tenant_id:
        logger.warning("Secret 解析失败: tenant_id 不匹配")
        raise SecretResolutionError("tenant_mismatch")

    # 6. 检查 tool_name
    if ctx.tool_name not in record.allowed_tools:
        logger.warning("Secret 解析失败: tool_name=%s 不在 allowed_tools 中", ctx.tool_name)
        raise SecretResolutionError("tool_not_allowed")

    # 7. 检查 destination
    if request.destination and not _match_origin(request.destination, record.allowed_destinations):
        logger.warning("Secret 解析失败: destination 不匹配")
        raise SecretResolutionError("destination_not_allowed")

    # 8. 检查是否过期
    now = datetime.now(timezone.utc)
    if record.expires_at <= now:
        await store.update_status(secret_ref, SecretStatus.EXPIRED)
        logger.warning("Secret 解析失败: 已过期")
        raise SecretResolutionError("expired")

    # 9. 检查 read_count
    if record.read_count >= record.max_reads:
        await store.update_status(secret_ref, SecretStatus.EXHAUSTED)
        logger.warning("Secret 解析失败: 读取次数已耗尽")
        raise SecretResolutionError("exhausted")

    # ---- 所有校验通过 ----

    # 原子递增 read_count
    new_count = await store.increment_read_count(secret_ref)

    # 再次检查（防止并发竞争）
    if new_count > record.max_reads:
        logger.warning("Secret 解析失败: 并发竞争导致超额读取")
        raise SecretResolutionError("exhausted_concurrent")

    # 如果已达到 max_reads，更新状态
    if new_count >= record.max_reads:
        await store.update_status(secret_ref, SecretStatus.EXHAUSTED)

    # 解密
    settings = get_settings()
    try:
        plaintext = decrypt(record.ciphertext, settings.encryption_key_bytes)
    except Exception:
        logger.error("Secret 解密失败: ref=%s", secret_ref[:12] + "****")
        raise SecretResolutionError("decryption_failed")

    logger.info(
        "Secret 解析成功: ref=%s, tool=%s, read_count=%d/%d",
        secret_ref[:12] + "****",
        ctx.tool_name,
        new_count,
        record.max_reads,
    )

    return plaintext
