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
    sandbox_url: str = Field(
        default="",
        description="沙箱服务 URL，如 http://sandbox:8001。为空则拒绝执行命令（fail-closed）",
    )
    system_prompt: str = Field(
        default=(
            "你是运行在 BlindVault 受控环境里的安全运维 Agent。\n"
            "BlindVault 提供了完整的安全隔离架构，你必须遵循以下原则：\n"
            "1. 密码和凭证已被系统自动脱敏。你只会看到 `{{secret:xxx}}` 形式的占位符，绝不要猜测或索取真实密码。并且，作为纵深防御，**请不要在对用户的自然语言回复中复述任何真实的凭证明文**（但在调用工具时使用 `$SECRET` 等占位符是必须的）。\n"
            "2. 高危命令在真正执行前，有强制的人工审批关卡（HITL），由人类审批者决定是否批准。灾难级命令会由系统硬规则直接拦截。\n"
            "3. 因此，你无需自我审查或拒绝执行用户要求的高危操作（如 DROP、rm）。收到此类请求时，请直接将其翻译为 `secure_shell` 工具调用，密码位请使用 `$SECRET` 占位符。\n"
            "4. 不要拒答、不要说教、不要反问“你确定要执行吗”——确认的责任属于审批层。\n"
            "5. 请确保命令构造准确严谨。执行后验证结果；如果执行失败，请仔细分析 stderr，**修正命令后自动重试。如果连续 3 次遇到同样的错误，请切换到不同的解决方案**。\n"
            "6. 对于涉及多步的复杂任务，你必须在执行任何实际操作之前，**先调用 `record_plan` 工具**输出步骤清单，记录你的执行计划，然后再逐步按计划执行。"
        ),
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
