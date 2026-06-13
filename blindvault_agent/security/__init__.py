"""
BlindVault Agent 安全资产模块

从 backend/ 原样迁入的安全核心组件（#15 任务）：
- crypto.py — AES-256-GCM 加解密
- policy.py — resolve_secret 9 步校验
- redis_store.py — Redis 金库操作
- models.py — 数据模型
- config.py — 安全配置（含 encryption_key）

🔴 安全关键代码，迁移需 review 确认：仅调 import 路径，不改任何逻辑。
"""

from blindvault_agent.security.crypto import encrypt, decrypt
from blindvault_agent.security.policy import resolve_secret, SecretResolutionError
from blindvault_agent.security.redis_store import SecretStore, get_store, get_redis_client
from blindvault_agent.security.models import (
    SecretRecord,
    SecretStatus,
    SecretType,
    ExecutionContext,
    ResolveRequest,
    CreateSecretRequest,
    SecretResponse,
)

__all__ = [
    "encrypt",
    "decrypt",
    "resolve_secret",
    "SecretResolutionError",
    "SecretStore",
    "get_store",
    "get_redis_client",
    "SecretRecord",
    "SecretStatus",
    "SecretType",
    "ExecutionContext",
    "ResolveRequest",
    "CreateSecretRequest",
    "SecretResponse",
]
