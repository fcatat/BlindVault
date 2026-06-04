"""
BlindVault 配置 API

提供 LLM 运行时配置的读取和更新，支持前端 Agent Config 页面。
更新配置后不需要重启服务，且持久化到 PostgreSQL。
"""

from __future__ import annotations

import logging
import re
import json
import asyncio

from fastapi import APIRouter, HTTPException

from pydantic import BaseModel

from backend.config import get_settings
from backend.db import save_llm_config
from backend.agent.graph import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"])


class LLMConfigResponse(BaseModel):
    """LLM 配置响应（不含 API Key 明文）。"""
    llm_provider: str
    llm_model: str
    llm_base_url: str
    has_api_key: bool  # 只告知是否已配置，不返回明文
    safety_policy_mode: str
    system_prompt: str


class LLMConfigUpdate(BaseModel):
    """LLM 配置更新请求。"""
    llm_provider: str  # "openai" | "mock"
    llm_model: str
    llm_base_url: str = ""
    llm_api_key: str = ""  # 空串 = 不更新
    safety_policy_mode: str = "lax"


@router.get("", response_model=LLMConfigResponse)
async def get_config():
    """获取当前 LLM 配置（API Key 脱敏）。"""
    settings = get_settings()
    return LLMConfigResponse(
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_base_url=settings.llm_base_url,
        has_api_key=bool(settings.llm_api_key),
        safety_policy_mode=settings.safety_policy_mode,
        system_prompt=SYSTEM_PROMPT,
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
    settings.safety_policy_mode = payload.safety_policy_mode

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
            safety_policy_mode=settings.safety_policy_mode,
        )
    except Exception:
        logger.exception("配置持久化失败，但内存中已更新")

    logger.info(
        "LLM 配置已更新: provider=%s, model=%s, base_url=%s, has_key=%s, safety_policy_mode=%s",
        settings.llm_provider,
        settings.llm_model,
        settings.llm_base_url or "(empty)",
        bool(settings.llm_api_key),
        settings.safety_policy_mode,
    )

    return LLMConfigResponse(
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_base_url=settings.llm_base_url,
        has_api_key=bool(settings.llm_api_key),
        safety_policy_mode=settings.safety_policy_mode,
        system_prompt=SYSTEM_PROMPT,
    )


class ConnectionCheckResponse(BaseModel):
    """LLM 连通性检测响应。"""
    success: bool
    status: str  # "connected" | "auth_error" | "network_error" | "mock"
    detail: str = ""


