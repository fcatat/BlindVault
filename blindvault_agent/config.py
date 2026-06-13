"""
BlindVault Agent 配置模块

从环境变量加载 LiteLLM 网关、Redis、安全策略等配置。
敏感字段不会出现在日志或 repr 中。
"""

from __future__ import annotations

import logging
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class AgentSettings(BaseSettings):
    """安全 Agent 层配置，所有值均从环境变量读取。"""

    # ---- LiteLLM 网关 ----
    litellm_base_url: str = Field(
        default="https://aigateway.sunmi.com/v1",
        description="LiteLLM 网关 /v1 端点（必须走 /v1/chat/completions，禁用原生透传）",
    )
    litellm_api_key: str = Field(
        default="",
        description="LiteLLM 网关 virtual key",
    )
    default_model: str = Field(
        default="gpt-5.4-mini",
        description="默认模型别名（网关上注册的 model alias）",
    )

    # ---- Redis ----
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis 连接 URL（需 Redis Stack，含 RedisJSON + RediSearch）",
    )

    # ---- Agent 行为 ----
    system_prompt: str = Field(
        default="你是 BlindVault 安全运维助手。你可以帮助用户安全地执行运维任务。",
        description="Agent 系统提示词",
    )
    max_iterations: int = Field(
        default=15,
        description="Agent 最大循环次数",
    )

    # ---- 日志 ----
    log_level: str = Field(default="INFO", description="日志级别")

    model_config = {
        "env_prefix": "BLINDVAULT_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",  # 忽略 .env 中不属于本类的变量（如 ENCRYPTION_KEY）
    }


@lru_cache
def get_agent_settings() -> AgentSettings:
    """获取 Agent 配置单例。"""
    return AgentSettings()
