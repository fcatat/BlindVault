"""
BlindVault 消息预处理器 (Sanitizer)

在用户消息发送给 LLM 之前：
1. 检测消息中的敏感信息（密码、token、API key 等）
2. 自动创建 secret 并存入 Vault
3. 将原文中的敏感值替换为 {{secret:sec_xxx}} 引用

用户体验：自然输入 → 系统透明保护 → LLM 只看到引用
"""

from __future__ import annotations

import logging
import re
import secrets as secrets_mod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from backend.config import get_settings
from backend.crypto import encrypt
from backend.models import SecretRecord, SecretStatus
from backend.redis_store import SecretStore

logger = logging.getLogger(__name__)


# ============================================================
# 敏感字段匹配规则
# ============================================================

@dataclass
class SensitiveMatch:
    """一次敏感信息匹配结果。"""
    secret_type: str
    label: str
    value: str
    start: int
    end: int
    full_match: str
    value_start: int
    value_end: int


# 默认的内置敏感字段匹配规则
DEFAULT_PATTERNS = [
    {
        "pattern": r'(?:密码|口令|秘密|pass|pwd)(?:\s*[:：=是为]\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "密码",
    },
    {
        "pattern": r'(?:password|passwd|pwd)(?:\s*[:=]\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "password",
    },
    {
        "pattern": r'(?:token|令牌|access_token|bearer)(?:\s*[:：=是为]\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "token",
        "label": "token",
    },
    {
        "pattern": r'(?:api[_\-\s]?key|apikey|秘钥)(?:\s*[:：=是为]\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "api_key",
        "label": "api_key",
    },
]

# 连接串密码检测（单独处理，不走通用模式）
_CONNSTR_PATTERN = re.compile(
    r'((?:postgresql|postgres|mysql|redis|mongodb|amqp|mqtt)://'
    r'[^:@\s]*:)'           # scheme://user:
    r'([^@\s]+)'            # PASSWORD
    r'(@[^\s,，。；;、]+)',   # @host/db...
)

# 动态编译的正则全局内存缓存
_cached_patterns: list[tuple[re.Pattern, str, str]] = []
_initialized = False


def _compile_default_patterns() -> list[tuple[re.Pattern, str, str]]:
    compiled = []
    for item in DEFAULT_PATTERNS:
        try:
            compiled.append((re.compile(item["pattern"], re.IGNORECASE), item["secret_type"], item["label"]))
        except Exception as e:
            logger.error("编译默认正则失败: %s, error=%s", item["pattern"], str(e))
    return compiled


async def get_compiled_patterns() -> list[tuple[re.Pattern, str, str]]:
    """获取编译好的正则列表，优先从 PostgreSQL 数据库加载。"""
    global _cached_patterns, _initialized
    if _initialized:
        return _cached_patterns

    try:
        from backend.db import load_config
        # 尝试从数据库加载
        data_str = await load_config("sanitizer_patterns")
        if data_str:
            import json
            patterns = json.loads(data_str)
            compiled = []
            for item in patterns:
                compiled.append((re.compile(item["pattern"], re.IGNORECASE), item["secret_type"], item["label"]))
            _cached_patterns = compiled
            _initialized = True
            return _cached_patterns
    except Exception as e:
        logger.warning("无法从数据库加载正则规则，将使用内置默认规则: %s", str(e))

    # 降级使用默认规则
    return _compile_default_patterns()


async def update_patterns_cache(patterns: list[dict]) -> None:
    """当 API 更新正则时，手动更新缓存。"""
    global _cached_patterns, _initialized
    compiled = []
    for item in patterns:
        compiled.append((re.compile(item["pattern"], re.IGNORECASE), item["secret_type"], item["label"]))
    _cached_patterns = compiled
    _initialized = True


def _generate_secret_ref() -> str:
    """生成高熵 secret_ref。"""
    return f"sec_live_{secrets_mod.token_urlsafe(24)}"


