import json
import logging
from typing import Optional, Any

import asyncpg

from blindvault_agent.security import pg_archive

logger = logging.getLogger(__name__)

CREATE_AUDIT_LOG_TABLE = """
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(128) NOT NULL DEFAULT 'system',
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64),
    target_id VARCHAR(256),
    details JSONB,
    ip VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_ts ON audit_log (actor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_ts ON audit_log (action, ts DESC);
"""

async def init_audit_db() -> None:
    """初始化 Audit DB 建表 (复用 pg_archive 的 _pool)"""
    pool = pg_archive._pool
    if not pool:
        logger.info("PG pool 未就绪，跳过 audit_log 建表。")
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(CREATE_AUDIT_LOG_TABLE)
        logger.info("PostgreSQL audit DB 初始化成功。")
    except Exception as e:
        logger.error(f"PG audit_log 建表失败: {e}")

async def log_event(
    actor: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    ip: Optional[str] = None
) -> None:
    """写入审计日志。失败仅记录 error，不阻断主流程。"""
    pool = pg_archive._pool
    if not pool:
        return
    try:
        details_json = json.dumps(details) if details else None
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO audit_log (actor, action, target_type, target_id, details, ip)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                actor, action, target_type, target_id, details_json, ip
            )
    except Exception as e:
        logger.error(f"写入审计日志失败 [非阻断]: {e}")

async def list_events(
    filters: dict[str, Any],
    limit: int = 100,
    offset: int = 0
) -> tuple[list[dict[str, Any]], int]:
    """查询审计日志，支持过滤分页"""
    pool = pg_archive._pool
    if not pool:
        return [], 0
    try:
        query_conditions = []
        params = []
        
        if "actor" in filters and filters["actor"]:
            params.append(filters["actor"])
            query_conditions.append(f"actor = ${len(params)}")
            
        if "action" in filters and filters["action"]:
            params.append(filters["action"])
            query_conditions.append(f"action = ${len(params)}")
            
        if "target_type" in filters and filters["target_type"]:
            params.append(filters["target_type"])
            query_conditions.append(f"target_type = ${len(params)}")
            
        if "ts_from" in filters and filters["ts_from"]:
            params.append(filters["ts_from"])
            query_conditions.append(f"ts >= ${len(params)}")
            
        if "ts_to" in filters and filters["ts_to"]:
            params.append(filters["ts_to"])
            query_conditions.append(f"ts <= ${len(params)}")
            
        where_clause = ""
        if query_conditions:
            where_clause = "WHERE " + " AND ".join(query_conditions)
            
        count_query = f"SELECT COUNT(*) FROM audit_log {where_clause}"
        
        # limit & offset are appended at the end
        params_with_pagination = params.copy()
        params_with_pagination.append(limit)
        limit_idx = len(params_with_pagination)
        params_with_pagination.append(offset)
        offset_idx = len(params_with_pagination)
        
        select_query = f"""
            SELECT id, ts, actor, action, target_type, target_id, details, ip 
            FROM audit_log 
            {where_clause} 
            ORDER BY ts DESC 
            LIMIT ${limit_idx} OFFSET ${offset_idx}
        """
        
        async with pool.acquire() as conn:
            total_count = await conn.fetchval(count_query, *params)
            rows = await conn.fetch(select_query, *params_with_pagination)
            
            items = []
            for row in rows:
                row_dict = dict(row)
                if row_dict.get("details"):
                    try:
                        row_dict["details"] = json.loads(row_dict["details"])
                    except Exception:
                        pass
                # ensure ts is properly serialized in JSON (e.g., ISO format)
                if row_dict.get("ts"):
                    row_dict["ts"] = row_dict["ts"].isoformat()
                items.append(row_dict)
                
            return items, total_count
            
    except Exception as e:
        logger.error(f"查询审计日志失败: {e}")
        return [], 0
