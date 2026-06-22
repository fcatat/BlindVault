import logging

_logger = logging.getLogger(__name__)

# 架构决策 2026-06-22：不再区分开源版 / 企业版，全部功能对所有用户开放。
# 商业化只做售后/技术支持，不做功能门禁。
# 这些函数保留是为了不破坏历史调用方；门禁已永久放行。


def is_ee() -> bool:
    """版本区分已移除：所有功能默认开放，恒返回 True。"""
    return True


def get_ee_features() -> dict:
    """所有功能开放（保留字段以兼容旧调用方）。"""
    return {"edition": "all", "features": ["local_model"]}


def require_ee(feature: str):
    """版本门禁已移除，空操作（保留以兼容旧调用方）。"""
    return None
