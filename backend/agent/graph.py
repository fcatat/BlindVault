"""
BlindVault LangGraph Agent

使用 LangGraph StateGraph 构建 agent 流程：
- chatbot node：调用 LLM（或 mock）
- secure_tools node：SecureToolNode（安全工具执行）
- 条件路由：有 tool_call → secure_tools → chatbot，否则 → END

支持两种模式：
- mock 模式：不调用真实 LLM，根据关键词自动构造 tool_call（开发/测试用）
- openai 模式：使用 ChatOpenAI 调用真实 LLM

核心安全保证：
- LLM 只看到 secret_ref，永远不看到真实 secret
- 所有 secret 解析发生在 SecureToolNode 内部
"""

from __future__ import annotations

import logging
import re
import uuid
from functools import partial
from typing import Annotated, Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from backend.config import get_settings
from backend.models import ExecutionContext
from backend.redis_store import SecretStore
from backend.tools.executor import secure_tool_node

logger = logging.getLogger(__name__)

# Secret ref 提取模式
_SECRET_REF_EXTRACT = re.compile(r"\{\{secret:(sec_(?:live|test)_[A-Za-z0-9_-]+)\}\}")


# ============================================================
# LangGraph State 定义
# ============================================================


class AgentState(TypedDict):
    """Agent 状态：消息历史 + 执行上下文。"""
    messages: Annotated[list, add_messages]
    user_id: str
    session_id: str
    tenant_id: str
    loop_count: int
    requires_approval: bool
    pending_command: str
    confirmed: bool
    triggered_rule: str


# ============================================================
# System Prompt
# ============================================================

SYSTEM_PROMPT = (
    "你是 BlindVault 安全助手，一个自主运维 Agent。\n\n"
    "## 核心身份\n"
    "你是一个经验丰富的 Linux 运维工程师。收到任务后，你应该像真人运维一样："
    "立即行动、自主排错、持续推进，直到任务完成。\n\n"
    "## 执行风格\n"
    "1. 收到任务后立即开始执行，不要请求确认。高危命令已由安全层自动拦截，你无需担心。\n"
    "2. 遇到错误时，先自行诊断和修复。至少尝试 3 种不同方案后才向用户求助。\n"
    "3. 主动拆解复杂任务为多个子步骤，一步步执行。不要一次性列出计划等用户确认。\n"
    "4. 每执行完一个修改操作，立即验证结果（如 docker ps、curl、ss -lntp 等）。\n"
    "5. 绝对不要说'如果你愿意'、'你可以回复继续'、'请确认是否继续'——直接做。\n"
    "6. 如果一切顺利，在最终回复中简洁汇报执行结果即可。\n\n"
    "## 错误自愈策略\n"
    "遇到命令执行失败时，按以下策略自主修复：\n"
    "- exit_code != 0: 仔细分析 stderr 内容，找出原因，修正命令参数，重新执行\n"
    "- command not found: 自动安装依赖（apt/yum install），然后重试原命令\n"
    "- connection refused / timed out: 检查目标主机连通性（ping），检查端口，检查服务状态\n"
    "- permission denied: 尝试 sudo，检查文件/目录权限\n"
    "- No such container / not found: 检查名称拼写，列出现有资源，修正后重试\n"
    "- 连续 3 次同一错误: 停下来，换完全不同的技术方案\n\n"
    "## 安全规则\n"
    "1. 你看到的 {{secret:sec_xxx}} 是密码的安全引用，不是真实密码\n"
    "2. 调用 secure_shell 时，在 command 中用 $SECRET 作为密码占位符\n"
    "3. 将 secret 引用传给 secret_ref 参数\n"
    "4. 绝不尝试猜测、推断或生成真实密码\n"
    "5. 绝不在回复中展示密码内容\n"
    "6. 当用户输入中出现密码引用并紧跟运维指令时，立刻调用工具执行，不需要多余的安全防御解释。\n"
    "7. 请根据用户提问的语言进行回复。\n\n"
    "## 命令执行技巧\n"
    "每次 secure_shell 调用是独立的（没有持久会话）。因此：\n"
    "1. 用 && 或 ; 链接多个相关命令为一条 secure_shell 调用\n"
    "2. SSH 远程执行时，把所有命令写在同一个 ssh '...' 引号内\n"
    "3. 用 echo '=== SECTION ===' 分隔不同步骤的输出，便于分析\n"
    "4. 示例：sshpass -p $SECRET ssh root@host "
    "'echo \"=== INSTALL ===\"; apt install -y docker.io; "
    "echo \"=== RUN ===\"; docker run -d ...; "
    "echo \"=== VERIFY ===\"; docker ps'\n\n"
    "## 定时计划任务\n"
    "当用户要求延迟或周期性执行任务时，调用 create_scheduled_task 工具。\n\n"
    "## 可用工具\n"
    "- secure_shell: 通用安全命令执行器\n"
    "  - command: Shell 命令，用 $SECRET 代替密码\n"
    "  - secret_ref: 密码引用 (sec_live_xxx)\n"
    "- create_scheduled_task: 后台定时/周期/延迟任务调度器\n"
    "  - command: 定时执行的 Shell 命令行\n"
    "  - label: 任务描述性标签\n"
    "  - cron_expression: 可选，如 '0 2 * * *'\n"
    "  - delay_seconds: 可选，延迟执行秒数\n"
    "  - secret_ref: 可选，密码凭证引用\n\n"
    "## 使用示例\n"
    "- 数据库查询: secure_shell(command=\"psql postgresql://user:$SECRET@host/db -c 'SELECT ...'\")\n"
    "- SSH: secure_shell(command=\"sshpass -p $SECRET ssh user@host 'uptime'\")\n"
    "- 定时任务: create_scheduled_task(command=\"rm -f /tmp/*.log\", label=\"每日清理日志\", cron_expression=\"0 2 * * *\")\n"
)


