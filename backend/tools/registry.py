"""
BlindVault 工具注册表

管理工具的注册、schema 查询和安全 denylist。

安全规则：
- DENYLIST_TOOLS 中的工具禁止接受 secret_ref 参数
- 所有工具执行前必须通过 denylist 检查
"""

from __future__ import annotations

import re
import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# Secret ref 检测模式
_SECRET_REF_DETECT = re.compile(r"(?:\{\{secret:)?sec_(?:live|test)_[A-Za-z0-9_-]+\}?\}?")

# ============================================================
# 工具注册表
# ============================================================

# 工具名 → (工具函数, schema 描述)
TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def register_tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
    func: Callable,
) -> None:
    """注册一个工具。"""
    TOOL_REGISTRY[name] = {
        "name": name,
        "description": description,
        "parameters": parameters,
        "func": func,
    }


def get_tool_schema(tool_name: str) -> Optional[dict]:
    """获取工具的 schema 描述。"""
    tool = TOOL_REGISTRY.get(tool_name)
    if tool is None:
        return None
    return {
        "name": tool["name"],
        "description": tool["description"],
        "parameters": tool["parameters"],
    }


def get_all_tool_schemas() -> list[dict]:
    """获取所有已注册工具的 schema。"""
    return [get_tool_schema(name) for name in TOOL_REGISTRY]


# ============================================================
# 安全 Denylist
# ============================================================

# 禁止接受 secret_ref 的工具列表
# 这些是"外发型"工具，可能导致 secret 泄露
DENYLIST_TOOLS: set[str] = {
    "send_email",
    "write_file",
    "web_search",
    "ask_llm",
    "generic_http_request",
}


def is_tool_denied(tool_name: str) -> bool:
    """检查工具是否在 denylist 中。"""
    return tool_name in DENYLIST_TOOLS


def check_args_for_secret_ref(args: dict[str, Any]) -> bool:
    """
    检查工具参数中是否包含 secret_ref。

    用于 denylist 工具的参数检查——如果 denylist 工具的参数中
    包含 secret_ref 模式，应拒绝执行。

    Returns:
        True 如果发现 secret_ref，False 如果安全
    """
    for key, val in args.items():
        if isinstance(val, str) and _SECRET_REF_DETECT.search(val):
            logger.warning(
                "发现 denylist 工具参数中包含 secret_ref: field=%s", key
            )
            return True
    return False