@router.post("/check", response_model=ConnectionCheckResponse)
async def check_llm_connection():
    """实时检测当前 LLM 网关和 API Key 的连通性。"""
    settings = get_settings()

    if settings.llm_provider == "mock":
        return ConnectionCheckResponse(
            success=True, 
            status="mock", 
            detail="Mock 模式无需验证连通性"
        )

    if not settings.llm_api_key:
        return ConnectionCheckResponse(
            success=False, 
            status="auth_error", 
            detail="未配置 API Key"
        )

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage
    except ImportError as e:
        return ConnectionCheckResponse(
            success=False,
            status="network_error",
            detail=f"系统缺失大模型调用组件: {str(e)}"
        )

    llm_kwargs = {
        "model": settings.llm_model,
        "api_key": settings.llm_api_key,
        "temperature": 0.1,
    }

    if settings.llm_base_url:
        llm_kwargs["base_url"] = settings.llm_base_url

    try:
        llm = ChatOpenAI(**llm_kwargs)
        # 发送单字符消息测试
        await asyncio.wait_for(
            llm.ainvoke([HumanMessage(content="p")]),
            timeout=5.0
        )
        return ConnectionCheckResponse(
            success=True, 
            status="connected", 
            detail="连接成功"
        )
    except asyncio.TimeoutError:
        return ConnectionCheckResponse(
            success=False,
            status="network_error",
            detail="连接网关超时，请检查网关地址或网络是否通畅。"
        )
    except Exception as e:
        err_msg = str(e)
        logger.warning("LLM 连通性测试失败: %s", err_msg)

        is_auth = any(
            x in err_msg.lower()
            for x in ["401", "unauthorized", "auth", "api key", "token", "credential", "invalid proxy"]
        )
        if is_auth:
            return ConnectionCheckResponse(
                success=False,
                status="auth_error",
                detail=f"凭证验证失败，网关返回: {err_msg}"
            )
        else:
            return ConnectionCheckResponse(
                success=False,
                status="network_error",
                detail=f"连接网关失败，网关返回: {err_msg}"
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


@router.get("/patterns/audit", response_model=list[PatternItem])
async def get_audit_patterns():
    """获取系统内置的旁路审计与阻断规则（只读）。"""
    from backend.sanitizer import AUDIT_PATTERNS
    return AUDIT_PATTERNS


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


class RegexGenerateRequest(BaseModel):
    """AI 生成正则请求。"""
    user_description: str
    sample_text: str = ""


class RegexGenerateResponse(BaseModel):
    """AI 生成正则响应。"""
    pattern: str
    secret_type: str
    label: str


@router.post("/patterns/generate", response_model=RegexGenerateResponse)
async def generate_regex(payload: RegexGenerateRequest):
    """
    使用 AI 根据用户的自然语言描述和样例内容，生成脱敏正则表达式并提取字段。
    """
    settings = get_settings()
    if settings.llm_provider == "mock" or not settings.llm_api_key:
        raise HTTPException(
            status_code=400,
            detail="请先在 [Agent 配置] 页面配置好 LLM API Key 并切换为 OpenAI 模式，以使用 AI 生成正则功能。",
        )

    # 引入 LangChain 客户端调用
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
    except ImportError as e:
        logger.error("无法加载 langchain 依赖: %s", str(e))
        raise HTTPException(
            status_code=500,
            detail=f"系统缺失大模型调用组件，请联系管理员或使用手动配置。错误: {str(e)}",
        )

    llm_kwargs = {
        "model": settings.llm_model,
        "api_key": settings.llm_api_key,
        "temperature": 0.1,
    }
    if settings.llm_base_url:
        llm_kwargs["base_url"] = settings.llm_base_url

    try:
        llm = ChatOpenAI(**llm_kwargs)
        
        system_prompt = """你是一个正则表达式专家和运维安全防护专家。
用户的目标是编写一个正则表达式，用于自动识别和脱敏命令行、日志或消息中的敏感凭据（如密码、Token、密钥等）。

请根据用户的【需求描述】和提供的【测试样本】，设计一个用于脱敏的正则表达式。
正则表达式必须遵守以下规则：
1. 建议在敏感值（例如具体的密码值、Token值）的外层使用捕获组 `(...)`，这样系统可以精准扣出密钥体并保留前导的键名（如 `token=xxx` 只替换 `xxx`）。
2. 你需要指定这笔敏感信息的凭证类型 (`secret_type`)，它必须是以下四者之一：'password'、'api_key'、'token'、'other'。
3. 指定一个英文缩写的短标签 (`label`)，例如 `custom_pwd`、`auth_token`、`api_secret`。
4. 保证正则表达式是标准可用的，兼容 Python re 模块。

请直接返回一个 JSON 对象，不要使用 markdown 的 ``` 格式包裹，格式如下：
{
  "pattern": "这里是正则表达式",
  "secret_type": "password/api_key/token/other 之一",
  "label": "短标签"
}
"""
        user_prompt = f"【需求描述】：{payload.user_description}\n"
        if payload.sample_text:
            user_prompt += f"【测试样本】：{payload.sample_text}\n"

        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])

        content = response.content.strip()
        
        # 清除可能带有的 markdown code block 包裹
        if content.startswith("```"):
            lines = content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            content = "\n".join(lines).strip()

        data = json.loads(content)
        pattern = data.get("pattern", "")
        secret_type = data.get("secret_type", "other")
        label = data.get("label", "custom_rule")

        if not pattern:
            raise ValueError("LLM 未返回有效 pattern 正则表达式")

        # 语法合规校验
        re.compile(pattern)

        return RegexGenerateResponse(
            pattern=pattern,
            secret_type=secret_type,
            label=label,
        )

    except json.JSONDecodeError as jde:
        logger.exception("AI 返回了无法解析的 JSON 数据")
        raise HTTPException(
            status_code=500,
            detail=f"AI 返回的数据解析失败，请精简重试。返回内容: {response.content if 'response' in locals() else str(jde)}",
        )
    except Exception as e:
        logger.exception("AI 生成正则失败")
        raise HTTPException(
            status_code=500,
            detail=f"AI 辅助生成正则失败: {str(e)}",
        )


# ------------------------------------------------------------
# 诊断沙箱 (Diagnostics Sandbox) API 扩展
# ------------------------------------------------------------

class SandboxStatusResponse(BaseModel):
    status: str
    version: str
    tools: list[str]


@router.get("/sandbox/status", response_model=SandboxStatusResponse)
async def get_sandbox_status():
    """中转获取诊断沙箱的状态与可用客户端工具。"""
    import httpx
    settings = get_settings()
    url = f"{settings.sandbox_url.rstrip('/')}/status"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                return SandboxStatusResponse(
                    status=data.get("status", "healthy"),
                    version=data.get("version", "unknown"),
                    tools=data.get("tools", [])
                )
            else:
                return SandboxStatusResponse(status="offline", version="unknown", tools=[])
    except Exception as e:
        logger.warning("无法访问沙箱服务 %s: %s", url, str(e))
        return SandboxStatusResponse(status="offline", version="unknown", tools=[])


@router.post("/sandbox/upgrade", response_model=SandboxStatusResponse)
async def upgrade_sandbox():
    """手动触发诊断沙箱的模拟升级。"""
    import httpx
    settings = get_settings()
    url = f"{settings.sandbox_url.rstrip('/')}/upgrade"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url)
            if resp.status_code == 200:
                # 升级成功后，重新获取一下状态并返回
                status_url = f"{settings.sandbox_url.rstrip('/')}/status"
                status_resp = await client.get(status_url)
                if status_resp.status_code == 200:
                    status_data = status_resp.json()
                    return SandboxStatusResponse(
                        status=status_data.get("status", "healthy"),
                        version=status_data.get("version", "unknown"),
                        tools=status_data.get("tools", [])
                    )
            raise HTTPException(status_code=500, detail="沙箱升级接口调用失败")
    except Exception as e:
        logger.error("沙箱升级失败: %s", str(e))
        raise HTTPException(
            status_code=503,
            detail=f"无法连接到沙箱服务完成升级: {str(e)}"
        )