async def detect_secrets(message: str) -> list[SensitiveMatch]:
    """从消息中检测敏感信息，返回按位置从后向前排序的列表。"""
    matches: list[SensitiveMatch] = []
    seen_values: set[str] = set()

    compiled_patterns = await get_compiled_patterns()

    for compiled, secret_type, label_prefix in compiled_patterns:
        for m in compiled.finditer(message):
            try:
                # 尝试抓取捕获组 1 (敏感值值体)
                value = m.group(1).strip()
                val_start = m.start(1)
                val_end = m.end(1)
            except IndexError:
                # 若无捕获组，则抓取整段匹配
                value = m.group(0).strip()
                val_start = m.start(0)
                val_end = m.end(0)

            if len(value) < 3:
                continue
            skip_words = ('是什么', '是多少', '是啥', '多少', '什么', '忘了', '忘记了', 'what', 'is', 'the', 'my')
            if value.lower() in skip_words:
                continue
            if value in seen_values:
                continue
            seen_values.add(value)

            matches.append(SensitiveMatch(
                secret_type=secret_type,
                label=f"auto_{label_prefix}",
                value=value,
                start=m.start(),
                end=m.end(),
                full_match=m.group(0),
                value_start=val_start,
                value_end=val_end,
            ))

    # 连接串密码检测（postgresql://user:PASSWORD@host）
    for m in _CONNSTR_PATTERN.finditer(message):
        password = m.group(2)
        if len(password) < 2 or password in seen_values:
            continue
        seen_values.add(password)
        matches.append(SensitiveMatch(
            secret_type="password",
            label="auto_connstr_password",
            value=password,
            start=m.start(),
            end=m.end(),
            full_match=m.group(0),
            value_start=m.start(2),
            value_end=m.end(2),
        ))

    # 从后向前排序，替换时不影响前面的偏移
    matches.sort(key=lambda x: x.value_start, reverse=True)
    return matches


async def sanitize_message(
    message: str,
    store: SecretStore,
    user_id: str,
    session_id: str,
    tenant_id: str = "default",
    allowed_tools: Optional[list[str]] = None,
    ttl_seconds: int = 600,
    max_reads: int = 3,
) -> tuple[str, list[str]]:
    """
    预处理用户消息：自动检测敏感信息并替换为 secret_ref。

    Returns:
        (sanitized_message, created_secret_refs)
    """
    if allowed_tools is None:
        allowed_tools = ["secure_shell"]

    if "{{secret:" in message:
        return message, []

    matches = await detect_secrets(message)
    if not matches:
        return message, []

    settings = get_settings()
    sanitized = message
    created_refs: list[str] = []

    url_match = re.search(r'https?://[^\s,，。；;、\n\r]+', message)
    allowed_destinations = [url_match.group(0)] if url_match else []

    now = datetime.now(timezone.utc)

    for match in matches:
        secret_ref = _generate_secret_ref()
        ciphertext = encrypt(match.value, settings.encryption_key_bytes)

        record = SecretRecord(
            secret_ref=secret_ref,
            user_id=user_id,
            session_id=session_id,
            tenant_id=tenant_id,
            label=match.label,
            secret_type=match.secret_type,
            ciphertext=ciphertext,
            allowed_tools=allowed_tools,
            allowed_destinations=allowed_destinations,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
            read_count=0,
            max_reads=max_reads,
            status=SecretStatus.ACTIVE,
        )
        await store.save_secret(record)

        placeholder = f"{{{{secret:{secret_ref}}}}}"
        created_refs.append(secret_ref)

        sanitized = (
            sanitized[:match.value_start]
            + placeholder
            + sanitized[match.value_end:]
        )

        logger.info(
            "消息预处理: 检测到 %s，已自动创建 secret %s 并替换",
            match.secret_type,
            secret_ref[:12] + "****",
        )

    return sanitized, created_refs
