"""
BlindVault PostgreSQL 持久化层

使用 asyncpg 管理配置持久化。
- blindvault_config 表：存储 LLM 网关配置
- API Key 使用 AES-GCM 加密存储
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

import asyncpg

from backend.crypto import decrypt, encrypt

logger = logging.getLogger(__name__)

# 全局连接池
_pool: Optional[asyncpg.Pool] = None

# ============================================================
# 初始化
# ============================================================

CREATE_CONFIG_TABLE = """
CREATE TABLE IF NOT EXISTS blindvault_config (
    key   VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL
);
"""

CREATE_SECRET_ARCHIVE_TABLE = """
CREATE TABLE IF NOT EXISTS secret_archive (
    secret_ref          VARCHAR(128) PRIMARY KEY,
    user_id             VARCHAR(128) NOT NULL,
    session_id          VARCHAR(128) NOT NULL,
    tenant_id           VARCHAR(128) NOT NULL DEFAULT 'default',
    label               VARCHAR(256) NOT NULL,
    secret_type         VARCHAR(64)  NOT NULL DEFAULT 'password',
    allowed_tools       TEXT         NOT NULL DEFAULT '[]',
    allowed_destinations TEXT        NOT NULL DEFAULT '[]',
    max_reads           INTEGER      NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ  NOT NULL,
    status              VARCHAR(32)  NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_secret_archive_user ON secret_archive(user_id);
"""


async def init_db(database_url: str) -> None:
    """初始化数据库连接池并建表。"""
    global _pool
    _pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
    async with _pool.acquire() as conn:
        await conn.execute(CREATE_CONFIG_TABLE)
        await conn.execute(CREATE_SECRET_ARCHIVE_TABLE)
    logger.info("PostgreSQL 连接成功，blindvault_config / secret_archive 表已就绪")


async def close_db() -> None:
    """关闭连接池。"""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def _get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db()")
    return _pool


# ============================================================
# Config CRUD
# ============================================================


async def save_config(key: str, value: str) -> None:
    """保存配置项（upsert）。"""
    pool = _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO blindvault_config (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2
            """,
            key, value,
        )


async def load_config(key: str) -> Optional[str]:
    """读取配置项。"""
    pool = _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT value FROM blindvault_config WHERE key = $1",
            key,
        )
        return row["value"] if row else None


async def load_all_config() -> dict[str, str]:
    """读取所有配置项。"""
    pool = _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, value FROM blindvault_config")
        return {row["key"]: row["value"] for row in rows}


# ============================================================
# LLM 配置持久化（高层接口）
# ============================================================

async def save_llm_config(
    provider: str,
    model: str,
    base_url: str,
    api_key: str,
    encryption_key: bytes,
    safety_policy_mode: str,
    local_model_url: str = "",
    local_model_name: str = "qwen3:0.6b",
    local_model_timeout: float = 2.0,
    local_model_api_type: str = "ollama",
    local_model_prompt: str = "",
    local_model_disable_cot: bool = True,
    agent_max_retries: int = 5,
    agent_high_risk_commands: str = "",
    agent_approval_required: bool = True,
) -> None:
    """
    保存 LLM 配置到 PostgreSQL。

    API Key 加密存储。
    """
    await save_config("llm_provider", provider)
    await save_config("llm_model", model)
    await save_config("llm_base_url", base_url)
    await save_config("safety_policy_mode", safety_policy_mode)
    await save_config("local_model_url", local_model_url)
    await save_config("local_model_name", local_model_name)
    await save_config("local_model_timeout", str(local_model_timeout))
    await save_config("local_model_api_type", local_model_api_type)
    await save_config("local_model_prompt", local_model_prompt)
    await save_config("local_model_disable_cot", "true" if local_model_disable_cot else "false")
    await save_config("agent_max_retries", str(agent_max_retries))
    await save_config("agent_high_risk_commands", agent_high_risk_commands)
    await save_config("agent_approval_required", "true" if agent_approval_required else "false")

    if api_key:
        # 加密后存储
        encrypted = encrypt(api_key, encryption_key)
        await save_config("llm_api_key_encrypted", encrypted)
    logger.info("LLM 配置已持久化到 PostgreSQL")


async def load_llm_config(encryption_key: bytes) -> dict[str, any]:
    """
    从 PostgreSQL 加载 LLM 配置。

    Returns:
        {"llm_provider": ..., "llm_model": ..., "llm_base_url": ..., "llm_api_key": ..., "safety_policy_mode": ...}
        缺失的字段不包含在字典中。
    """
    all_cfg = await load_all_config()
    result: dict[str, any] = {}

    for key in (
        "llm_provider", "llm_model", "llm_base_url", "safety_policy_mode",
        "local_model_url", "local_model_name", "local_model_api_type", "local_model_prompt",
        "agent_high_risk_commands"
    ):
        if key in all_cfg:
            result[key] = all_cfg[key]

    if "local_model_timeout" in all_cfg:
        try:
            result["local_model_timeout"] = float(all_cfg["local_model_timeout"])
        except ValueError:
            result["local_model_timeout"] = 2.0

    if "local_model_disable_cot" in all_cfg:
        result["local_model_disable_cot"] = all_cfg["local_model_disable_cot"].lower() == "true"

    if "agent_max_retries" in all_cfg:
        try:
            result["agent_max_retries"] = int(all_cfg["agent_max_retries"])
        except ValueError:
            result["agent_max_retries"] = 5

    if "agent_approval_required" in all_cfg:
        result["agent_approval_required"] = all_cfg["agent_approval_required"].lower() == "true"

    # 解密 API Key
    encrypted_key = all_cfg.get("llm_api_key_encrypted")
    if encrypted_key:
        try:
            result["llm_api_key"] = decrypt(encrypted_key, encryption_key)
        except Exception:
            logger.warning("无法解密持久化的 API Key，可能加密密钥已变更")

    return result



# ============================================================
# 凭证归档持久化
# ============================================================


async def save_secret_archive(
    secret_ref: str,
    user_id: str,
    session_id: str,
    tenant_id: str,
    label: str,
    secret_type: str,
    allowed_tools: str,
    allowed_destinations: str,
    max_reads: int,
    created_at: datetime,
    expires_at: datetime,
    status: str = "active",
) -> None:
    """将凭证元数据归档到 PostgreSQL（不含密文）。"""
    pool = _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO secret_archive
                (secret_ref, user_id, session_id, tenant_id, label, secret_type,
                 allowed_tools, allowed_destinations, max_reads, created_at, expires_at, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (secret_ref) DO UPDATE SET status = $12
            """,
            secret_ref, user_id, session_id, tenant_id, label, secret_type,
            allowed_tools, allowed_destinations, max_reads,
            created_at, expires_at, status,
        )


async def update_secret_archive_status(secret_ref: str, status: str) -> None:
    """更新归档凭证的状态（如 revoked）。"""
    pool = _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE secret_archive SET status = $1 WHERE secret_ref = $2",
            status, secret_ref,
        )


async def list_secret_archives(user_id: str) -> list[dict]:
    """
    查询指定用户的所有归档凭证元数据。

    返回字典列表，字段与 SecretMetadataResponse 对齐。
    """
    pool = _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT secret_ref, label, secret_type, allowed_tools, allowed_destinations,
                   max_reads, created_at, expires_at, status
            FROM secret_archive
            WHERE user_id = $1
            ORDER BY created_at DESC
            """,
            user_id,
        )
        return [dict(row) for row in rows]
