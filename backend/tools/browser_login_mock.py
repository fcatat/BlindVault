"""
BlindVault Demo 工具：browser_login_mock

模拟浏览器登录操作。工具参数只接受 secret_ref（password_ref），
不接受原文密码。执行时通过 resolve_secret 获取真实密码。

安全规则：
- 参数只能是 username、password_ref、url
- 禁止 password 原文字段
- 返回值只含 login_result，不返回密码
- url origin 必须匹配 secret 的 allowed_destinations
"""

from __future__ import annotations

import logging
import re

from backend.models import ExecutionContext, ResolveRequest
from backend.policy import SecretResolutionError, resolve_secret
from backend.redis_store import SecretStore

logger = logging.getLogger(__name__)

# 工具参数 schema（供 LangGraph / LLM 使用）
BROWSER_LOGIN_MOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "username": {
            "type": "string",
            "description": "登录用户名",
        },
        "password_ref": {
            "type": "string",
            "description": "密码的 secret 引用（secret_ref），格式如 sec_live_xxx。不要传入明文密码。",
        },
        "url": {
            "type": "string",
            "description": "登录目标 URL",
        },
    },
    "required": ["username", "password_ref", "url"],
}


async def browser_login_mock(
    username: str,
    password_ref: str,
    url: str,
    *,
    store: SecretStore,
    ctx: ExecutionContext,
) -> dict:
    """
    模拟浏览器登录。

    Args:
        username: 登录用户名
        password_ref: secret_ref（如 sec_live_xxx）
        url: 登录目标 URL
        store: Redis 存储（由 executor 注入）
        ctx: 执行上下文（由 executor 注入）

    Returns:
        {"login_result": "success" | "failure", "url": url, "username": username}
        绝不返回密码
    """
    # 验证 password_ref 格式
    if not re.match(r"^sec_(?:live|test)_[A-Za-z0-9_-]+$", password_ref):
        logger.warning("browser_login_mock: 无效的 password_ref 格式")
        return {
            "login_result": "failure",
            "reason": "Invalid secret reference format",
            "url": url,
            "username": username,
        }

    try:
        # 调用 resolve_secret 获取真实密码
        # destination 传入 url，用于 origin 匹配校验
        real_password = await resolve_secret(
            store=store,
            ctx=ctx,
            request=ResolveRequest(
                secret_ref=password_ref,
                requested_use="password",
                destination=url,
            ),
        )

        # 模拟登录逻辑：密码非空即视为成功
        if real_password:
            login_result = "success"
        else:
            login_result = "failure"

        # ⚠️ real_password 使用后不保留引用
        del real_password

        return {
            "login_result": login_result,
            "url": url,
            "username": username,
            # ⚠️ 绝不返回 password
        }

    except SecretResolutionError:
        return {
            "login_result": "failure",
            "reason": "Secret resolution denied",
            "url": url,
            "username": username,
        }
    except Exception:
        logger.exception("browser_login_mock: 执行异常")
        return {
            "login_result": "failure",
            "reason": "Internal error",
            "url": url,
            "username": username,
        }
