"""
BlindVault Redis Store

封装所有 Redis 操作，管理 secret 的 CRUD。
- 使用 Hash 结构存储 secret 记录
- 利用 Redis TTL 实现自动过期
- 使用 HINCRBY 原子递增读取计数
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

from backend.config import get_settings
from backend.models import SecretRecord, SecretStatus

logger = logging.getLogger(__name__)


class SecretStore:
    """Redis 异步 secret 存储。"""

    def __init__(self, redis_client: aioredis.Redis, key_prefix: str = ""):
        self._redis = redis_client
        self._prefix = key_prefix or get_settings().redis_key_prefix

    def _key(self, secret_ref: str) -> str:
        """构造 Redis key。"""
        return f"{self._prefix}secret:{secret_ref}"

    def _user_index_key(self, user_id: str) -> str:
        """用户维度的全局 secret 索引 key。"""
        return f"{self._prefix}user_secrets:{user_id}"

    async def save_secret(self, record: SecretRecord) -> None:
        """
        保存 secret 记录到 Redis。

        使用 HSET 存储所有字段，并设置 EXPIREAT 自动过期。
        同时将 secret_ref 加入用户索引。
        """
        key = self._key(record.secret_ref)
        data = record.model_dump(mode="json")
        # 将复杂类型序列化为 JSON 字符串
        for field_name in ("allowed_tools", "allowed_destinations"):
            data[field_name] = json.dumps(data[field_name])
        # datetime 序列化
        data["created_at"] = record.created_at.isoformat()
        data["expires_at"] = record.expires_at.isoformat()

        pipe = self._redis.pipeline()
        pipe.hset(key, mapping=data)
        # 设置 Redis 级别的过期时间（宽松一些，多留 60 秒以便查询过期记录）
        expire_ts = int(record.expires_at.timestamp()) + 60
        pipe.expireat(key, expire_ts)
        # 用户索引
        idx_key = self._user_index_key(record.user_id)
        pipe.sadd(idx_key, record.secret_ref)
        pipe.expireat(idx_key, expire_ts)
        await pipe.execute()

        logger.info("Secret 已保存: ref=%s (label=%s)", record.secret_ref[:12] + "****", record.label)

    async def get_secret(self, secret_ref: str) -> Optional[SecretRecord]:
        """
        获取 secret 记录。返回 None 表示不存在或已被 Redis TTL 清除。
        """
        key = self._key(secret_ref)
        data = await self._redis.hgetall(key)
        if not data:
            return None
        return self._deserialize(data)

    async def increment_read_count(self, secret_ref: str) -> int:
        """
        原子递增 read_count。返回递增后的值。

        使用 HINCRBY 保证并发安全。
        """
        key = self._key(secret_ref)
        new_count = await self._redis.hincrby(key, "read_count", 1)
        return new_count

    async def revoke_secret(self, secret_ref: str) -> bool:
        """
        将 secret 标记为 revoked。返回是否成功（secret 是否存在）。
        """
        key = self._key(secret_ref)
        exists = await self._redis.exists(key)
        if not exists:
            return False
        await self._redis.hset(key, "status", SecretStatus.REVOKED.value)
        logger.info("Secret 已撤销: ref=%s", secret_ref[:12] + "****")
        return True

    async def update_status(self, secret_ref: str, status: SecretStatus) -> None:
        """更新 secret 状态。"""
        key = self._key(secret_ref)
        await self._redis.hset(key, "status", status.value)

    async def list_secrets(
        self, user_id: str
    ) -> list[SecretRecord]:
        """
        列出指定用户下的所有 secret 记录。
        """
        idx_key = self._user_index_key(user_id)
        refs = await self._redis.smembers(idx_key)
        records = []
        for ref_bytes in refs:
            ref = ref_bytes if isinstance(ref_bytes, str) else ref_bytes.decode()
            record = await self.get_secret(ref)
            if record:
                # 检查是否过期
                now = datetime.now(timezone.utc)
                if record.expires_at <= now and record.status == SecretStatus.ACTIVE:
                    await self.update_status(ref, SecretStatus.EXPIRED)
                    record.status = SecretStatus.EXPIRED
                # 检查是否耗尽
                if record.read_count >= record.max_reads and record.status == SecretStatus.ACTIVE:
                    await self.update_status(ref, SecretStatus.EXHAUSTED)
                    record.status = SecretStatus.EXHAUSTED
                records.append(record)
        return records

    @staticmethod
    def _deserialize(data: dict) -> SecretRecord:
        """将 Redis hash 数据反序列化为 SecretRecord。"""
        # Redis 返回的是 bytes 或 str，统一处理
        cleaned = {}
        for k, v in data.items():
            key = k if isinstance(k, str) else k.decode()
            val = v if isinstance(v, str) else v.decode()
            cleaned[key] = val

        # 反序列化列表字段
        for field_name in ("allowed_tools", "allowed_destinations"):
            if field_name in cleaned and isinstance(cleaned[field_name], str):
                cleaned[field_name] = json.loads(cleaned[field_name])

        # 反序列化整数字段
        for field_name in ("read_count", "max_reads"):
            if field_name in cleaned:
                cleaned[field_name] = int(cleaned[field_name])

        return SecretRecord(**cleaned)


# ---- 全局 store 实例管理 ----

_store_instance: Optional[SecretStore] = None
_redis_client: Optional[aioredis.Redis] = None


async def get_redis_client() -> aioredis.Redis:
    """获取全局 Redis 客户端。"""
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
        )
    return _redis_client


async def get_store() -> SecretStore:
    """获取全局 SecretStore 实例。"""
    global _store_instance
    if _store_instance is None:
        client = await get_redis_client()
        _store_instance = SecretStore(client)
    return _store_instance


async def close_redis() -> None:
    """关闭 Redis 连接。"""
    global _redis_client, _store_instance
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        _store_instance = None
