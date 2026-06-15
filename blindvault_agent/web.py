"""
BlindVault Agent Web UI 演示层
实现带有高危审批和脱敏回显的 FastAPI + 内置前端
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from langgraph.types import Command

from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings

logger = logging.getLogger(__name__)

# 全局 Agent 实例（支持会话级并发，状态由 checkpointer 管理）
agent = None

async def safe_demo_executor(command: str) -> dict:
    """安全的 Mock 执行器，用于 Web 演示，防止真实执行高危命令"""
    if "DROP" in command or "rm " in command or "mkfs" in command:
        # 强制替换任何看起来像密码的地方为 [REDACTED]，以展示脱敏效果
        import re
        safe_cmd = re.sub(r'(://[^:@\s]*:)[^@\s]+(@)', r'\1[REDACTED]\2', command)
        return {
            "stdout": f"✅ [模拟执行成功] 该命令在 Demo 模式下已被安全拦截并模拟执行: {safe_cmd}",
            "stderr": "",
            "exit_code": 0
        }
    from blindvault_agent.cli import local_subprocess_executor
    return await local_subprocess_executor(command)

from langgraph.checkpoint.redis.aio import AsyncRedisSaver

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent
    logger.info("初始化 BlindVault Agent Web 服务...")
    # B1 fail-closed 保护：注入安全执行器
    # 坑 #2: 注入沙箱/Mock 执行器
    settings = get_agent_settings()
    sys_prompt = settings.system_prompt
    async with AsyncRedisSaver.from_conn_string(settings.redis_url) as checkpointer:
        await checkpointer.setup()
        agent = create_blindvault_agent(
            executor=safe_demo_executor,
            system_prompt=sys_prompt,
            checkpointer=checkpointer
        )
        yield

app = FastAPI(lifespan=lifespan)

class ChatRequest(BaseModel):
    message: str
    thread_id: str

class ApproveRequest(BaseModel):
    thread_id: str
    decision: str  # "approve" | "reject"

from fastapi.responses import StreamingResponse
import json

@app.get("/api/chat/stream")
async def chat_stream_endpoint(message: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    
    async def event_generator():
        try:
            async for event in agent.astream_events(
                {"messages": [{"role": "user", "content": message}]},
                config=config,
                version="v2"
            ):
                kind = event["event"]
                
                # 1. LLM 推理思维流
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if chunk.content:
                        yield f"data: {json.dumps({'type': 'thinking', 'data': {'content': chunk.content}})}\n\n"
                        
                # 2. Tool Start
                elif kind == "on_tool_start":
                    tool_name = event["name"]
                    args = event["data"].get("input", {})
                    # 特殊处理 record_plan 工具
                    if tool_name == "record_plan":
                        yield f"data: {json.dumps({'type': 'plan', 'data': {'steps': args.get('steps', [])}})}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'tool_start', 'data': {'tool': tool_name, 'args': args}})}\n\n"
                        
                # 3. Tool End
                elif kind == "on_tool_end":
                    tool_name = event["name"]
                    result = event["data"].get("output", {})
                    
                    # 修复: 可能是 ToolMessage 对象
                    if hasattr(result, "content"):
                        result = result.content
                    elif hasattr(result, "get") and hasattr(result.get("output"), "content"):
                        # 有时候可能是嵌套的
                        result = result.get("output").content

                    # 如果工具抛出错误，它的 output 可能是字符串
                    if isinstance(result, str):
                        try:
                            result = json.loads(result)
                        except:
                            result = {"status": "error", "reason": result}
                            
                    if not isinstance(result, dict):
                        result = {"status": "error", "reason": str(result)}

                    # 判断是不是失败重试 (通过 Exit Code != 0)
                    if tool_name != "record_plan":
                        is_error = result.get("exit_code", 0) != 0 or result.get("status") == "error"
                        if is_error:
                            yield f"data: {json.dumps({'type': 'retry', 'data': {'reason': result.get('stderr', 'Execution failed')}})}\n\n"
                            
                        yield f"data: {json.dumps({'type': 'tool_end', 'data': {'tool': tool_name, 'result': result}})}\n\n"
                        
            # 流结束后，检查是否有中断 (HITL 审批)
            state = await agent.agent_graph.aget_state(config)
            pending_interrupts = []
            for task in state.tasks:
                if task.interrupts:
                    pending_interrupts.extend(task.interrupts)
                    
            if pending_interrupts:
                interrupt_val = pending_interrupts[0].value
                yield f"data: {json.dumps({'type': 'interrupt', 'data': {'pending_command': interrupt_val.get('command'), 'risk_description': interrupt_val.get('risk_description')}})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'done', 'data': {}})}\n\n"
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Stream API 错误: {e}")
            yield f"data: {json.dumps({'type': 'error', 'data': {'error': str(e)}})}\n\n"
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/approve")
async def approve_endpoint(req: ApproveRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    
    if req.decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid decision")
        
    try:
        # 坑 #1: resume 必须走 agent.ainvoke/invoke 包装器，不能走 agent_graph，保证依赖注入
        result = await agent.ainvoke(
            Command(resume={"decisions": [{"type": req.decision}]}),
            config=config
        )
        
        messages = result.get("messages", [])
        reply = ""
        tool_output = ""
        
        for msg in reversed(messages):
            if msg.type == "ai" and msg.content and not reply:
                reply = msg.content
            elif msg.type == "tool" and not tool_output:
                tool_output = msg.content
                
        sanitized_count = getattr(agent.sanitize_mw, "sanitize_count", 0)
        
        return {
            "status": "done",
            "reply": reply,
            "tool_output": tool_output,
            "sanitized_count": sanitized_count
        }
    except Exception as e:
        logger.error(f"Approve API 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 开源版功能页对接 - 子任务 A: 凭证金库
# ==========================================
from blindvault_agent.security.models import SecretMetadataResponse
from fastapi import Header

@app.get("/api/secrets", response_model=list[SecretMetadataResponse])
async def list_secrets_endpoint(x_user_id: str = Header("system")):
    """列出当前用户的 secret 元数据（不含明文/密文）"""
    if not agent or not agent.store:
        raise HTTPException(status_code=500, detail="Store not initialized")
        
    # MVP 阶段：中间件固定使用了 "system" 作为 user_id 创建金库条目
    # 为了演示，强制查询 "system" 的秘密，无视 x_user_id
    records = await agent.store.list_secrets("system")
    result = []
    for r in records:
        reads_left = max(0, r.max_reads - r.read_count)
        result.append(SecretMetadataResponse(
            secret_ref=r.secret_ref,
            label=r.label,
            secret_type=r.secret_type,
            allowed_tools=r.allowed_tools,
            allowed_destinations=r.allowed_destinations,
            expires_at=r.expires_at,
            reads_left=reads_left,
            status=r.status
        ))
    return result

@app.post("/api/secrets/{secret_ref}/revoke")
async def revoke_secret_endpoint(secret_ref: str):
    """撤销某个 secret"""
    if not agent or not agent.store:
        raise HTTPException(status_code=500, detail="Store not initialized")
        
    success = await agent.store.revoke_secret(secret_ref)
    if not success:
        raise HTTPException(status_code=404, detail="Secret not found")
    return {"status": "success", "message": "Secret revoked"}



# ==========================================
# 开源版功能页对接 - 子任务 B & C
# ==========================================
@app.get("/api/sanitize-rules")
async def list_sanitize_rules():
    """返回内置可逆脱敏规则的只读描述"""
    return [
        {
            "name": "中文上下文密码检测",
            "description": "识别并保护中文语境下的密码或凭据（如：密码是 123456）",
            "example": "密码是 my_secret_123"
        },
        {
            "name": "英文上下文密码检测",
            "description": "识别并保护英文语境下的密码或凭据（如：password is 123456）",
            "example": "password is my_secret_123"
        },
        {
            "name": "API Key / Token 检测",
            "description": "识别各种 API Key、Token 及其相关变体",
            "example": "api_key=sk-xxxxxxxxxxxxxxxxxxxxxxxx"
        },
        {
            "name": "连接串密码检测",
            "description": "识别数据库或消息队列连接串中包含的密码",
            "example": "postgresql://user:my_db_pass@localhost:5432"
        }
    ]

from blindvault_agent.config import get_agent_settings

@app.get("/api/agent-config")
async def get_agent_config():
    """返回 Agent 配置，屏蔽敏感信息"""
    settings = get_agent_settings()
    return {
        "litellm_base_url": settings.litellm_base_url,
        "default_model": settings.default_model,
        "has_api_key": bool(settings.litellm_api_key),
        "system_prompt": settings.system_prompt,
        "max_iterations": settings.max_iterations
    }


"""
测试命令：
uvicorn blindvault_agent.web:app --host 0.0.0.0 --port 8000
"""
