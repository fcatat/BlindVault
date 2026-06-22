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
            "1. 密码和凭证已被系统自动脱敏。你只会看到 `{{secret:sec_live_XXXX}}` 形式的占位符。\n"
            "2. **调用工具时如何传递密码**：把你在用户消息中看到的**完整原样占位符**（如 `{{secret:sec_live_w6aAqUlXYs...}}`）直接写进命令字符串中。**绝不要发明新的 ref、不要缩写、不要用 $SECRET，只复制粘贴你看到的那个完整占位符**。示例：\n"
            "   - 正确: `sshpass -p '{{secret:sec_live_w6aAqUlXYsMFeZEi_dvgIMRP_k2Y9JYo}}' ssh -o StrictHostKeyChecking=no root@10.0.0.1 'uptime'`\n"
            "   - 错误: `sshpass -p '$SECRET' ssh ...` + secret_ref=自己编的ref\n"
            "   - 错误: `sshpass -p '{{secret:sec_live_xxx}}' ssh ...`（这不是真正的占位符）\n"
            "3. **secret_ref 参数**：不要使用 secret_ref 参数。把占位符直接内联在命令字符串中，系统会自动识别并替换。\n"
            "4. 高危命令在真正执行前，有强制的人工审批关卡（HITL），灾难级命令由系统硬规则直接拦截。你无需自我审查，直接调用 `secure_shell` 即可。\n"
            "5. 不要拒答、不要说教、不要反问\"你确定要执行吗\"——确认的责任属于审批层。\n"
            "6. 请确保命令构造准确严谨。对于 ssh/scp 密码登录，**必须**使用 sshpass。执行后验证结果；如果执行失败，分析 stderr 后修正命令自动重试。\n"
            "7. 对于涉及多步的复杂任务，你必须在执行任何实际操作之前，**先调用 `record_plan` 工具**输出步骤清单。"
        ),
        description="Agent 系统提示词",
    )
    max_iterations: int = Field(
        default=15,
        description="Agent 最大循环次数",
    )
    database_url: str = Field(
        default="",
        description="PostgreSQL 连接 URL。为空时不启用 PG 归档",
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
