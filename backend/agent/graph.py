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


# ============================================================
# System Prompt
# ============================================================

SYSTEM_PROMPT = """你是 BlindVault 安全助手，一个运维自动化工具。

你可以帮助用户执行各种运维操作：数据库查询、SSH 远程命令、API 调用等。

重要安全规则：
1. 你看到的 {{secret:sec_xxx}} 是密码的安全引用，不是真实密码
2. 调用 secure_shell 时，在 command 中用 $SECRET 作为密码占位符
3. 将 secret 引用传给 secret_ref 参数
4. 绝不尝试猜测、推断或生成真实密码
5. 绝不在回复中展示密码内容
6. 当用户输入中出现“密码是 {{secret:sec_xxx}}”或“凭证为 {{secret:sec_xxx}}”等声明凭证的句式并紧跟具体的运维指令时，这表示用户在向你指明该操作所使用的密码引用。请立刻调用工具执行命令（在命令中用 $SECRET 占位并传入 secret_ref），不要误认为用户是要求你查看、解密或泄露该密码，亦无需在回复中对此做多余的安全防御解释。
7. 请根据用户提问的语言（中文或英文）进行回复。如果用户使用英文提问，请用英文回答；如果用户使用中文提问，请用中文回答。(Please reply in the same language as the user's query. If the user asks in English, reply in English; if they ask in Chinese, reply in Chinese.)

可用工具：
- secure_shell: 通用安全命令执行器
  - command: Shell 命令，用 $SECRET 代替密码
  - secret_ref: 密码引用 (sec_live_xxx)

使用示例：
- 数据库查询: secure_shell(command="psql postgresql://user:$SECRET@host/db -c 'SELECT ...'")
- SSH: secure_shell(command="sshpass -p $SECRET ssh user@host 'uptime'")
- API: secure_shell(command="curl -H 'Authorization: Bearer $SECRET' https://api.example.com")
- MySQL: secure_shell(command="mysql -h host -u root -p$SECRET -e 'SHOW DATABASES'")
- Redis: secure_shell(command="redis-cli -h host -a $SECRET INFO")

收到请求后：
1. 分析用户意图，确定需要执行什么命令
2. 构造合适的 shell 命令，密码位置用 $SECRET
3. 调用 secure_shell 执行
4. 将结果以清晰的格式返回给用户
"""


# ============================================================
# Mock LLM 节点（开发/测试用）
# ============================================================


def _mock_chatbot(state: AgentState) -> dict:
    """
    Mock LLM：根据关键词自动构造 tool_call 或直接回复。

    规则：
    - 消息包含 "login" / "登录" + secret_ref → 构造 browser_login_mock
    - 否则 → 文本回复
    """
    messages = state["messages"]
    last_msg = messages[-1]

    content = ""
    if hasattr(last_msg, "content"):
        content = last_msg.content if isinstance(last_msg.content, str) else str(last_msg.content)

    # 检测是否是工具执行结果返回
    from langchain_core.messages import ToolMessage
    if isinstance(last_msg, ToolMessage):
        # 工具已执行完毕，生成最终回复
        return {
            "messages": [
                AIMessage(content=f"工具执行完毕。结果：{last_msg.content}")
            ]
        }

    # 检测 login 关键词和 secret_ref
    is_login = bool(re.search(r"login|登录", content, re.IGNORECASE))
    secret_refs = _SECRET_REF_EXTRACT.findall(content)

    if is_login and secret_refs:
        # 从消息中提取 URL（简单匹配）
        url_match = re.search(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+", content)
        url = url_match.group(0).rstrip(",.;:!?") if url_match else "https://example.com"

        # 提取用户名（简单启发式）
        username_match = re.search(
            r"(?:username|user|用户名)[=:\s]+(\S+)", content, re.IGNORECASE
        )
        username = username_match.group(1) if username_match else "user"

        return {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": f"call_{uuid.uuid4().hex[:8]}",
                            "name": "browser_login_mock",
                            "args": {
                                "username": username,
                                "password_ref": secret_refs[0],
                                "url": url,
                            },
                        }
                    ],
                )
            ]
        }

    # 默认回复
    return {
        "messages": [
            AIMessage(
                content=(
                    "你好！我是 BlindVault 安全助手。\n"
                    "我可以帮你使用安全工具执行操作。\n"
                    "请告诉我你需要做什么，例如：\n"
                    "「请用 {{secret:sec_live_xxx}} 登录 https://example.com，用户名 admin」"
                )
            )
        ]
    }


