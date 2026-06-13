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
from blindvault_agent.cli import local_subprocess_executor

logger = logging.getLogger(__name__)

# 全局 Agent 实例（支持会话级并发，状态由 checkpointer 管理）
agent = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent
    logger.info("初始化 BlindVault Agent Web 服务...")
    # B1 fail-closed 保护：注入安全执行器
    agent = create_blindvault_agent(executor=local_subprocess_executor)
    yield

app = FastAPI(lifespan=lifespan)

class ChatRequest(BaseModel):
    message: str
    thread_id: str

class ApproveRequest(BaseModel):
    thread_id: str
    decision: str  # "approve" | "reject"

@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    # 坑 #2: Web 层不要记录 message 到日志，以免明文密码泄露
    config = {"configurable": {"thread_id": req.thread_id}}
    
    try:
        # 进入 BlindVaultAgent 的 invoke 生命周期
        result = agent.invoke(
            {"messages": [{"role": "user", "content": req.message}]},
            config=config
        )
        
        # 检查是否因为高危命令暂停
        state = agent.agent_graph.get_state(config)
        pending_interrupts = []
        for task in state.tasks:
            if task.interrupts:
                pending_interrupts.extend(task.interrupts)
                
        if pending_interrupts:
            interrupt_val = pending_interrupts[0].value
            return {
                "status": "interrupt",
                "pending": {
                    "command": interrupt_val.get("command"),
                    "risk_description": interrupt_val.get("risk_description")
                }
            }
            
        # 正常执行完成，提取数据
        messages = result.get("messages", [])
        reply = ""
        tool_output = ""
        
        # 从最后开始找 ToolMessage 和 AIMessage
        for msg in reversed(messages):
            if msg.type == "ai" and msg.content and not reply:
                reply = msg.content
            elif msg.type == "tool" and not tool_output:
                tool_output = msg.content
                
        # 提取已生成的脱敏凭证数量
        sanitized_count = getattr(agent.sanitize_mw, "sanitize_count", 0)
        
        return {
            "status": "done",
            "reply": reply,
            "tool_output": tool_output,
            "sanitized_count": sanitized_count
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Chat API 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/approve")
def approve_endpoint(req: ApproveRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    
    if req.decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid decision")
        
    try:
        # 坑 #1: resume 必须走 agent.ainvoke/invoke 包装器，不能走 agent_graph，保证依赖注入
        result = agent.invoke(
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

HTML_CONTENT = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>BlindVault Agent Web UI</title>
    <style>
        body { font-family: 'Inter', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; display: flex; justify-content: center;}
        .chat-container { width: 100%; max-width: 800px; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; height: 90vh;}
        .header { text-align: center; border-bottom: 1px solid #30363d; padding-bottom: 15px; margin-bottom: 20px; }
        .header h2 { margin: 0; color: #58a6ff; }
        .status-banner { background: #1f3a28; color: #3fb950; padding: 10px; border-radius: 6px; font-size: 14px; text-align: center; margin-bottom: 15px; display: none; border: 1px solid #238636;}
        
        .messages { flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; padding-right: 10px; margin-bottom: 20px; }
        .msg { padding: 12px 16px; border-radius: 8px; max-width: 85%; line-height: 1.5; }
        .msg.user { background: #238636; color: white; align-self: flex-end; }
        .msg.agent { background: #21262d; border: 1px solid #30363d; align-self: flex-start; }
        .msg.tool { background: #000; color: #8b949e; font-family: monospace; font-size: 13px; align-self: stretch; max-width: 100%; white-space: pre-wrap; word-break: break-all; border: 1px solid #30363d;}
        
        .redacted { background: #da3633; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.9em; margin: 0 4px;}
        
        .approval-card { background: #3d0000; border: 1px solid #da3633; border-radius: 8px; padding: 16px; align-self: center; width: 90%; margin-top: 10px; box-shadow: 0 4px 12px rgba(218, 54, 51, 0.2); }
        .approval-card h3 { margin-top: 0; color: #ff7b72; font-size: 16px; display: flex; align-items: center; gap: 8px; }
        .approval-card code { background: #000; padding: 6px 10px; border-radius: 4px; display: block; margin: 10px 0; border: 1px solid #ff7b72; color: #ff7b72;}
        
        .btn-group { display: flex; gap: 10px; margin-top: 15px; }
        .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.2s; font-size: 14px;}
        .btn-approve { background: #da3633; color: white; }
        .btn-approve:hover { background: #b62324; }
        .btn-reject { background: #21262d; color: #c9d1d9; border: 1px solid #8b949e; }
        .btn-reject:hover { background: #30363d; }
        
        .input-area { display: flex; gap: 10px; }
        input[type="text"] { flex-grow: 1; padding: 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 15px; outline: none; }
        input[type="text"]:focus { border-color: #58a6ff; }
        button#send-btn { padding: 12px 24px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 15px; }
        button#send-btn:disabled { background: #21262d; color: #8b949e; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="header">
            <h2>🛡️ BlindVault 安全运维终端</h2>
        </div>
        
        <div id="status-area" class="status-banner"></div>
        
        <div class="messages" id="messages">
            <div class="msg agent">👋 欢迎使用 BlindVault 安全运维 Agent。请输入运维需求，例如：<br><code>psql postgresql://admin:MyPass123@db/app -c 'DROP DATABASE x'</code></div>
        </div>
        
        <div class="input-area">
            <input type="text" id="user-input" placeholder="输入命令..." autocomplete="off"/>
            <button id="send-btn" onclick="sendMessage()">发送</button>
        </div>
    </div>

    <script>
        const threadId = crypto.randomUUID();
        const msgContainer = document.getElementById('messages');
        const inputField = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');
        const statusArea = document.getElementById('status-area');
        
        function scrollToBottom() {
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }

        function highlightRedacted(text) {
            if (!text) return '';
            // HTML escape to prevent XSS
            const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return escaped.replace(/\\[REDACTED\\]/g, '<span class="redacted">[REDACTED]</span>');
        }

        function appendMessage(role, content, isHtml = false) {
            const div = document.createElement('div');
            div.className = `msg ${role}`;
            if (isHtml) {
                div.innerHTML = content;
            } else {
                div.textContent = content;
            }
            msgContainer.appendChild(div);
            scrollToBottom();
        }

        function updateStatusCount(count) {
            if (count > 0) {
                statusArea.style.display = 'block';
                statusArea.innerHTML = `🛡️ <b>本轮已生成 ${count} 个临时凭证（密码未进入模型）</b>`;
            }
        }

        function setLoading(isLoading) {
            sendBtn.disabled = isLoading;
            inputField.disabled = isLoading;
            if (isLoading) {
                sendBtn.textContent = '执行中...';
            } else {
                sendBtn.textContent = '发送';
                inputField.focus();
            }
        }

        async function sendMessage() {
            const message = inputField.value.trim();
            if (!message) return;
            
            appendMessage('user', message);
            inputField.value = '';
            setLoading(true);
            
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ message, thread_id: threadId })
                });
                const data = await res.json();
                handleResponse(data);
            } catch (err) {
                appendMessage('agent', `❌ 网络或服务错误: ${err.message}`);
                setLoading(false);
            }
        }
        
        async function sendApprove(decision) {
            // 清除所有的审批卡片
            document.querySelectorAll('.approval-card').forEach(el => el.remove());
            appendMessage('user', `[人工干预] 已选择：${decision === 'approve' ? '✅ 批准执行' : '❌ 拒绝执行'}`);
            setLoading(true);
            
            try {
                const res = await fetch('/api/approve', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ thread_id: threadId, decision })
                });
                const data = await res.json();
                handleResponse(data);
            } catch (err) {
                appendMessage('agent', `❌ 网络或服务错误: ${err.message}`);
                setLoading(false);
            }
        }

        function handleResponse(data) {
            if (data.sanitized_count !== undefined) {
                updateStatusCount(data.sanitized_count);
            }

            if (data.status === 'interrupt') {
                const pending = data.pending;
                const cardHtml = `
                    <div class="approval-card">
                        <h3>⚠️ 触发高危操作审批</h3>
                        <div style="font-size:14px; margin-bottom:8px; color:#c9d1d9;"><b>命中规则:</b> ${pending.risk_description}</div>
                        <div><b>即将执行的命令（占位符版）:</b></div>
                        <code>${pending.command}</code>
                        <div class="btn-group">
                            <button class="btn btn-approve" onclick="sendApprove('approve')">批准执行</button>
                            <button class="btn btn-reject" onclick="sendApprove('reject')">拒绝执行</button>
                        </div>
                    </div>
                `;
                appendMessage('agent', cardHtml, true);
            } else {
                if (data.reply) {
                    appendMessage('agent', `🤖 ${data.reply}`);
                }
                if (data.tool_output) {
                    const formatted = highlightRedacted(data.tool_output);
                    appendMessage('tool', formatted, true);
                }
                setLoading(false);
            }
        }
        
        inputField.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendMessage();
        });
    </script>
</body>
</html>
"""

@app.get("/")
def index():
    return HTMLResponse(content=HTML_CONTENT)

"""
测试命令：
uvicorn blindvault_agent.web:app --host 0.0.0.0 --port 8000
"""
