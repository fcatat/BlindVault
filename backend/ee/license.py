"""
BlindVault EE - License 管理模块

负责企业版 License 的解析、校验和生命周期管理。

License 格式规划（v1）：
- Base64 编码的 JSON Payload + RSA-2048 签名
- Payload 包含：customer_id, expires_at, max_users, features[]
- 签名使用 BlindVault 官方私钥生成，客户端使用内嵌公钥验证
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class LicenseInfo:
    """企业版 License 解析结果。"""
    customer_id: str = ""
    customer_name: str = ""
    edition: str = "community"  # community | enterprise | enterprise_plus
    expires_at: datetime | None = None
    max_users: int = 1
    features: list[str] = field(default_factory=list)
    is_valid: bool = False
    validation_error: str = ""

    @property
    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return datetime.now(timezone.utc) > self.expires_at

    @property
    def days_remaining(self) -> int:
        if self.expires_at is None:
            return -1  # 永久授权
        delta = self.expires_at - datetime.now(timezone.utc)
        return max(0, delta.days)


def validate_license(license_key: str) -> LicenseInfo:
    """校验 License 密钥并返回解析结果。

    TODO（v1.0 正式版）:
    - 引入 RSA 公钥签名校验
    - 在线激活 & 心跳检测
    - 硬件指纹绑定（可选）
    """
    if not license_key:
        return LicenseInfo(
            edition="community",
            is_valid=False,
            validation_error="未提供 License 密钥",
        )

    # 当前阶段：简单的 JSON 解析校验（开发期用）
    # 生产环境将替换为 RSA 签名校验
    try:
        payload = json.loads(license_key)
        info = LicenseInfo(
            customer_id=payload.get("customer_id", ""),
            customer_name=payload.get("customer_name", ""),
            edition=payload.get("edition", "enterprise"),
            max_users=payload.get("max_users", 5),
            features=payload.get("features", []),
            is_valid=True,
        )

        # 解析到期时间
        expires_str = payload.get("expires_at")
        if expires_str:
            info.expires_at = datetime.fromisoformat(expires_str)
            if info.is_expired:
                info.is_valid = False
                info.validation_error = f"License 已于 {info.expires_at.isoformat()} 过期"

        logger.info(
            "License 校验通过: customer=%s, edition=%s, expires=%s, features=%s",
            info.customer_name, info.edition,
            info.expires_at.isoformat() if info.expires_at else "永久",
            info.features,
        )
        return info

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning("License 校验失败: %s", str(e))
        return LicenseInfo(
            edition="community",
            is_valid=False,
            validation_error=f"License 格式无效: {str(e)}",
        )
