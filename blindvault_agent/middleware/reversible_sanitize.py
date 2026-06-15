"""
BlindVault 可逆脱敏 Middleware（拦截点 A 主层）

🔴 安全关键代码 —— 必须人工/强模型 review

功能：
- before_model：扫描发往模型的所有消息，检测凭证（正则 + 连接串），
  命中后 AES 加密存入金库，原文替换为 {{secret:sec_xxx}}
- after_model 不需要额外处理（工具输出在下一轮 before_model 时被扫描）

安全铁律：
- 占位符→明文映射只存金库，**绝不进 agent state / context**
- 确定性正则在前（便宜的先拦）
- 如果无法连接金库，**不放行**——抛异常中断，防止密码裸奔进模型
"""

from __future__ import annotations

import logging
import re
import secrets as secrets_mod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Callable

from langchain.agents.middleware import AgentMiddleware, AgentState

from blindvault_agent.security.crypto import encrypt
from blindvault_agent.security.models import SecretRecord, SecretStatus, SecretType
from blindvault_agent.security.redis_store import SecretStore

logger = logging.getLogger(__name__)


# ============================================================
# 敏感信息匹配结果
# ============================================================


@dataclass
class SensitiveMatch:
    """一次敏感信息匹配结果。"""
    secret_type: str
    label: str
    value: str         # 敏感明文
    value_start: int   # value 在原文中的起始位置
    value_end: int     # value 在原文中的结束位置


# ============================================================
# 数据结构
# ============================================================

@dataclass
class CompiledRule:
    name: str
    secret_type: str
    label: str
    capture_group: int
    enabled: bool
    compiled_pattern: re.Pattern


# ============================================================
# 内置正则规则（数据源）
# ============================================================

_BUILTIN_RULES_DATA = [
    {
        "name": "中文上下文密码",
        "pattern": r'(?:密码|口令|秘密|pass|pwd)(?:\s*[:：=是为]\s*|\s+是\s+|\s+为\s+|(?:设置|改|设|修改|更改|改成|设成)(?:为|成)\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "auto_cn_password",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "英文上下文密码",
        "pattern": r'(?:password|passwd|pwd)(?:\s*[:=]\s*|\s+is\s+|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "auto_en_password",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "连接串密码",
        "pattern": r'((?:postgresql|postgres|mysql|redis|mongodb|amqp|mqtt)://[^:@\s]*:)([^@\s]+)(@[^\s,，。；;、]+)',
        "secret_type": "password",
        "label": "auto_connstr_password",
        "capture_group": 2,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "API Key",
        "pattern": r'(?:api[_-]?key|token|secret[_-]?key|access[_-]?key)(?:\s*[:=]\s*|\s+is\s+|\s+)([A-Za-z0-9_\-\.]{20,})',
        "secret_type": "api_key",
        "label": "auto_api_key",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    }
]


# 应跳过的常见问询词
_SKIP_WORDS = frozenset({
    '是什么', '是多少', '是啥', '多少', '什么', '忘了', '忘记了',
    'what', 'is', 'the', 'my',
})


# ============================================================
# 检测引擎
# ============================================================


# ============================================================
# 脱敏检测与替换核心逻辑
# ============================================================


def detect_secrets_in_text(text: str, compiled_rules: list[CompiledRule]) -> list[SensitiveMatch]:
    """
    从文本中检测敏感信息。纯确定性正则，无 I/O。

    返回按位置从后向前排序的匹配列表（方便从后往前替换不影响偏移）。
    """
    matches: list[SensitiveMatch] = []
    seen_values: set[str] = set()

    # ---- 正则规则匹配 ----
    for rule in compiled_rules:
        if not rule.enabled:
            continue
        pattern = rule.compiled_pattern
        group_idx = rule.capture_group
        for m in pattern.finditer(text):
            try:
                value = m.group(group_idx).strip()
                val_start = m.start(group_idx)
                val_end = m.end(group_idx)
            except IndexError:
                value = m.group(0).strip()
                val_start = m.start(0)
                val_end = m.end(0)

            # 过滤：太短、已是占位符、问询词、重复
            if len(value) < 2:
                continue
            if value.startswith("{{secret:") or value.startswith("sec_live_") or value.startswith("sec_test_"):
                continue
            if value == "[REDACTED]" or value == "$SECRET":
                continue
            if value.lower() in _SKIP_WORDS:
                continue
            if value in seen_values:
                continue
            seen_values.add(value)

            matches.append(SensitiveMatch(
                secret_type=rule.secret_type,
                label=rule.label,
                value=value,
                value_start=val_start,
                value_end=val_end,
            ))

    # 从后向前排序
    matches.sort(key=lambda x: x.value_start, reverse=True)
    return matches


