"""
BlindVault Secret Store API

提供 secret 的创建、查询和撤销接口。

安全规则：
- POST /api/secrets 返回中不包含真实 value
- GET /api/secrets 不返回真实 value 或 ciphertext
- user_id/session_id/tenant_id 从请求 Header 中获取（MVP）
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Header, HTTPException

from backend.config import get_settings
from backend.crypto import encrypt
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

    return [
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
        for r in records
    ]


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

    return {"status": "revoked", "secret_ref": secret_ref}