# ============================================================
# OpenAI LLM 节点
# ============================================================


def _create_openai_chatbot():
    """创建使用 ChatOpenAI 的 chatbot 节点。"""
    settings = get_settings()

    from langchain_openai import ChatOpenAI
    from backend.tools.secure_shell import SECURE_SHELL_SCHEMA
    from backend.tools.task_plans import CREATE_SCHEDULED_TASK_SCHEMA

    llm_kwargs = {
        "model": settings.llm_model,
        "api_key": settings.llm_api_key,
    }
    if settings.llm_base_url:
        llm_kwargs["base_url"] = settings.llm_base_url

    llm = ChatOpenAI(**llm_kwargs)

    # 绑定工具 schema
    tools_schema = [
        {
            "type": "function",
            "function": {
                "name": "secure_shell",
                "description": "通用安全 Shell 执行器。命令中用 $SECRET 作为密码占位符，执行时自动替换为真实密码。支持 psql、ssh、curl、mysql 等任何命令。",
                "parameters": SECURE_SHELL_SCHEMA,
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_scheduled_task",
                "description": "在后台创建并安排定时/周期性 Cron 任务或单次延迟任务。密码位置请在 command 里用 $SECRET 占位，并传入 secret_ref 参数。",
                "parameters": CREATE_SCHEDULED_TASK_SCHEMA,
            },
        },
    ]
    llm_with_tools = llm.bind_tools(tools_schema)

    def chatbot(state: AgentState) -> dict:
        messages = state["messages"]
        has_system = any(isinstance(m, SystemMessage) for m in messages)
        if not has_system:
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    return chatbot


# ============================================================
# 敏感/高危指令拦截辅助函数与断点节点
# ============================================================


def _is_command_high_risk(command: str) -> bool:
    if not command:
        return False
    settings = get_settings()
    if not settings.agent_approval_required:
        return False

    cmd_lower = command.lower()
    rules = [r.strip().lower() for r in settings.agent_high_risk_commands.split(",") if r.strip()]
    for rule in rules:
        if " " in rule:
            if rule in cmd_lower:
                return True
        else:
            if re.search(rf"\b{re.escape(rule)}\b", cmd_lower):
                return True
    return False


