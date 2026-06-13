"""
BlindVault 配置模块

使用 pydantic-settings 从环境变量加载配置。
敏感字段（encryption_key、llm_api_key）不会出现在日志或 repr 中。
"""

from __future__ import annotations

import base64
import logging
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """应用全局配置，所有值均从环境变量读取。"""

    # ---- 加密 ----
    blindvault_encryption_key: str = ""  # base64 编码的 32 字节密钥

    # ---- Redis ----
    redis_url: str = "redis://localhost:6379/0"
    redis_key_prefix: str = "blindvault:"

    # ---- LLM ----
    llm_provider: str = "openai"  # openai (固定，已不再支持 mock)
    llm_model: str = "gpt-4o"
    llm_api_key: str = ""
    llm_base_url: str = ""

    # ---- PostgreSQL ----
    database_url: str = "postgresql://opssession:opssession@127.0.0.1:5433/blindvault"

    # ---- 诊断沙箱 ----
    sandbox_url: str = "http://sandbox:8001"

    # ---- 企业版：本地模型网关 ----
    local_model_url: str = ""         # Ollama 服务地址，如 http://mac-mini:11434（留空表示不启用）
    local_model_name: str = "qwen3:0.6b"  # 模型名称
    local_model_timeout: float = 2.0  # 推理超时（秒），超时自动降级为正则
    local_model_api_type: str = "ollama"  # ollama | openai | custom_fastapi
    local_model_prompt: str = ""      # 自定义 System Prompt，留空则采用内置默认
    local_model_disable_cot: bool = True  # 是否强制禁用 CoT 思考链以提高实时性

    # ---- 运行与安全决策 ----
    agent_max_retries: int = 15
    agent_high_risk_commands: str = "rm,mv,reboot,shutdown,poweroff,halt,init,systemctl stop,service stop,docker stop,docker rm,docker kill,docker rmi,docker system prune,kill,killall,pkill,iptables -F,ufw disable,drop database,drop table,truncate,delete from"
    agent_approval_required: bool = True


    # ---- 应用 ----
    log_level: str = "INFO"
    allowed_origins: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @field_validator("blindvault_encryption_key")
    @classmethod
    def _validate_encryption_key(cls, v: str) -> str:
        if not v:
            # 开发/测试模式下自动生成临时密钥（生产环境禁止）
            import os

            logger.warning(
                "BLINDVAULT_ENCRYPTION_KEY 未设置，已自动生成临时密钥。"
                "⚠️ 仅限开发环境使用，生产环境必须设置环境变量！"
            )
            return base64.urlsafe_b64encode(os.urandom(32)).decode()
        return v

    @property
    def encryption_key_bytes(self) -> bytes:
        """解码 base64 密钥为 32 字节 bytes。"""
        raw = base64.urlsafe_b64decode(self.blindvault_encryption_key)
        if len(raw) != 32:
            raise ValueError(
                f"ENCRYPTION_KEY 解码后必须为 32 字节，实际为 {len(raw)} 字节"
            )
        return raw


@lru_cache
def get_settings() -> Settings:
    """获取全局配置单例。"""
    return Settings()


def reload_settings(updated: Settings | None = None) -> Settings:
    """
    重载配置：清除 LRU 缓存并设置新实例。

    用于运行时动态更新配置（如前端修改 LLM 参数后）。

    Args:
        updated: 已修改的 Settings 实例。如果为 None，从环境变量重新加载。

    Returns:
        新的 Settings 实例
    """
    get_settings.cache_clear()
    if updated is not None:
        # 将 updated 实例注入缓存
        @lru_cache
        def _cached() -> Settings:
            return updated

        # 替换全局 get_settings
        import blindvault_agent.security.config as _module
        _module.get_settings = _cached
        return updated
    return get_settings()
