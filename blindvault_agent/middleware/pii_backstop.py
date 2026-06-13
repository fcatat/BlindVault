"""
BlindVault PII 兜底 Middleware（拦截点 A 兜底层）

🔴 安全关键代码 —— 必须人工/强模型 review

角色定位：失效保险（backstop）
- 主层（#17 ReversibleSanitizeMiddleware）做可逆脱敏 + 回写金库
- 本层是第二道防线：不可逆、不回写金库、BLOCK 模式
- 如果主层漏掉了任何看起来像密码/密钥的内容，本层直接 **阻断整个请求**

安全铁律：
- 不回写金库（不可逆）
- BLOCK 而非 MASK（宁可拦错不可放过）
- middleware 顺序：确定性正则在前（主层） → PII 兜底在后
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from langchain.agents.middleware import AgentMiddleware, AgentState

logger = logging.getLogger(__name__)


class PIIBlockError(Exception):
    """PII 兜底层检测到泄露——阻断请求。

    错误信息不暴露具体匹配内容，仅标明被阻断。
    """

    def __init__(self, pattern_name: str = ""):
        self._pattern_name = pattern_name  # 内部审计用
        super().__init__(
            "Request blocked by PII backstop: potential credential detected. "
            "This is a safety measure — the primary sanitizer may have missed a secret."
        )


# ============================================================
# 兜底层检测规则（宽松匹配，宁可误报不可漏报）
# ============================================================

# 高熵字符串（可能是 API Key / Token / 密钥）
# 20+ 个字母数字混合字符，排除常见的非密钥文本
_PATTERN_HIGH_ENTROPY = re.compile(
    r'(?:^|[\s=:\'\"(])'
    r'(?:'
    r'(?:sk|pk|ak|rk|ghp|gho|ghu|ghs|ghr|glpat|xox[bpsar]|AKIA|ASIA|eyJ)'  # 已知前缀
    r'[A-Za-z0-9_\-\.]{16,}'
    r')',
)

# 连接串（可能含密码）— 比主层更宽松
_PATTERN_CONNSTR_LOOSE = re.compile(
    r'(?:postgresql|postgres|mysql|redis|mongodb|amqp|mqtt|mssql|oracle|jdbc)'
    r'://[^\s]+:[^\s]+@',
    re.IGNORECASE,
)

# 私钥标记
_PATTERN_PRIVATE_KEY = re.compile(
    r'-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----',
)

# password= 后面跟的看起来像密码的值（比主层更宽松）
_PATTERN_PASSWORD_LOOSE = re.compile(
    r'(?:password|passwd|pwd|pass|secret|credential|token)'
    r'\s*[=:]\s*'
    r'[^\s,，。；;]{3,}',
    re.IGNORECASE,
)

# AWS Access Key
_PATTERN_AWS_KEY = re.compile(
    r'(?:AKIA|ASIA)[A-Z0-9]{16}',
)

# 所有兜底规则
_BACKSTOP_RULES: list[tuple[re.Pattern, str]] = [
    (_PATTERN_HIGH_ENTROPY, "high_entropy_token"),
    (_PATTERN_CONNSTR_LOOSE, "connection_string"),
    (_PATTERN_PRIVATE_KEY, "private_key"),
    (_PATTERN_PASSWORD_LOOSE, "password_assignment"),
    (_PATTERN_AWS_KEY, "aws_access_key"),
]

# 白名单：已经被主层处理的占位符
_PLACEHOLDER_PATTERN = re.compile(r'\{\{secret:sec_\w+\}\}')

# 安全的常见词，不应触发兜底
_SAFE_PATTERNS = frozenset({
    "password", "passwd", "pwd",  # 裸词本身不算泄露
})


def _strip_placeholders(text: str) -> str:
    """去除已被主层处理的占位符，避免误报。"""
    return _PLACEHOLDER_PATTERN.sub("", text)


def detect_pii_leaks(text: str) -> Optional[str]:
    """
    检测文本中可能泄露的 PII/凭证。

    返回匹配的规则名（str）或 None（安全）。
    此函数仅做检测，不做替换。
    """
    # 先去除已处理的占位符
    cleaned = _strip_placeholders(text)

    for pattern, rule_name in _BACKSTOP_RULES:
        match = pattern.search(cleaned)
        if match:
            matched_text = match.group(0).strip()
            # 跳过纯关键词（没有实际值的）
            if matched_text.lower() in _SAFE_PATTERNS:
                continue
            # password_assignment 规则需要额外检查：值部分不能是占位符或问询词
            if rule_name == "password_assignment":
                # 提取 = 后面的值
                parts = re.split(r'[=:]\s*', matched_text, maxsplit=1)
                if len(parts) > 1:
                    val = parts[1].strip()
                    skip_words = {'是什么', '是多少', '是啥', '多少', '什么', '忘了',
                                  'what', 'is', 'the', 'my', 'your', 'none', 'null',
                                  'undefined', 'empty', 'placeholder'}
                    if val.lower() in skip_words or len(val) < 3:
                        continue
            return rule_name
    return None


# ============================================================
# PII 兜底 Middleware
# ============================================================


class PIIBackstopMiddleware(AgentMiddleware):
    """
    拦截点 A 兜底层：PII BLOCK 模式 Middleware。

    在主层（ReversibleSanitizeMiddleware）之后运行。
    扫描所有消息内容，如果检测到未被主层处理的潜在凭证，
    直接 **阻断整个请求**（抛出 PIIBlockError）。

    不回写金库、不做替换——角色仅为 backstop。
    """

    def __init__(self, enabled: bool = True):
        self._enabled = enabled
        self._block_count = 0

    def before_model(self, state: AgentState, runtime=None):
        """
        扫描即将发往模型的消息，检测未被处理的凭证。
        检测到则阻断。
        """
        if not self._enabled:
            return None

        messages = state.get("messages", [])

        for msg in messages:
            content = msg.content if hasattr(msg, 'content') and isinstance(msg.content, str) else ""
            if not content:
                continue

            leak = detect_pii_leaks(content)
            if leak:
                self._block_count += 1
                logger.critical(
                    "🚨 PII 兜底层阻断! 规则=%s, 消息类型=%s (共计阻断 %d 次)",
                    leak,
                    type(msg).__name__,
                    self._block_count,
                )
                raise PIIBlockError(leak)

        return None

    @property
    def block_count(self) -> int:
        """返回已阻断的请求总数。"""
        return self._block_count
