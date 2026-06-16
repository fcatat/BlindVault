import os
import logging

_logger = logging.getLogger(__name__)
_EE_LICENSE = os.getenv("BLINDVAULT_EE_LICENSE", "").strip()

def is_ee() -> bool:
    """返回当前是否激活 EE。简版：环境变量非空即激活，后续可换 RSA 签名校验。"""
    return bool(_EE_LICENSE)

def get_ee_features() -> dict:
    if not is_ee():
        return {"edition": "community", "features": []}
    return {"edition": "enterprise", "features": ["local_model"]}

def require_ee(feature: str):
    """断言 EE 已激活，否则抛 PermissionError。EE 入口处用。"""
    if not is_ee():
        raise PermissionError(f"功能 '{feature}' 需要 BlindVault EE License")
