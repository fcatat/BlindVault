"""
BlindVault SSE 流式 Agent API

GET /api/agent/stream — 通过 Server-Sent Events 实时推送 Agent 每一步执行进度。

事件类型：
- sanitized:          消息预处理完成（脱敏结果）
- thinking:           LLM 正在思考（token 流）
- tool_start:         工具开始执行
- tool_end:           工具执行完成
- approval_required:  需要用户审批
- done:               任务完成
- error:              执行出错
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse

from backend.agent.graph import prepare_agent_state, extract_result_from_state
from backend.config import get_settings
from backend.db import create_agent_task, save_agent_task_step, finish_agent_task
from backend.models import ExecutionContext
from backend.redaction import redact_sensitive_fields
from backend.redis_store import get_store
from backend.sanitizer import sanitize_message, detect_leaked_secrets, detect_secrets

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent-stream"])


def _sse_event(event_type: str, data: dict) -> str:
    """格式化 SSE 事件字符串。"""
    payload = json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


def _redact_tool_args(args: dict) -> dict:
    """脱敏工具调用参数中的密码字段。"""
    return {
        k: v if "password" not in k.lower() and "secret" not in k.lower()
        else "[REDACTED]"
        for k, v in args.items()
    }


@router.get("/stream")
async def agent_stream(
    message: str = Query(..., description="用户消息"),
    session_id: str = Query(..., description="会话 ID"),
    confirmed: bool = Query(False, description="高危操作是否已确认"),
    history: str = Query("[]", description="对话历史 JSON 数组"),
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    SSE 流式端点：实时推送 Agent 每一步执行进度。

    前端通过 fetch + ReadableStream 消费，每条消息格式为：
    data: {"type": "...", "data": {...}}
    """

    async def event_generator() -> AsyncGenerator[str, None]:
        task_id = f"atask_{uuid.uuid4().hex[:16]}"
        step_index = 0
        store = await get_store()
        settings = get_settings()

        # 解析历史消息
        try:
            parsed_history = json.loads(history)
        except json.JSONDecodeError:
            parsed_history = []

        # ---- Step 0: 开源版凭证预检测拦截 ----
        local_model_configured = bool(settings.local_model_url)
        if not local_model_configured:
            matches = await detect_secrets(message)
            if matches:
                first_match = matches[0]
                from backend.ee import is_ee_enabled
                block_data = {
                    "reply": "检测到明文凭证，为了系统安全，该指令已被拦截。请到凭证库录入后使用安全引用。",
                    "credential_detected": True,
                    "detected_credential_type": first_match.secret_type,
                    "local_model_configured": False,
                    "is_ee": is_ee_enabled(),
                }
                yield _sse_event("credential_blocked", block_data)
                yield _sse_event("done", block_data)
                return

        # ---- Step 1: 消息脱敏 ----
        sanitized_message, auto_created_refs = await sanitize_message(
            message=message,
            store=store,
            user_id=x_user_id,
            session_id=session_id,
            tenant_id=x_tenant_id,
        )

        # 历史消息脱敏
        sanitized_history = []
        for h in parsed_history:
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

        # 审计层检测
        leaked = detect_leaked_secrets(sanitized_message)

        # 持久化任务记录
        await create_agent_task(
            task_id=task_id,
            user_id=x_user_id,
            session_id=session_id,
            tenant_id=x_tenant_id,
            user_message=message,
            sanitized_message=sanitized_message,
        )

        # 推送脱敏完成事件
        sanitized_event_data = {
            "sanitized_input": sanitized_message,
            "auto_refs": auto_created_refs,
            "task_id": task_id,
            "leak_detected": bool(leaked),
            "leaked_value": leaked[0] if leaked else None,
        }
        yield _sse_event("sanitized", sanitized_event_data)
        await save_agent_task_step(task_id, step_index, "sanitized",
                                   json.dumps(sanitized_event_data, ensure_ascii=False))
        step_index += 1

        # ---- Step 2: 构建 Graph 并流式执行 ----
        try:
            graph, initial_state = prepare_agent_state(
                user_message=sanitized_message,
                store=store,
                user_id=x_user_id,
                session_id=session_id,
                tenant_id=x_tenant_id,
                history=sanitized_history,
                confirmed=confirmed,
            )

            final_reply = ""
            final_tool_calls = []
            final_status = "success"
            final_requires_approval = False
            final_pending_command = ""
            final_triggered_rule = ""

            # 使用 astream_events 逐步推送
            # 注意：LangGraph 的 on_tool_start/on_tool_end 只对 LangChain 原生工具生效，
            # 对我们的自定义 secure_tool_node 不生效。
            # 因此需要从 on_chain_end 的节点输出中提取工具调用信息。
            thinking_buffer = ""  # token 累积缓冲
            thinking_flush_count = 0

            async for event in graph.astream_events(initial_state, version="v2"):
                event_kind = event.get("event", "")
                event_name = event.get("name", "")

                if event_kind == "on_chat_model_stream":
                    # LLM token 流
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        token_data = {"content": chunk.content}
                        yield _sse_event("thinking", token_data)
                        # 降低持久化频率：每 10 个 token 批量写一次
                        thinking_buffer += chunk.content
                        thinking_flush_count += 1
                        if thinking_flush_count >= 10:
                            await save_agent_task_step(
                                task_id, step_index, "thinking",
                                json.dumps({"content": thinking_buffer}, ensure_ascii=False))
                            step_index += 1
                            thinking_buffer = ""
                            thinking_flush_count = 0

                elif event_kind == "on_chain_end":
                    output = event.get("data", {}).get("output", {})

                    # —— 从 chatbot 节点输出中提取 tool_calls → 发送 tool_start ——
                    if isinstance(output, dict) and "messages" in output:
                        from langchain_core.messages import AIMessage, ToolMessage as LCToolMessage
                        for msg in output["messages"]:
                            # chatbot 返回的 AIMessage 带 tool_calls → tool_start
                            if isinstance(msg, AIMessage) and msg.tool_calls:
                                for tc in msg.tool_calls:
                                    tool_start_data = {
                                        "tool": tc["name"],
                                        "args": _redact_tool_args(tc.get("args", {})),
                                    }
                                    yield _sse_event("tool_start", tool_start_data)
                                    await save_agent_task_step(
                                        task_id, step_index, "tool_start",
                                        json.dumps(tool_start_data, ensure_ascii=False))
                                    step_index += 1

                            # secure_tools 节点返回的 ToolMessage → tool_end
                            if isinstance(msg, LCToolMessage):
                                tool_content = msg.content or ""
                                output_data = {}
                                try:
                                    output_data = json.loads(tool_content)
                                except (json.JSONDecodeError, TypeError):
                                    output_data = {"raw": str(tool_content)[:500]}

                                safe_output = redact_sensitive_fields(output_data) if isinstance(output_data, dict) else output_data
                                # 尝试从 ToolMessage 的 name 属性获取工具名
                                tool_name = getattr(msg, "name", None) or "secure_shell"
                                tool_end_data = {"tool": tool_name, "result": safe_output}
                                yield _sse_event("tool_end", tool_end_data)
                                await save_agent_task_step(
                                    task_id, step_index, "tool_end",
                                    json.dumps(tool_end_data, ensure_ascii=False))
                                step_index += 1

                                # 记录 tool_calls 供最终 done 事件使用
                                final_tool_calls.append({
                                    "tool": tool_name,
                                    "args": safe_output.get("command", "") if isinstance(safe_output, dict) else {},
                                })

                            # 提取最终回复
                            if isinstance(msg, AIMessage) and msg.content:
                                final_reply = msg.content

                        # 检查审批/熔断信号
                        if output.get("requires_approval"):
                            final_requires_approval = True
                            final_pending_command = output.get("pending_command", "")
                            final_triggered_rule = output.get("triggered_rule", "")
                            final_status = "requires_approval"

                            approval_data = {
                                "pending_command": final_pending_command,
                                "triggered_rule": final_triggered_rule,
                            }
                            yield _sse_event("approval_required", approval_data)
                            await save_agent_task_step(
                                task_id, step_index, "approval_required",
                                json.dumps(approval_data, ensure_ascii=False))
                            step_index += 1

            # 刷写剩余的 thinking buffer
            if thinking_buffer:
                await save_agent_task_step(
                    task_id, step_index, "thinking",
                    json.dumps({"content": thinking_buffer}, ensure_ascii=False))
                step_index += 1

            # 检查熔断
            if "[安全熔断" in final_reply:
                final_status = "error"

            # ---- Step 3: 推送最终完成事件 ----
            from backend.agent.graph import _SECRET_REF_EXTRACT
            secret_refs = _SECRET_REF_EXTRACT.findall(sanitized_message)

            done_data = {
                "reply": final_reply,
                "tool_calls": final_tool_calls,
                "secret_refs_used": secret_refs + auto_created_refs,
                "sanitized_input": sanitized_message,
                "status": final_status,
                "requires_approval": final_requires_approval,
                "pending_command": final_pending_command,
                "triggered_rule": final_triggered_rule,
                "leak_detected": bool(leaked),
                "leaked_value": leaked[0] if leaked else None,
                "local_model_configured": local_model_configured,
                "task_id": task_id,
            }
            yield _sse_event("done", done_data)
            await save_agent_task_step(task_id, step_index, "done",
                                       json.dumps(done_data, ensure_ascii=False))
            step_index += 1

            # 持久化任务完成状态
            await finish_agent_task(
                task_id=task_id,
                status=final_status,
                final_reply=final_reply,
                total_steps=step_index,
            )

        except Exception as exc:
            logger.exception("SSE 流式执行异常: task_id=%s", task_id)
            error_data = {"error": str(exc)}
            yield _sse_event("error", error_data)
            await save_agent_task_step(task_id, step_index, "error",
                                       json.dumps(error_data, ensure_ascii=False))
            await finish_agent_task(
                task_id=task_id,
                status="error",
                final_reply="",
                total_steps=step_index + 1,
                error_message=str(exc),
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 禁用缓冲
        },
    )
