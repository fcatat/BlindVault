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
from backend.models import AgentRunRequest, AgentRunResponse, ExecutionContext
from backend.redis_store import get_store
from backend.sanitizer import sanitize_message, detect_leaked_secrets
from backend.config import get_settings
from backend.tools.secure_shell import secure_shell

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

    # 检查是否配置了本地模型 (企业版标志)
    settings = get_settings()
    local_model_configured = bool(settings.local_model_url)

    # 如果是开源版 (未配置本地模型)，正则匹配到敏感字则拦截提醒录入
    if not local_model_configured:
        from backend.sanitizer import detect_secrets
        matches = await detect_secrets(req.user_message)
        if matches:
            first_match = matches[0]
            logger.info("开源版检测到明文凭证，执行拦截。类型: %s", first_match.secret_type)
            return AgentRunResponse(
                reply="检测到明文凭证，为了系统安全，该指令已被拦截。请到凭证库录入后使用安全引用。",
                status="credential_detected",
                credential_detected=True,
                detected_credential_type=first_match.secret_type,
                local_model_configured=False,
            )

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

    # ---- 历史消息预处理：对 history 中的 user 消息做脱敏保护，防止历史明文进入大模型 ----
    sanitized_history = []
    for h in req.history:
        if h.get("role") == "user":
            h_sanitized, h_refs = await sanitize_message(
                message=h.get("content", ""),
                store=store,
                user_id=x_user_id,
                session_id=session_id,
                tenant_id=x_tenant_id,
            )
            sanitized_history.append({"role": "user", "content": h_sanitized})
            if h_refs:
                auto_created_refs.extend(h_refs)
        else:
            sanitized_history.append(h)

    # ---- 安全防护策略检测：旁路审计明文凭证外泄（不作拦截，仅记录以备后续警告） ----
    leaked = detect_leaked_secrets(sanitized_message)

    # ---- 调用 Agent（使用已脱敏的消息）----
    result = await run_agent(
        user_message=sanitized_message,
        store=store,
        user_id=x_user_id,
        session_id=session_id,
        tenant_id=x_tenant_id,
        history=sanitized_history,
        confirmed=req.confirmed,
    )

    # 合并自动创建的 secret_refs
    all_refs = list(set(result.get("secret_refs_used", []) + auto_created_refs))
    result["secret_refs_used"] = all_refs
    result["sanitized_input"] = sanitized_message

    # 旁路安全审计检测明文泄漏
    result["leak_detected"] = leaked is not None
    result["leaked_value"] = leaked
    result["local_model_configured"] = local_model_configured

    return AgentRunResponse(**result)


