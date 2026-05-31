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


_PATTERNS = [
    # 中文密码模式
    (
        r'(?:密码|口令|秘密|pass|pwd)(?:\s*[:：=是为]\s*|\s+)'
        r'([^\s,，。；;、\n\r]+)',
        'password',
        '密码',
    ),
    # 英文 password 模式
    (
        r'(?:password|passwd|pwd)(?:\s*[:=]\s*|\s+)'
        r'([^\s,，。；;、\n\r]+)',
        'password',
        'password',
    ),
    # token 模式
    (
        r'(?:token|令牌|access_token|bearer)(?:\s*[:：=是为]\s*|\s+)'
        r'([^\s,，。；;、\n\r]+)',
        'token',
        'token',
    ),
    # API Key 模式
    (
        r'(?:api[_\-\s]?key|apikey|秘钥)(?:\s*[:：=是为]\s*|\s+)'
        r'([^\s,，。；;、\n\r]+)',
        'api_key',
        'api_key',
    ),
]

# 连接串密码检测（单独处理，不走通用模式）
# 匹配 postgresql://user:PASSWORD@host, mysql://user:PASSWORD@host, redis://:PASSWORD@host 等
_CONNSTR_PATTERN = re.compile(
    r'((?:postgresql|postgres|mysql|redis|mongodb|amqp|mqtt)://'
    r'[^:@\s]*:)'           # scheme://user:
    r'([^@\s]+)'            # PASSWORD
    r'(@[^\s,，。；;、]+)',   # @host/db...
)

_COMPILED_PATTERNS = [
    (re.compile(pattern, re.IGNORECASE), secret_type, label)
    for pattern, secret_type, label in _PATTERNS
]


def _generate_secret_ref() -> str:
    """生成高熵 secret_ref。"""
    return f"sec_live_{secrets_mod.token_urlsafe(24)}"


def _detect_secrets(message: str) -> list[SensitiveMatch]:
    """从消息中检测敏感信息，返回按位置从后向前排序的列表。"""
    matches: list[SensitiveMatch] = []
    seen_values: set[str] = set()

    for compiled, secret_type, label_prefix in _COMPILED_PATTERNS:
        for m in compiled.finditer(message):
            value = m.group(1).strip()
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
                value_start=m.start(1),
                value_end=m.end(1),
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

    matches = _detect_secrets(message)
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
