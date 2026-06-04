"""
BlindVault Secret Store API

提供 secret 的创建、查询和撤销接口。

安全规则：
- POST /api/secrets 返回中不包含真实 value
- GET /api/secrets 不返回真实 value 或 ciphertext
- user_id/session_id/tenant_id 从请求 Header 中获取（MVP）
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Header, HTTPException

from backend.config import get_settings
from backend.crypto import encrypt
from backend.db import save_secret_archive, list_secret_archives, update_secret_archive_status
from backend.models import (
    CreateSecretRequest,
    SecretMetadataResponse,
    SecretRecord,
    SecretResponse,
    SecretStatus,
)
from backend.redis_store import get_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/secrets", tags=["secrets"])


def _generate_secret_ref() -> str:
    """生成高熵 secret_ref。格式：sec_live_{32字符URL-safe随机串}"""
    return f"sec_live_{secrets.token_urlsafe(24)}"


@router.post("", response_model=SecretResponse, status_code=201)
async def create_secret(
    req: CreateSecretRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_session_id: str = Header(..., alias="X-Session-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    创建一个新的 secret。

    - 加密 value 后存入 Redis
    - 返回 secret_ref 和 placeholder，不返回真实 value
    """
    settings = get_settings()
    store = await get_store()

    # 生成 secret_ref
    secret_ref = _generate_secret_ref()

    # 加密真实 value
    ciphertext = encrypt(
        req.value.get_secret_value(),
        settings.encryption_key_bytes,
    )

    # 构造记录
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=req.ttl_seconds)

    record = SecretRecord(
        secret_ref=secret_ref,
        user_id=x_user_id,
        session_id=x_session_id,
        tenant_id=x_tenant_id,
        label=req.label,
        secret_type=req.secret_type,
        ciphertext=ciphertext,
        allowed_tools=req.allowed_tools,
        allowed_destinations=req.allowed_destinations,
        created_at=now,
        expires_at=expires_at,
        read_count=0,
        max_reads=req.max_reads,
        status=SecretStatus.ACTIVE,
    )

    await store.save_secret(record)

    # 同步归档到 PostgreSQL（仅元数据，不含密文）
    try:
        await save_secret_archive(
            secret_ref=secret_ref,
            user_id=x_user_id,
            session_id=x_session_id,
            tenant_id=x_tenant_id,
            label=req.label,
            secret_type=req.secret_type.value,
            allowed_tools=json.dumps(req.allowed_tools),
            allowed_destinations=json.dumps(req.allowed_destinations),
            max_reads=req.max_reads,
            created_at=now.isoformat(),
            expires_at=expires_at.isoformat(),
            status=SecretStatus.ACTIVE.value,
        )
    except Exception as e:
        logger.warning("凭证归档写入 PG 失败（不影响核心流程）: %s", str(e))

    return SecretResponse(
        secret_ref=secret_ref,
        placeholder=f"{{{{secret:{secret_ref}}}}}",
        label=req.label,
        secret_type=req.secret_type,
        allowed_tools=req.allowed_tools,
        allowed_destinations=req.allowed_destinations,
        expires_at=expires_at,
        reads_left=req.max_reads,
        status=SecretStatus.ACTIVE,
    )


@router.get("", response_model=list[SecretMetadataResponse])
async def list_secrets(
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_session_id: str = Header(None, alias="X-Session-Id"),
):
    """
    列出当前用户和会话下的所有 secret 元数据。

    不返回真实 value 或 ciphertext。
    """
    store = await get_store()
    records = await store.list_secrets(x_user_id)

    # 构建 Redis 活跃凭证的响应列表
    redis_refs = set()
    result = []
    for r in records:
        redis_refs.add(r.secret_ref)
        result.append(
            SecretMetadataResponse(
                secret_ref=r.secret_ref,
                label=r.label,
                secret_type=r.secret_type,
                allowed_tools=r.allowed_tools,
                allowed_destinations=r.allowed_destinations,
                expires_at=r.expires_at,
                reads_left=max(0, r.max_reads - r.read_count),
                status=r.status,
            )
        )

    # 从 PG 归档表补充 Redis 中已不存在的历史凭证
    try:
        archives = await list_secret_archives(x_user_id)
        now = datetime.now(timezone.utc)
        for arch in archives:
            if arch["secret_ref"] in redis_refs:
                continue  # Redis 中已有，跳过
            # 确定状态：如果 PG 中仍是 active 但已过期，标记为 expired
            status_val = arch["status"]
            if status_val == "active" and arch["expires_at"] <= now:
                status_val = "expired"
                # 同步更新 PG 状态
                try:
                    await update_secret_archive_status(arch["secret_ref"], "expired")
                except Exception:
                    pass
            # 解析 JSON 字段
            allowed_tools = json.loads(arch["allowed_tools"]) if isinstance(arch["allowed_tools"], str) else arch["allowed_tools"]
            allowed_dests = json.loads(arch["allowed_destinations"]) if isinstance(arch["allowed_destinations"], str) else arch["allowed_destinations"]
            result.append(
                SecretMetadataResponse(
                    secret_ref=arch["secret_ref"],
                    label=arch["label"],
                    secret_type=arch["secret_type"],
                    allowed_tools=allowed_tools,
                    allowed_destinations=allowed_dests,
                    expires_at=arch["expires_at"],
                    reads_left=0,  # 已不在 Redis，无法解密，剩余0
                    status=status_val,
                )
            )
    except Exception as e:
        logger.warning("从 PG 加载归档凭证失败: %s", str(e))

    return result


@router.post("/{secret_ref}/revoke", status_code=200)
async def revoke_secret(
    secret_ref: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_session_id: str = Header(None, alias="X-Session-Id"),
):
    """
    撤销一个 secret（标记为 revoked）。

    撤销后该 secret 不能再被 resolve。
    """
    store = await get_store()

    # 检查 secret 是否存在且属于当前用户
    record = await store.get_secret(secret_ref)
    if record is None:
        raise HTTPException(status_code=404, detail="Secret not found")
    if record.user_id != x_user_id:
        # 不暴露 secret 存在但不属于当前用户的信息
        raise HTTPException(status_code=404, detail="Secret not found")

    success = await store.revoke_secret(secret_ref)
    if not success:
        raise HTTPException(status_code=404, detail="Secret not found")

    # 同步更新 PG 归档状态
    try:
        await update_secret_archive_status(secret_ref, "revoked")
    except Exception as e:
        logger.warning("撤销同步 PG 归档失败: %s", str(e))

    return {"status": "revoked", "secret_ref": secret_ref}