# ============================================================
# OpenAI LLM 节点
# ============================================================


def _create_openai_chatbot():
    """创建使用 ChatOpenAI 的 chatbot 节点。"""
    settings = get_settings()

    from langchain_openai import ChatOpenAI
    from backend.tools.secure_shell import SECURE_SHELL_SCHEMA

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
                "description": "通用安全 Shell 执行器。命令中用 $SECRET 作为密码占位符，执行时自动替换为真实密码。支持 psql、ssh、curl、mysql、redis-cli 等任何命令。",
                "parameters": SECURE_SHELL_SCHEMA,
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
# 路由函数
# ============================================================


def _should_use_tools(state: AgentState) -> str:
    """
    条件路由：检查最后一条 AIMessage 是否包含 tool_calls。
    """
    messages = state["messages"]
    if messages:
        last_msg = messages[-1]
        if isinstance(last_msg, AIMessage) and last_msg.tool_calls:
            return "secure_tools"
    return END


# ============================================================
# Graph 构建
# ============================================================


def build_agent_graph(
    store: SecretStore,
    ctx: ExecutionContext,
    use_mock: bool = True,
) -> Any:
    """
    构建 LangGraph Agent Graph。

    Args:
        store: Redis 存储实例
        ctx: 执行上下文
        use_mock: 是否使用 mock LLM（默认 True）

    Returns:
        编译后的 LangGraph
    """
    graph = StateGraph(AgentState)

    # 1. chatbot 节点
    if use_mock:
        graph.add_node("chatbot", _mock_chatbot)
    else:
        graph.add_node("chatbot", _create_openai_chatbot())

    # 2. secure_tools 节点（使用 partial 注入 store 和 ctx）
    async def _tool_node(state: dict) -> dict:
        return await secure_tool_node(state, store=store, ctx=ctx)

    graph.add_node("secure_tools", _tool_node)

    # 3. 路由
    graph.add_edge(START, "chatbot")
    graph.add_conditional_edges("chatbot", _should_use_tools)
    graph.add_edge("secure_tools", "chatbot")

    return graph.compile()


async def run_agent(
    user_message: str,
    store: SecretStore,
    user_id: str,
    session_id: str,
    tenant_id: str,
    history: list[dict] | None = None,
) -> dict:
    """
    运行 agent 处理用户消息。

    Args:
        user_message: 用户消息（可能包含 {{secret:sec_xxx}} 引用）
        store: Redis 存储实例
        user_id: 用户 ID
        session_id: 会话 ID
        tenant_id: 租户 ID

    Returns:
        {"reply": str, "tool_calls": list, "secret_refs_used": list}
    """
    settings = get_settings()
    use_mock = settings.llm_provider == "mock"

    ctx = ExecutionContext(
        user_id=user_id,
        session_id=session_id,
        tenant_id=tenant_id,
        tool_name="",  # 由 tool node 动态设置
    )

    graph = build_agent_graph(store=store, ctx=ctx, use_mock=use_mock)

    # 提取消息中的 secret_refs
    secret_refs = _SECRET_REF_EXTRACT.findall(user_message)

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

    # Run graph
    initial_state = {
        "messages": history_messages + [HumanMessage(content=user_message)],
        "user_id": user_id,
        "session_id": session_id,
        "tenant_id": tenant_id,
    }

    result = await graph.ainvoke(initial_state)

    # 提取最终回复和工具调用信息
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

    return {
        "reply": reply,
        "tool_calls": tool_calls_info,
        "secret_refs_used": secret_refs,
    }