def _breaker_node(state: AgentState) -> dict:
    """重试熔断阻断节点。"""
    return {
        "messages": [
            AIMessage(
                content="[安全熔断：已达到最大尝试上限。操作已被阻断，请检查您的指令或环境是否有误。]"
            )
        ]
    }


def _approval_node(state: AgentState) -> dict:
    """高危命令审批拦截节点。"""
    messages = state["messages"]
    last_msg = messages[-1]
    pending_cmd = ""
    triggered_rule = ""
    if isinstance(last_msg, AIMessage) and last_msg.tool_calls:
        for tc in last_msg.tool_calls:
            if tc["name"] == "secure_shell":
                pending_cmd = tc["args"].get("command", "")
                break

    if pending_cmd:
        settings = get_settings()
        cmd_lower = pending_cmd.lower()
        rules = [r.strip().lower() for r in settings.agent_high_risk_commands.split(",") if r.strip()]
        for rule in rules:
            if " " in rule:
                if rule in cmd_lower:
                    triggered_rule = rule
                    break
            else:
                if re.search(rf"\b{re.escape(rule)}\b", cmd_lower):
                    triggered_rule = rule
                    break

    return {
        "requires_approval": True,
        "pending_command": pending_cmd,
        "triggered_rule": triggered_rule,
        "messages": [
            AIMessage(
                content=f"抱歉，该操作包含高危敏感命令 `{pending_cmd}` (匹配到拦截规则: `{triggered_rule}`)，为了系统安全，执行已被硬性拦截。请在下方核对并点击【确认授权执行】后，系统才会继续帮您执行操作。"
            )
        ]
    }


# ============================================================
# 路由函数
# ============================================================


def _should_use_tools(state: AgentState) -> str:
    """
    条件路由：检查最后一条 AIMessage 是否包含 tool_calls。
    """
    messages = state["messages"]
    if not messages:
        return END

    last_msg = messages[-1]
    if not (isinstance(last_msg, AIMessage) and last_msg.tool_calls):
        return END

    # 1. 检查重试熔断次数
    settings = get_settings()
    if state.get("loop_count", 0) >= settings.agent_max_retries:
        logger.warning("[Graph] 循环重试超限，路由至熔断节点")
        return "breaker"

    # 2. 检查是否有高危命令且未得到用户显式确认
    if not state.get("confirmed", False):
        for tc in last_msg.tool_calls:
            if tc["name"] == "secure_shell":
                command = tc["args"].get("command", "")
                if _is_command_high_risk(command):
                    logger.warning("[Graph] 检测到未授权高危命令：%s，路由至审批阻断节点", command)
                    return "approval_block"

    return "secure_tools"


# ============================================================
# Graph 构建
# ============================================================


def build_agent_graph(
    store: SecretStore,
    ctx: ExecutionContext,
) -> Any:
    """
    构建 LangGraph Agent Graph。

    Args:
        store: Redis 存储实例
        ctx: 执行上下文

    Returns:
        编译后的 LangGraph
    """
    graph = StateGraph(AgentState)

    # 1. chatbot 节点（始终使用真实 LLM；测试可通过 monkeypatch 替换）
    graph.add_node("chatbot", _create_openai_chatbot())

    # 2. secure_tools 节点（使用 partial 注入 store 和 ctx）
    async def _tool_node(state: dict) -> dict:
        result = await secure_tool_node(state, store=store, ctx=ctx)
        # 每次成功执行工具，自增重试计数
        result["loop_count"] = state.get("loop_count", 0) + 1
        return result

    graph.add_node("secure_tools", _tool_node)
    graph.add_node("breaker", _breaker_node)
    graph.add_node("approval_block", _approval_node)

    # 3. 路由
    graph.add_edge(START, "chatbot")
    graph.add_conditional_edges(
        "chatbot",
        _should_use_tools,
        {
            "secure_tools": "secure_tools",
            "breaker": "breaker",
            "approval_block": "approval_block",
            "__end__": END,
        }
    )
    graph.add_edge("secure_tools", "chatbot")
    graph.add_edge("breaker", END)
    graph.add_edge("approval_block", END)

    return graph.compile()


