"""
BlindVault SecureToolNode（LangGraph 自定义 Tool Node）

替代 LangGraph 默认的 ToolNode，在工具执行前插入：
1. Denylist 检查
2. Secret_ref 参数检测（denylist 工具）
3. Secret 解析 + 权限校验
4. 执行后结果脱敏

这是 BlindVault 安全架构的关键拦截点。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage

from backend.models import ExecutionContext
from backend.redis_store import SecretStore
from backend.redaction import redact_sensitive_fields, redact_secret_ref
from backend.tools.registry import (
    TOOL_REGISTRY,
    check_args_for_secret_ref,
    is_tool_denied,
)

logger = logging.getLogger(__name__)


async def execute_tool_call(
    tool_name: str,
    tool_args: dict[str, Any],
    tool_call_id: str,
    store: SecretStore,
    ctx: ExecutionContext,
) -> ToolMessage:
    """
    安全执行单个工具调用。

    流程：
    1. 检查 tool_name 是否在 denylist → 拒绝
    2. 如果是 denylist 工具，检查参数是否含 secret_ref → 拒绝
    3. 查找工具函数
    4. 调用工具函数（工具内部调用 resolve_secret）
    5. 脱敏返回结果

    Args:
        tool_name: 工具名称
        tool_args: 工具参数
        tool_call_id: LLM 的 tool_call_id
        store: Redis 存储实例
        ctx: 执行上下文

    Returns:
        LangChain ToolMessage
    """
    # 1. Denylist 检查
    if is_tool_denied(tool_name):
        logger.warning("工具执行被拒绝（denylist）: tool=%s", tool_name)
        return ToolMessage(
            content=json.dumps({
                "error": "Tool execution denied",
                "tool": tool_name,
            }),
            tool_call_id=tool_call_id,
        )

    # 2. Denylist 工具的参数中包含 secret_ref → 拒绝
    # （即使工具不在 denylist 中，此检查也确保外发型工具不泄露 secret）
    if is_tool_denied(tool_name) and check_args_for_secret_ref(tool_args):
        logger.warning(
            "工具参数包含 secret_ref 被拒绝: tool=%s", tool_name
        )
        return ToolMessage(
            content=json.dumps({
                "error": "Secret references not allowed in this tool",
                "tool": tool_name,
            }),
            tool_call_id=tool_call_id,
        )

    # 3. 查找工具
    tool_entry = TOOL_REGISTRY.get(tool_name)
    if tool_entry is None:
        logger.warning("工具不存在: tool=%s", tool_name)
        return ToolMessage(
            content=json.dumps({
                "error": f"Unknown tool: {tool_name}",
            }),
            tool_call_id=tool_call_id,
        )

    # 4. 执行工具（注入 store 和 ctx）
    tool_func = tool_entry["func"]

    # 构造带上下文的调用参数
    call_ctx = ExecutionContext(
        user_id=ctx.user_id,
        session_id=ctx.session_id,
        tenant_id=ctx.tenant_id,
        tool_name=tool_name,
    )

    try:
        result = await tool_func(**tool_args, store=store, ctx=call_ctx)
    except Exception as exc:
        logger.error("工具执行异常: tool=%s, error=%s", tool_name, redact_secret_ref(str(exc)))
        result = {"error": "Tool execution failed"}

    # 5. 脱敏结果
    safe_result = redact_sensitive_fields(result)
    return ToolMessage(
        content=json.dumps(safe_result, ensure_ascii=False),
        tool_call_id=tool_call_id,
    )


async def secure_tool_node(state: dict, store: SecretStore, ctx: ExecutionContext) -> dict:
    """
    LangGraph 自定义 Tool Node。

    从 state["messages"] 中提取最后一条 AIMessage 的 tool_calls，
    逐个安全执行并返回 ToolMessage 列表。

    Args:
        state: LangGraph 状态（包含 messages）
        store: Redis 存储实例
        ctx: 执行上下文

    Returns:
        {"messages": [ToolMessage, ...]}
    """
    messages = state["messages"]

    # 找到最后一条含有 tool_calls 的 AIMessage
    last_ai_msg = None
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            last_ai_msg = msg
            break

    if last_ai_msg is None:
        return {"messages": []}

    tool_messages = []
    for tool_call in last_ai_msg.tool_calls:
        tool_msg = await execute_tool_call(
            tool_name=tool_call["name"],
            tool_args=tool_call["args"],
            tool_call_id=tool_call["id"],
            store=store,
            ctx=ctx,
        )
        tool_messages.append(tool_msg)

    return {"messages": tool_messages}
