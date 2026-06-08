"""
BlindVault Enterprise Edition (EE) 模块

企业版功能入口。通过环境变量 BLINDVAULT_EE_LICENSE 控制是否激活。
社区版中不会调用此模块下的任何功能。

企业版功能包括（规划中）：
- SSO / LDAP 统一身份认证
- 审计日志导出与合规报表
- 微虚机隔离沙箱 (Micro-VM Sandbox)
- 多租户与 RBAC 权限管理
- License 管理与在线激活
"""

from __future__ import annotations

import os
import logging

logger = logging.getLogger(__name__)

# 企业版 License 密钥（通过环境变量注入）
_EE_LICENSE_KEY = os.getenv("BLINDVAULT_EE_LICENSE", "")


def is_ee_enabled() -> bool:
    """检查是否存在有效的企业版 License。

    当前为简单的非空检测。后续版本将引入：
    - RSA 签名校验
    - 到期时间验证
    - 功能模块级别的 Feature Flag
    """
    return _EE_LICENSE_KEY != ""


def get_ee_license_info() -> dict:
    """获取当前企业版 License 信息摘要。"""
    if not is_ee_enabled():
        return {
            "edition": "community",
            "licensed": False,
            "features": [],
        }

    # TODO: 解析 License 内容，提取到期时间、授权功能列表等
    return {
        "edition": "enterprise",
        "licensed": True,
        "features": [
            "sso",
            "audit_export",
            "micro_vm_sandbox",
            "multi_tenant",
            "rbac",
        ],
    }


def require_ee(feature_name: str) -> None:
    """断言企业版功能已激活，否则抛出异常。

    用于在企业版功能入口处做前置校验：
        from backend.ee import require_ee
        require_ee("sso")
    """
    if not is_ee_enabled():
        raise PermissionError(
            f"功能 '{feature_name}' 需要 BlindVault 企业版 License。"
            f"请联系 sales@blindvault.dev 获取试用授权。"
        )
