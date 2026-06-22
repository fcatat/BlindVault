"""
BlindVault Agent 核心模块

提供 create_blindvault_agent() 工厂函数，基于 LangChain create_agent 构建安全运维 Agent。
提供 BlindVaultAgent 包装类，用于入口层预脱敏（拦截 S3 泄露）与运行时依赖注入。
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict, List, Optional, Union

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, convert_to_messages
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.redis import RedisSaver

from blindvault_agent.config import AgentSettings, get_agent_settings
from blindvault_agent.security.models import ExecutionContext
from blindvault_agent.security.redis_store import SecretStore
from blindvault_agent.middleware.reversible_sanitize import ReversibleSanitizeMiddleware, make_sync_save_record
from blindvault_agent.tools.secure_shell import secure_shell

import contextvars

# 定义上下文变量以安全传播运行时依赖，解决重跑时 config 丢失问题
current_store = contextvars.ContextVar("current_store", default=None)
current_ctx = contextvars.ContextVar("current_ctx", default=None)
current_executor = contextvars.ContextVar("current_executor", default=None)

logger = logging.getLogger(__name__)


class BlindVaultAgent:
    """BlindVault Agent 包装器。

    在入口层对输入进行预脱敏（防止明文密码进入 Graph State 造成 S3 Checkpoint 泄露），
    并在工具执行的瞬间，通过配置注入 store、ctx 和 executor，不污染序列化状态。
    """

    def __init__(
        self,
        agent_graph: Any,
        sanitize_mw: ReversibleSanitizeMiddleware,
        store: SecretStore,
        default_executor: Any = None,
    ):
        self.agent_graph = agent_graph
        self.sanitize_mw = sanitize_mw
        self.store = store
        self.default_executor = default_executor

    def _pre_sanitize(self, input_val: Any) -> Any:
        """在入口层对输入进行敏感凭据预脱敏，直接加密保存至 Redis 金库。"""
        if isinstance(input_val, dict) and "messages" in input_val:
            try:
                msgs = convert_to_messages(input_val["messages"])
                state = {"messages": msgs}
                res = self.sanitize_mw.before_model(state)
                if res and "messages" in res:
                    input_val = dict(input_val)
                    input_val["messages"] = res["messages"]
            except Exception as e:
                logger.error("预脱敏 input messages 失败: %s", e)
        elif isinstance(input_val, (list, tuple)):
            try:
                msgs = convert_to_messages(input_val)
                state = {"messages": msgs}
                res = self.sanitize_mw.before_model(state)
                if res and "messages" in res:
                    input_val = res["messages"]
            except Exception as e:
                logger.error("预脱敏 input list 失败: %s", e)
        elif isinstance(input_val, str):
            try:
                msgs = [HumanMessage(content=input_val)]
                state = {"messages": msgs}
                res = self.sanitize_mw.before_model(state)
                if res and "messages" in res:
                    input_val = res["messages"][0].content
            except Exception as e:
                logger.error("预脱敏 input str 失败: %s", e)
        return input_val

    def _inject_configurable(self, config: dict | None) -> dict:
        """动态注入运行时配置，不将其序列化到 Checkpoint 中。"""
        config = config or {}
        if "configurable" not in config:
            config["configurable"] = {}

        configurable = config["configurable"]
        configurable["store"] = self.store

        user_id = configurable.get("user_id", "system")
        session_id = configurable.get("session_id", configurable.get("thread_id", "session_default"))
        tenant_id = configurable.get("tenant_id", "default")

        if "ctx" not in configurable:
            configurable["ctx"] = ExecutionContext(
                user_id=user_id,
                session_id=session_id,
                tenant_id=tenant_id,
                tool_name="secure_shell",
            )

        if "executor" not in configurable and self.default_executor:
            configurable["executor"] = self.default_executor

        return config

    def invoke(self, input: Any, config: dict | None = None, **kwargs) -> Any:
        input = self._pre_sanitize(input)
        config = self._inject_configurable(config)

        t_store = self.store
        t_executor = self.default_executor or config.get("configurable", {}).get("executor")
        t_ctx = config.get("configurable", {}).get("ctx")

        token_store = current_store.set(t_store)
        token_ctx = current_ctx.set(t_ctx)
        token_exec = current_executor.set(t_executor)

        try:
            return self.agent_graph.invoke(input, config, **kwargs)
        finally:
            current_store.reset(token_store)
            current_ctx.reset(token_ctx)
            current_executor.reset(token_exec)

    def stream(self, input: Any, config: dict | None = None, **kwargs) -> Any:
        input = self._pre_sanitize(input)
        config = self._inject_configurable(config)

        t_store = self.store
        t_executor = self.default_executor or config.get("configurable", {}).get("executor")
        t_ctx = config.get("configurable", {}).get("ctx")

        token_store = current_store.set(t_store)
        token_ctx = current_ctx.set(t_ctx)
        token_exec = current_executor.set(t_executor)

        try:
            for chunk in self.agent_graph.stream(input, config, **kwargs):
                yield chunk
        finally:
            current_store.reset(token_store)
            current_ctx.reset(token_ctx)
            current_executor.reset(token_exec)

    async def ainvoke(self, input: Any, config: dict | None = None, **kwargs) -> Any:
        input = self._pre_sanitize(input)
        config = self._inject_configurable(config)

        t_store = self.store
        t_executor = self.default_executor or config.get("configurable", {}).get("executor")
        t_ctx = config.get("configurable", {}).get("ctx")

        token_store = current_store.set(t_store)
        token_ctx = current_ctx.set(t_ctx)
        token_exec = current_executor.set(t_executor)

        try:
            return await self.agent_graph.ainvoke(input, config, **kwargs)
        finally:
            current_store.reset(token_store)
            current_ctx.reset(token_ctx)
            current_executor.reset(token_exec)

    async def astream(self, input: Any, config: dict | None = None, **kwargs) -> AsyncIterator[Any]:
        input = self._pre_sanitize(input)
        config = self._inject_configurable(config)

        t_store = self.store
        t_executor = self.default_executor or config.get("configurable", {}).get("executor")
        t_ctx = config.get("configurable", {}).get("ctx")

        token_store = current_store.set(t_store)
        token_ctx = current_ctx.set(t_ctx)
        token_exec = current_executor.set(t_executor)

        try:
            async for chunk in self.agent_graph.astream(input, config, **kwargs):
                yield chunk
        finally:
            current_store.reset(token_store)
            current_ctx.reset(token_ctx)
            current_executor.reset(token_exec)

    async def astream_events(self, input: Any, config: dict | None = None, *, skip_pre_sanitize: bool = False, **kwargs) -> AsyncIterator[Any]:
        if not skip_pre_sanitize:
            input = self._pre_sanitize(input)
        config = self._inject_configurable(config)

        t_store = self.store
        t_executor = self.default_executor or config.get("configurable", {}).get("executor")
        t_ctx = config.get("configurable", {}).get("ctx")

        token_store = current_store.set(t_store)
        token_ctx = current_ctx.set(t_ctx)
        token_exec = current_executor.set(t_executor)

        try:
            async for event in self.agent_graph.astream_events(input, config, **kwargs):
                yield event
        finally:
            current_store.reset(token_store)
            current_ctx.reset(token_ctx)
            current_executor.reset(token_exec)


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


def create_blindvault_agent(
    settings: AgentSettings | None = None,
    model: str | None = None,
    tools: list | None = None,
    middleware: list | None = None,
    store: SecretStore | None = None,
    checkpointer: Any | None = None,
    executor: Any | None = None,
    system_prompt: str | None = None,
) -> BlindVaultAgent:
    """创建 BlindVault 安全运维 Agent。

    Args:
        settings: Agent 配置，默认从环境变量加载。
        model: 模型别名（覆盖配置中的 default_model）。
        tools: 工具列表（默认包含 secure_shell）。
        middleware: 中间件列表（默认包含拦截点 A 可逆脱敏与 PII 兜底）。
        store: 自定义金库存储（可选）。
        checkpointer: 自定义 checkpointer（可选）。
        executor: 默认注入的 shell 执行器（可选）。

    Returns:
        包裹后的 BlindVaultAgent 实例。
    """
    if settings is None:
        settings = get_agent_settings()

    if model:
        settings = settings.model_copy(update={"default_model": model})

    # 初始化 Redis 金库连接
    if store is None:
        from redis.asyncio import Redis as AsyncRedis
        redis_client = AsyncRedis.from_url(settings.redis_url, decode_responses=True)
        store = SecretStore(redis_client)

    # 1. 实例化可逆脱敏与 PII 兜底中间件
    from blindvault_agent.middleware.reversible_sanitize import make_sync_load_rules
    save_record_sync = make_sync_save_record(store)
    load_rules_sync = make_sync_load_rules(store._redis, store._prefix)
    
    from blindvault_agent.security.config import get_settings as get_security_settings
    security_settings = get_security_settings()
    sanitize_mw = ReversibleSanitizeMiddleware(
        save_record=save_record_sync,
        encryption_key=security_settings.encryption_key_bytes,
        load_rules=load_rules_sync,
    )

    # 2. 组装中间件顺序：[ReversibleSanitize]
    active_middleware = [sanitize_mw]
    if middleware:
        active_middleware.extend(middleware)

    # 3. 默认工具为 secure_shell 和 record_plan
    from blindvault_agent.tools.planning import record_plan
    active_tools = tools if tools is not None else [secure_shell, record_plan]

    # 4. 创建 LLM 和 checkpointer
    llm = _create_llm(settings)
    if checkpointer is None:
        checkpointer = _create_checkpointer(settings)

    # 5. 构建 LangGraph 编译图
    agent_graph = create_agent(
        model=llm,
        tools=active_tools,
        checkpointer=checkpointer,
        middleware=active_middleware,
        system_prompt=system_prompt or settings.system_prompt,
    )

    logger.info(
        "BlindVault Agent 已构建：model=%s, tools=%d, middleware=%d",
        settings.default_model,
        len(active_tools),
        len(active_middleware),
    )

    return BlindVaultAgent(
        agent_graph=agent_graph,
        sanitize_mw=sanitize_mw,
        store=store,
        default_executor=executor,
    )
