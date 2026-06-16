from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class LocalModelSettings(BaseSettings):
    local_model_url: str = ""
    local_model_name: str = "qwen3:0.6b"
    local_model_api_type: str = "ollama"
    local_model_timeout: float = 2.0
    local_model_prompt: str = ""
    local_model_disable_cot: bool = True

    model_config = SettingsConfigDict(
        env_prefix="BLINDVAULT_",
        env_file=".env",
        extra="ignore",
    )

@lru_cache
def get_local_model_settings() -> LocalModelSettings:
    return LocalModelSettings()
