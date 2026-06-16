import json
import logging
from datetime import datetime
from typing import Optional

import asyncpg

from blindvault_agent.security.models import SecretRecord

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None

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
    read_count          INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ  NOT NULL,
    status              VARCHAR(32)  NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_secret_archive_user ON secret_archive(user_id);
"""

async def init_archive_db(database_url: str) -> None:
    """初始化 asyncpg pool 并建表。"""
    if not database_url:
        logger.info("未配置 database_url，PG 归档未启用。")
        return
    global _pool
    try:
        _pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
        async with _pool.acquire() as conn:
            await conn.execute(CREATE_SECRET_ARCHIVE_TABLE)
        logger.info("PostgreSQL archive DB 初始化成功。")
    except Exception as e:
        logger.error(f"PG 归档初始化失败，将不启用归档功能: {e}")
        _pool = None

async def archive_secret(record: SecretRecord) -> None:
    """归档 secret 到 PostgreSQL（UPSERT）。"""
    if _pool is None:
        return
    try:
        allowed_tools = json.dumps(record.allowed_tools) if record.allowed_tools else "[]"
        allowed_destinations = json.dumps(record.allowed_destinations) if record.allowed_destinations else "[]"
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO secret_archive
                    (secret_ref, user_id, session_id, tenant_id, label, secret_type,
                     allowed_tools, allowed_destinations, max_reads, read_count, created_at, expires_at, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                ON CONFLICT (secret_ref) DO UPDATE SET
                    status = $13, read_count = $10
                """,
                record.secret_ref, record.user_id, record.session_id, record.tenant_id,
                record.label, record.secret_type.value, allowed_tools, allowed_destinations, 
                record.max_reads, record.read_count, record.created_at, record.expires_at, record.status.value
            )
    except Exception as e:
        logger.error(f"PG 写入失败 (archive_secret) [非阻断]: {e}")

async def update_archive_status(secret_ref: str, status: str, read_count: Optional[int] = None) -> None:
    """更新归档的 secret 状态。"""
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                "UPDATE secret_archive SET status = $1, read_count = COALESCE($3, read_count) WHERE secret_ref = $2",
                status, secret_ref, read_count
            )
    except Exception as e:
        logger.error(f"PG 写入失败 (update_archive_status) [非阻断]: {e}")

async def list_archives(user_id: str, limit: int = 200) -> list[dict]:
    """列出归档的 secret 记录。"""
    if _pool is None:
        return []
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT secret_ref, label, secret_type, allowed_tools, allowed_destinations, 
                       max_reads, read_count, created_at, expires_at, status
                FROM secret_archive
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                user_id, limit
            )
            return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"PG 读取失败 (list_archives): {e}")
        return []