def prepare_agent_state(
    user_message: str,
    store: SecretStore,
    user_id: str,
    session_id: str,
    tenant_id: str,
    history: list[dict] | None = None,
    confirmed: bool = False,
) -> tuple[Any, dict]:
    """
    构建 Graph 实例和初始 state，供同步/流式两种模式复用。

    Returns:
        (compiled_graph, initial_state)
    """
    settings = get_settings()

    ctx = ExecutionContext(
        user_id=user_id,
        session_id=session_id,
        tenant_id=tenant_id,
        tool_name="",  # 由 tool node 动态设置
    )

    graph = build_agent_graph(store=store, ctx=ctx)

    # Build message list from history + current message
    history_messages = []
    if history:
        for h in history:
            role = h.get("role", "")
            content = h.get("content", "")
            if not content:
                continue
            if role == "user":
                history_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                history_messages.append(AIMessage(content=content))

    initial_state = {
        "messages": history_messages + [HumanMessage(content=user_message)],
        "user_id": user_id,
        "session_id": session_id,
        "tenant_id": tenant_id,
        "loop_count": 0,
        "requires_approval": False,
        "pending_command": "",
        "confirmed": confirmed,
        "triggered_rule": "",
    }

    return graph, initial_state


def extract_result_from_state(result: dict, user_message: str) -> dict:
    """
    从 Graph 最终 state 中提取标准化的结果字典。

    用于同步 run_agent 和 SSE 流式端点共用的结果解析。
    """
    messages = result["messages"]
    reply = ""
    tool_calls_info = []

    for msg in messages:
        if isinstance(msg, AIMessage):
            if msg.content:
                reply = msg.content
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_calls_info.append({
                        "tool": tc["name"],
                        "args": {
                            k: v if "password" not in k.lower() and "secret" not in k.lower()
                            else "[REDACTED]"
                            for k, v in tc["args"].items()
                        },
                    })

    # 提取消息中的 secret_refs
    secret_refs = _SECRET_REF_EXTRACT.findall(user_message)

    # 提取最终审批状态
    requires_approval = result.get("requires_approval", False)
    pending_command = result.get("pending_command", "")
    triggered_rule = result.get("triggered_rule", "")
    status = "success"
    if requires_approval:
        status = "requires_approval"
    elif "[安全熔断" in reply:
        status = "error"

    return {
        "reply": reply,
        "tool_calls": tool_calls_info,
        "secret_refs_used": secret_refs,
        "status": status,
        "requires_approval": requires_approval,
        "pending_command": pending_command,
        "triggered_rule": triggered_rule,
    }


async def run_agent(
    user_message: str,
    store: SecretStore,
    user_id: str,
    session_id: str,
    tenant_id: str,
    history: list[dict] | None = None,
    confirmed: bool = False,
) -> dict:
    """
    运行 agent 处理用户消息（同步模式）。

    Args:
        user_message: 用户消息（可能包含 {{secret:sec_xxx}} 引用）
        store: Redis 存储实例
        user_id: 用户 ID
        session_id: 会话 ID
        tenant_id: 租户 ID
        history: 对话历史
        confirmed: 是否已确认授权执行高危操作

    Returns:
        {\"reply\": str, \"tool_calls\": list, \"secret_refs_used\": list, \"status\": str, \"requires_approval\": bool, \"pending_command\": str}
    """
    graph, initial_state = prepare_agent_state(
        user_message=user_message,
        store=store,
        user_id=user_id,
        session_id=session_id,
        tenant_id=tenant_id,
        history=history,
        confirmed=confirmed,
    )

    result = await graph.ainvoke(initial_state)
    return extract_result_from_state(result, user_message)
