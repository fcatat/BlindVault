import json
import logging
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
import redis.asyncio as aioredis
from uuid import uuid4

logger = logging.getLogger(__name__)

class SanitizeRule(BaseModel):
    id: str
    name: str
    pattern: str
    secret_type: str
    label: str
    capture_group: int
    enabled: bool = True
    is_builtin: bool = False
    created_at: datetime
    updated_at: datetime

class RulesStore:
    def __init__(self, redis_client: aioredis.Redis, key_prefix: str = ""):
        self._redis = redis_client
        self._prefix = key_prefix

    def _key(self, rule_id: str) -> str:
        return f"{self._prefix}sanitize_rule:{rule_id}"

    def _index_key(self) -> str:
        return f"{self._prefix}sanitize_rules_index"
        
    def _seeded_key(self) -> str:
        return f"{self._prefix}sanitize_rules_seeded"

    async def save_rule(self, rule: SanitizeRule) -> None:
        key = self._key(rule.id)
        data = rule.model_dump(mode="json")
        data["created_at"] = rule.created_at.isoformat()
        data["updated_at"] = rule.updated_at.isoformat()
        # Convert bools to int/str for redis
        data["enabled"] = 1 if rule.enabled else 0
        data["is_builtin"] = 1 if rule.is_builtin else 0
        
        pipe = self._redis.pipeline()
        pipe.hset(key, mapping=data)
        pipe.sadd(self._index_key(), rule.id)
        await pipe.execute()

    async def get_rule(self, rule_id: str) -> Optional[SanitizeRule]:
        key = self._key(rule_id)
        data = await self._redis.hgetall(key)
        if not data:
            return None
        return self._deserialize(data)

    async def list_rules(self) -> list[SanitizeRule]:
        idx_key = self._index_key()
        refs = await self._redis.smembers(idx_key)
        rules = []
        for ref_bytes in refs:
            ref = ref_bytes if isinstance(ref_bytes, str) else ref_bytes.decode()
            rule = await self.get_rule(ref)
            if rule:
                rules.append(rule)
        return rules

    async def delete_rule(self, rule_id: str) -> bool:
        key = self._key(rule_id)
        idx_key = self._index_key()
        exists = await self._redis.exists(key)
        if not exists:
            return False
        pipe = self._redis.pipeline()
        pipe.delete(key)
        pipe.srem(idx_key, rule_id)
        await pipe.execute()
        return True

    @staticmethod
    def _deserialize(data: dict) -> SanitizeRule:
        cleaned = {}
        for k, v in data.items():
            key = k if isinstance(k, str) else k.decode()
            val = v if isinstance(v, str) else v.decode()
            cleaned[key] = val
        
        cleaned["capture_group"] = int(cleaned.get("capture_group", 0))
        cleaned["enabled"] = str(cleaned.get("enabled")) == "1"
        cleaned["is_builtin"] = str(cleaned.get("is_builtin")) == "1"
        return SanitizeRule(**cleaned)

    async def seed_builtin_rules_if_needed(self, builtin_rules: list[dict]) -> None:
        """首次启动时种子化默认规则（SETNX 语义）"""
        seeded_key = self._seeded_key()
        # SETNX 语义：仅当 seeded_key 不存在时写入，否则说明之前初始化过（即使用户删了某些规则也不恢复）
        is_first_time = await self._redis.setnx(seeded_key, "1")
        if not is_first_time:
            return
            
        logger.info("初始化内置脱敏规则...")
        now = datetime.now(timezone.utc)
        for rule_data in builtin_rules:
            rule = SanitizeRule(
                id=str(uuid4()),
                created_at=now,
                updated_at=now,
                **rule_data
            )
            await self.save_rule(rule)
            

_rules_store_instance: Optional[RulesStore] = None

async def get_rules_store() -> RulesStore:
    global _rules_store_instance
    if _rules_store_instance is None:
        from blindvault_agent.security.redis_store import get_redis_client
        from blindvault_agent.security.config import get_settings
        client = await get_redis_client()
        _rules_store_instance = RulesStore(client, key_prefix=get_settings().redis_key_prefix)
    return _rules_store_instance
