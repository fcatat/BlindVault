"""
BlindVault Agent API

POST /api/agent/run — 调用 LangGraph agent 处理用户消息。

安全规则：
- 用户消息中的密码等敏感信息会被自动检测并替换为 secret_ref
- LLM 只看到 {{secret:sec_xxx}} 引用，永远看不到真实密码
- secret 解析只发生在 SecureToolNode 内部
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException

from backend.agent.graph import run_agent
from backend.models import AgentRunRequest, AgentRunResponse
from backend.redis_store import get_store
from backend.sanitizer import sanitize_message, detect_leaked_secrets
from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/run", response_model=AgentRunResponse)
async def agent_run(
    req: AgentRunRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_session_id: str = Header(None, alias="X-Session-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    运行 agent 处理用户消息。

    处理流程：
    1. 预处理：自动检测消息中的密码/token，创建 secret 并替换
    2. LLM 调用：模型只看到 {{secret:sec_xxx}} 引用
    3. 工具执行：SecureToolNode 在安全环境中解析 secret

    Headers:
    - X-User-Id: 用户 ID（必需）
    - X-Session-Id: 会话 ID（可选，默认使用请求体中的 session_id）
    - X-Tenant-Id: 租户 ID（可选，默认 "default"）
    """
    session_id = x_session_id or req.session_id
    store = await get_store()

    # ---- 消息预处理：自动检测并保护敏感信息 ----
    sanitized_message, auto_created_refs = await sanitize_message(
        message=req.user_message,
        store=store,
        user_id=x_user_id,
        session_id=session_id,
        tenant_id=x_tenant_id,
    )

    if auto_created_refs:
        logger.info(
            "消息预处理完成: 自动创建了 %d 个 secret",
            len(auto_created_refs),
        )

    # ---- 安全防护策略检测：任何包含未加密明文凭证的操作，统统进行硬拦截阻断 ----
    leaked = detect_leaked_secrets(sanitized_message)
    if leaked is not None:
        raise HTTPException(
            status_code=400,
            detail=f"检测到疑似明文凭证数据（{leaked}）外泄！为了系统安全，该指令已被拦截。请在凭证库中录入凭据并使用安全引用。"
        )

    # ---- 调用 Agent（使用已脱敏的消息）----
    result = await run_agent(
        user_message=sanitized_message,
        store=store,
        user_id=x_user_id,
        session_id=session_id,
        tenant_id=x_tenant_id,
        history=req.history,
        confirmed=req.confirmed,
    )

    # 合并自动创建的 secret_refs
    all_refs = list(set(result.get("secret_refs_used", []) + auto_created_refs))
    result["secret_refs_used"] = all_refs
    result["sanitized_input"] = sanitized_message

    # 旁路安全审计检测明文泄漏
    result["leak_detected"] = leaked is not None
    result["leaked_value"] = leaked

    return AgentRunResponse(**result)
