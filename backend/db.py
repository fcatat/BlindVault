"""
BlindVault PostgreSQL 持久化层

使用 asyncpg 管理配置持久化。
- blindvault_config 表：存储 LLM 网关配置
- API Key 使用 AES-GCM 加密存储
"""

from __future__ import annotations

import logging
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


async def init_db(database_url: str) -> None:
    """初始化数据库连接池并建表。"""
    global _pool
    _pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
    async with _pool.acquire() as conn:
        await conn.execute(CREATE_CONFIG_TABLE)
    logger.info("PostgreSQL 连接成功，blindvault_config 表已就绪")


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
) -> None:
    """
    保存 LLM 配置到 PostgreSQL。

    API Key 加密存储。
    """
    await save_config("llm_provider", provider)
    await save_config("llm_model", model)
    await save_config("llm_base_url", base_url)
    if api_key:
        # 加密后存储
        encrypted = encrypt(api_key, encryption_key)
        await save_config("llm_api_key_encrypted", encrypted)
    logger.info("LLM 配置已持久化到 PostgreSQL")


async def load_llm_config(encryption_key: bytes) -> dict[str, str]:
    """
    从 PostgreSQL 加载 LLM 配置。

    Returns:
        {"llm_provider": ..., "llm_model": ..., "llm_base_url": ..., "llm_api_key": ...}
        缺失的字段不包含在字典中。
    """
    all_cfg = await load_all_config()
    result: dict[str, str] = {}

    for key in ("llm_provider", "llm_model", "llm_base_url"):
        if key in all_cfg:
            result[key] = all_cfg[key]

    # 解密 API Key
    encrypted_key = all_cfg.get("llm_api_key_encrypted")
    if encrypted_key:
        try:
            result["llm_api_key"] = decrypt(encrypted_key, encryption_key)
        except Exception:
            logger.warning("无法解密持久化的 API Key，可能加密密钥已变更")

    return result
