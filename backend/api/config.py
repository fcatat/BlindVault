"""
BlindVault 配置 API

提供 LLM 运行时配置的读取和更新，支持前端 Agent Config 页面。
更新配置后不需要重启服务，且持久化到 PostgreSQL。
"""

from __future__ import annotations

import logging
import re
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import get_settings
from backend.db import save_llm_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"])


class LLMConfigResponse(BaseModel):
    """LLM 配置响应（不含 API Key 明文）。"""
    llm_provider: str
    llm_model: str
    llm_base_url: str
    has_api_key: bool  # 只告知是否已配置，不返回明文


class LLMConfigUpdate(BaseModel):
    """LLM 配置更新请求。"""
    llm_provider: str  # "openai" | "mock"
    llm_model: str
    llm_base_url: str = ""
    llm_api_key: str = ""  # 空串 = 不更新


@router.get("", response_model=LLMConfigResponse)
async def get_config():
    """获取当前 LLM 配置（API Key 脱敏）。"""
    settings = get_settings()
    return LLMConfigResponse(
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_base_url=settings.llm_base_url,
        has_api_key=bool(settings.llm_api_key),
    )


@router.put("", response_model=LLMConfigResponse)
async def update_config(payload: LLMConfigUpdate):
    """
    更新 LLM 运行时配置。

    - 内存中立即生效
    - 同时持久化到 PostgreSQL（重启不丢失）
    - API Key 加密存储
    """
    settings = get_settings()

    # 更新内存中的配置
    settings.llm_provider = payload.llm_provider
    settings.llm_model = payload.llm_model
    settings.llm_base_url = payload.llm_base_url

    if payload.llm_api_key:
        settings.llm_api_key = payload.llm_api_key

    # 持久化到 PostgreSQL
    try:
        await save_llm_config(
            provider=settings.llm_provider,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
            api_key=payload.llm_api_key,  # 空串不会覆盖已有 key
            encryption_key=settings.encryption_key_bytes,
        )
    except Exception:
        logger.exception("配置持久化失败，但内存中已更新")

    logger.info(
        "LLM 配置已更新: provider=%s, model=%s, base_url=%s, has_key=%s",
        settings.llm_provider,
        settings.llm_model,
        settings.llm_base_url or "(empty)",
        bool(settings.llm_api_key),
    )

    return LLMConfigResponse(
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_base_url=settings.llm_base_url,
        has_api_key=bool(settings.llm_api_key),
    )


class PatternItem(BaseModel):
    """脱敏正则规则项模型。"""
    pattern: str
    secret_type: str
    label: str


@router.get("/patterns", response_model=list[PatternItem])
async def get_patterns():
    """获取所有脱敏正则规则。"""
    from backend.db import load_config
    from backend.sanitizer import DEFAULT_PATTERNS
    try:
        data_str = await load_config("sanitizer_patterns")
        if data_str:
            return json.loads(data_str)
    except Exception as e:
        logger.warning("从数据库加载正则失败，返回默认规则: %s", str(e))
    return DEFAULT_PATTERNS


@router.put("/patterns", response_model=list[PatternItem])
async def update_patterns(patterns: list[PatternItem]):
    """更新并应用脱敏正则规则，校验正则表达式合法性。"""
    from backend.db import save_config
    from backend.sanitizer import update_patterns_cache

    # 校验正则的语法合法性
    patterns_data = []
    for item in patterns:
        try:
            re.compile(item.pattern)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"正则表达式语法不合法: {item.pattern}, 错误: {str(e)}",
            )
        patterns_data.append({
            "pattern": item.pattern,
            "secret_type": item.secret_type,
            "label": item.label,
        })

    try:
        # 持久化到 PostgreSQL
        await save_config("sanitizer_patterns", json.dumps(patterns_data, ensure_ascii=False))
        # 刷新内存缓存
        await update_patterns_cache(patterns_data)
    except Exception as e:
        logger.exception("保存正则规则失败")
        raise HTTPException(
            status_code=500,
            detail=f"保存正则规则失败: {str(e)}",
        )

    return patterns
