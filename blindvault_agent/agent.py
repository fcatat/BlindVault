"""
BlindVault Agent 核心模块

提供 create_blindvault_agent() 工厂函数，基于 LangChain create_agent 构建安全运维 Agent。
后续 Phase 1 会逐步叠加：
- 可逆脱敏 middleware（拦截点 A）
- PII 兜底 middleware（拦截点 A 兜底）
- secure_shell 工具（拦截点 B 注入）
- HITL 审批 middleware（拦截点 B 审批）
"""

from __future__ import annotations

import logging
from typing import Any

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.checkpoint.redis import RedisSaver

from blindvault_agent.config import AgentSettings, get_agent_settings

logger = logging.getLogger(__name__)


def _create_llm(settings: AgentSettings) -> ChatOpenAI:
    """创建指向 LiteLLM 网关的 LLM 实例。

    所有模型（GPT/Claude/自托管）统一经 LiteLLM 网关的 /v1/chat/completions 路由。
    安全铁律：guardrail 只在翻译层生效，禁用原生透传。
    """
    return ChatOpenAI(
        model=settings.default_model,
        base_url=settings.litellm_base_url,
        api_key=settings.litellm_api_key,
        temperature=0,
    )


def _create_checkpointer(settings: AgentSettings) -> Any:
    """创建 Redis checkpointer 用于 HITL 审批暂停-恢复。

    需要 Redis Stack（含 RedisJSON + RediSearch 模块）。
    """
    ctx = RedisSaver.from_conn_string(settings.redis_url)
    checkpointer = ctx.__enter__()
    checkpointer.setup()
    return checkpointer


# ---- 占位工具（骨架阶段，后续替换为 secure_shell 等）----
@tool
def echo(text: str) -> str:
    """原样返回输入文本。这是工程骨架的占位工具，后续会替换为 secure_shell。"""
    return f"Echo: {text}"


def create_blindvault_agent(
    settings: AgentSettings | None = None,
    model: str | None = None,
    tools: list | None = None,
    middleware: list | None = None,
):
    """创建 BlindVault 安全运维 Agent。

    Args:
        settings: Agent 配置，默认从环境变量加载。
        model: 模型别名（覆盖配置中的 default_model）。
        tools: 工具列表（默认使用占位工具）。
        middleware: middleware 列表（后续叠加脱敏/HITL）。

    Returns:
        可 invoke 的 agent 实例。
    """
    if settings is None:
        settings = get_agent_settings()

    if model:
        settings = settings.model_copy(update={"default_model": model})

    llm = _create_llm(settings)
    checkpointer = _create_checkpointer(settings)

    agent = create_agent(
        model=llm,
        tools=tools or [echo],
        checkpointer=checkpointer,
        middleware=middleware or [],
        system_prompt=settings.system_prompt,
    )

    logger.info(
        "BlindVault Agent 已创建：model=%s, gateway=%s, tools=%d, middleware=%d",
        settings.default_model,
        settings.litellm_base_url,
        len(tools or [echo]),
        len(middleware or []),
    )

    return agent