def _generate_secret_ref() -> str:
    """生成高熵 secret_ref。"""
    return f"sec_live_{secrets_mod.token_urlsafe(24)}"


# ============================================================
# 可逆脱敏 Middleware
# ============================================================


class ReversibleSanitizeMiddleware(AgentMiddleware):
    """
    拦截点 A 主层：可逆脱敏 Middleware。

    before_model 时扫描所有消息内容：
    1. 正则检测凭证
    2. AES 加密存金库
    3. 原文替换为 {{secret:sec_xxx}}

    安全约束：
    - 映射关系只在金库中，不存储在 middleware 实例或 agent state
    - 金库不可达时拒绝放行（抛异常）
    - 确定性正则在前

    参数：
    - save_record: 同步回调函数，接收 SecretRecord 并持久化到金库。
      生产环境中可使用 sync Redis 或线程池包装 async store。
    """

    def __init__(
        self,
        save_record,  # Callable[[SecretRecord], None] — 同步金库写入回调
        encryption_key: bytes,
        load_rules: callable = None,
        user_id: str = "system",
        session_id: str = "",
        tenant_id: str = "default",
        allowed_tools: Optional[list[str]] = None,
        ttl_seconds: int = 900,
        max_reads: int = 999999,
    ):
        self._save_record = save_record
        self._encryption_key = encryption_key
        self._user_id = user_id
        self._session_id = session_id
        self._tenant_id = tenant_id
        self._allowed_tools = allowed_tools or ["secure_shell"]
        self._ttl_seconds = ttl_seconds
        self._max_reads = max_reads
        self._sanitize_count = 0  # 统计计数（不含敏感数据）
        
        # 加载并编译规则
        raw_rules = load_rules() if load_rules else []
        self.compiled_rules: list[CompiledRule] = []
        for r in raw_rules:
            try:
                pat = re.compile(r.pattern, re.IGNORECASE)
                self.compiled_rules.append(CompiledRule(
                    name=r.name,
                    secret_type=r.secret_type,
                    label=r.label,
                    capture_group=r.capture_group,
                    enabled=r.enabled,
                    compiled_pattern=pat
                ))
            except Exception as e:
                logger.error("规则 %s 编译失败: %s", getattr(r, "name", "unknown"), e)

    def before_model(self, state: AgentState, runtime=None):
        """
        在模型调用前扫描并脱敏所有消息内容。

        S1 修复：覆盖 str/list content + tool_calls args。
        遍历 state["messages"]，提取所有文本块做正则检测。
        命中后：加密存金库 → 在所有位置替换为占位符。
        """
        from blindvault_agent.middleware.msg_utils import (
            extract_scannable_texts,
            rebuild_content,
            rebuild_tool_calls,
        )

        messages = list(state.get("messages", []))
        modified = False
        new_messages = []

        for msg in messages:
            # 提取所有可扫描的文本块
            texts = extract_scannable_texts(msg)
            if not texts:
                new_messages.append(msg)
                continue

            # 合并扫描所有文本块
            all_matches = []
            for text in texts:
                all_matches.extend(detect_secrets_in_text(text, self.compiled_rules))

            if not all_matches:
                new_messages.append(msg)
                continue

            # 去重（同一个值只处理一次）
            seen_values = set()
            unique_matches = []
            for match in all_matches:
                if match.value not in seen_values:
                    seen_values.add(match.value)
                    unique_matches.append(match)

            # 构建替换映射 {原文: 占位符}
            replacements: dict[str, str] = {}
            for match in unique_matches:
                secret_ref = _generate_secret_ref()

                ciphertext = encrypt(match.value, self._encryption_key)
                now = datetime.now(timezone.utc)
                record = SecretRecord(
                    secret_ref=secret_ref,
                    user_id=self._user_id,
                    session_id=self._session_id,
                    tenant_id=self._tenant_id,
                    label=match.label,
                    secret_type=match.secret_type,
                    ciphertext=ciphertext,
                    allowed_tools=self._allowed_tools,
                    allowed_destinations=[],
                    created_at=now,
                    expires_at=now + timedelta(seconds=self._ttl_seconds),
                    read_count=0,
                    max_reads=self._max_reads,
                    status=SecretStatus.ACTIVE,
                )

                # 存入金库（安全铁律：金库不可达则拒绝放行，抛异常中断）
                self._save_record(record)

                placeholder = f"{{{{secret:{secret_ref}}}}}"
                replacements[match.value] = placeholder

                self._sanitize_count += 1
                logger.info(
                    "🔒 可逆脱敏: type=%s, ref=%s (共计 %d 次)",
                    match.secret_type,
                    secret_ref[:16] + "****",
                    self._sanitize_count,
                )

            # 在所有位置执行替换
            update = {}
            content = getattr(msg, 'content', None)
            if content is not None:
                new_content = rebuild_content(content, replacements)
                if new_content != content:
                    update["content"] = new_content

            tool_calls = getattr(msg, 'tool_calls', None)
            if tool_calls:
                new_tc = rebuild_tool_calls(tool_calls, replacements)
                if new_tc != tool_calls:
                    update["tool_calls"] = new_tc

            if update:
                new_msg = msg.model_copy(update=update)
                new_messages.append(new_msg)
                modified = True
            else:
                new_messages.append(msg)

        if modified:
            return {"messages": new_messages}
        return None

    @property
    def sanitize_count(self) -> int:
        """返回已脱敏的凭证总数。"""
        return self._sanitize_count


