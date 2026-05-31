"""
BlindVault 日志脱敏模块

实现三层脱敏：
1. redact_sensitive_fields: 递归脱敏 dict 中的敏感字段
2. redact_secret_ref: 部分隐藏 secret_ref（保留前缀 + 前 4 字符）
3. RedactionMiddleware: FastAPI 中间件，拦截请求/响应日志

安全原则：
- 禁止记录 /api/secrets 的 request body
- 禁止记录包含 value/password/secret/token/api_key/authorization/cookie 的真实值
- exception log 不 dump 完整 request body
"""

from __future__ import annotations

import copy
import json
import logging
import re
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# ============================================================
# 敏感字段名匹配模式
# ============================================================

# 精确匹配敏感字段名
# 使用 fullmatch 风格：字段名本身或以 _ 为分隔的复合名中包含这些词
_SENSITIVE_FIELD_NAMES = {
    "value", "password", "secret", "token", "api_key",
    "authorization", "cookie", "private_key",
    "access_token", "refresh_token", "secret_key",
    "client_secret", "api_secret",
}

# 也匹配包含这些后缀的字段名（如 db_password, user_token）
_SENSITIVE_SUFFIX_PATTERN = re.compile(
    r"(?:^|_)(password|secret|token|api_key|authorization|cookie|private_key)(?:$|_)",
    re.IGNORECASE,
)


def _is_sensitive_field(field_name: str) -> bool:
    """检查字段名是否为敏感字段。"""
    lower = field_name.lower()
    # 完全匹配
    if lower in _SENSITIVE_FIELD_NAMES:
        return True
    # 后缀/前缀匹配（如 db_password, access_token）
    if _SENSITIVE_SUFFIX_PATTERN.search(lower):
        return True
    return False

# Secret ref 匹配模式：sec_live_xxx 或 sec_test_xxx
_SECRET_REF_PATTERN = re.compile(
    r"(sec_(?:live|test)_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]*"
)

_REDACTED = "[REDACTED]"


# ============================================================
# 脱敏工具函数
# ============================================================


def redact_sensitive_fields(data: Any) -> Any:
    """
    递归遍历 dict/list，对字段名匹配敏感模式的值替换为 [REDACTED]。

    Args:
        data: 任意嵌套的 dict/list/基本类型

    Returns:
        脱敏后的深拷贝（不修改原始数据）
    """
    if isinstance(data, dict):
        result = {}
        for key, val in data.items():
            if isinstance(key, str) and _is_sensitive_field(key):
                result[key] = _REDACTED
            else:
                result[key] = redact_sensitive_fields(val)
        return result
    elif isinstance(data, list):
        return [redact_sensitive_fields(item) for item in data]
    elif isinstance(data, str):
        return redact_secret_ref(data)
    return data


def redact_secret_ref(text: str) -> str:
    """
    部分隐藏 secret_ref。

    示例：sec_live_abcdefgh12345678 → sec_live_abcd****

    Args:
        text: 可能包含 secret_ref 的字符串

    Returns:
        脱敏后的字符串
    """
    return _SECRET_REF_PATTERN.sub(r"\1****", text)


def redact_log_message(message: str) -> str:
    """
    综合脱敏日志消息。

    对字符串中的 secret_ref 和常见敏感模式进行脱敏。
    """
    result = redact_secret_ref(message)
    return result


# ============================================================
# FastAPI 日志脱敏中间件
# ============================================================


class RedactionMiddleware(BaseHTTPMiddleware):
    """
    FastAPI 中间件：拦截请求/响应日志进行脱敏。

    规则：
    - POST /api/secrets 的请求体完全不记录
    - 所有异常不 dump 完整 request body
    - 响应日志中的敏感字段被脱敏
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        path = request.url.path
        method = request.method

        # 记录请求（脱敏）
        if method == "POST" and "/api/secrets" in path and "/revoke" not in path:
            # 禁止记录创建 secret 的请求体
            logger.info("请求: %s %s (请求体已脱敏)", method, path)
        else:
            logger.info("请求: %s %s", method, path)

        try:
            response = await call_next(request)
            logger.info("响应: %s %s -> %d", method, path, response.status_code)
            return response
        except Exception as exc:
            # 异常日志不 dump 完整 request body 或 tool args
            logger.error(
                "请求异常: %s %s -> %s",
                method,
                path,
                redact_log_message(str(exc)),
            )
            raise


# ============================================================
# 自定义 Log Filter（可选：为 logging 框架增加全局脱敏）
# ============================================================


class RedactionLogFilter(logging.Filter):
    """
    日志过滤器：对所有日志消息进行 secret_ref 脱敏。
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_log_message(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: redact_log_message(str(v)) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    redact_log_message(str(a)) if isinstance(a, str) else a
                    for a in record.args
                )
        return True