def make_sync_save_record(store: SecretStore) -> callable:
    """
    工厂函数：将异步 SecretStore.save_secret 包装为同步回调。

    采用双轨制设计以解决多事件循环连接池冲突问题：
    - 如果是真实 Redis，在独立线程和全新事件循环中，通过独立的临时 Redis 客户端执行写入，实现完美的生命周期隔离。
    - 如果是 FakeRedis (测试环境)，使用同一个 FakeRedis 客户端完成内存中写入，避免因新建连接导致测试数据隔离。
    """
    import asyncio
    import concurrent.futures

    is_fake = "Fake" in type(store._redis).__name__

    def save_record_sync(record: SecretRecord) -> None:
        def _save_in_new_loop_real():
            from redis.asyncio import Redis as AsyncRedis
            from blindvault_agent.security.redis_store import SecretStore as TempSecretStore

            conn_pool = store._redis.connection_pool
            host = conn_pool.connection_kwargs.get("host", "localhost")
            port = conn_pool.connection_kwargs.get("port", 6379)
            db = conn_pool.connection_kwargs.get("db", 0)
            redis_url = f"redis://{host}:{port}/{db}"

            async def _async_task():
                temp_client = AsyncRedis.from_url(redis_url, decode_responses=True)
                temp_store = TempSecretStore(temp_client, key_prefix=store._prefix)
                try:
                    await temp_store.save_secret(record)
                finally:
                    await temp_client.aclose()

            asyncio.run(_async_task())

        def _save_in_new_loop_fake():
            # FakeRedis 没有真实 socket，可直接运行
            asyncio.run(store.save_secret(record))

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # 在已有事件循环中，提交到线程池中执行以防死锁
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fn = _save_in_new_loop_fake if is_fake else _save_in_new_loop_real
                future = pool.submit(fn)
                future.result(timeout=10)
        else:
            if is_fake:
                _save_in_new_loop_fake()
            else:
                _save_in_new_loop_real()

    return save_record_sync

def make_sync_load_rules(redis_client, key_prefix="") -> callable:
    """
    工厂函数：包装 RulesStore.list_rules 为同步回调，并自动执行 seed。
    """
    import asyncio
    import concurrent.futures
    from blindvault_agent.security.rules_store import RulesStore
    
    is_fake = "Fake" in type(redis_client).__name__
    
    def load_rules_sync() -> list:
        def _load_in_new_loop_real():
            from redis.asyncio import Redis as AsyncRedis
            conn_pool = redis_client.connection_pool
            host = conn_pool.connection_kwargs.get("host", "localhost")
            port = conn_pool.connection_kwargs.get("port", 6379)
            db = conn_pool.connection_kwargs.get("db", 0)
            redis_url = f"redis://{host}:{port}/{db}"
            
            async def _task():
                temp_client = AsyncRedis.from_url(redis_url, decode_responses=True)
                temp_store = RulesStore(temp_client, key_prefix=key_prefix)
                try:
                    await temp_store.seed_builtin_rules_if_needed(_BUILTIN_RULES_DATA)
                    return await temp_store.list_rules()
                finally:
                    await temp_client.aclose()
            return asyncio.run(_task())
            
        def _load_in_new_loop_fake():
            temp_store = RulesStore(redis_client, key_prefix=key_prefix)
            async def _task():
                await temp_store.seed_builtin_rules_if_needed(_BUILTIN_RULES_DATA)
                return await temp_store.list_rules()
            return asyncio.run(_task())
            
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            
        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fn = _load_in_new_loop_fake if is_fake else _load_in_new_loop_real
                future = pool.submit(fn)
                return future.result(timeout=10)
        else:
            if is_fake:
                return _load_in_new_loop_fake()
            else:
                return _load_in_new_loop_real()
                
    return load_rules_sync

