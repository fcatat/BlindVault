"""
BlindVault EE - 本地模型智能脱敏客户端

通过调用本地部署的 Ollama 模型（如 Qwen3-0.6B），
对用户输入进行语义级别的敏感信息识别。

作为社区版正则脱敏的**第二层增强**，两层结果合并后统一脱敏。
当模型不可用时，自动降级为仅正则模式，用户无感。

典型部署：
  - 企业用户自备 Mac Mini (M 芯片)，运行 Ollama + Qwen3-0.6B
  - BlindVault 后端通过 LOCAL_MODEL_URL 环境变量指向该服务
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

@dataclass
class DetectedSecret:
    """本地模型识别出的一个敏感信息。"""
    value: str          # 敏感值原文
    secret_type: str    # password | api_key | private_key | connection_string
    label: str          # 简短描述（由模型生成）


# ============================================================
# System Prompt
# ============================================================

_SYSTEM_PROMPT = """你是一个安全信息提取器。分析用户输入，精确识别其中的敏感凭证信息。

敏感信息类型包括：
- password: 登录密码、口令、passphrase
- api_key: API 密钥（sk-xxx, token, bearer 等）
- private_key: SSH 私钥、证书密钥
- connection_string: 包含凭证的数据库连接串（postgresql://user:PASS@host）

规则：
1. 仅提取真正的凭证值，不要提取用户名、IP 地址、端口号等非密码信息
2. 如果无法确定是否为敏感信息，不要提取（宁可漏过，不可误判）
3. 仅返回 JSON 数组，不要输出任何其他文字
4. 不要用 markdown 代码块包裹，直接返回 JSON

输出格式：
[{"value": "实际的敏感值", "type": "password|api_key|private_key|connection_string", "label": "简短描述"}]

如果没有敏感信息，返回：[]"""


# ============================================================
# 核心提取函数
# ============================================================

async def extract_secrets(
    text: str,
    *,
    model_url: str,
    model_name: str = "qwen3:0.6b",
    timeout: float = 2.0,
) -> list[DetectedSecret]:
    """调用本地 Ollama 模型提取敏感信息。

    Args:
        text: 用户输入的原始消息
        model_url: Ollama 服务地址（如 http://mac-mini:11434）
        model_name: 模型名称（默认 qwen3:0.6b）
        timeout: 推理超时时间（秒），超时则返回空列表

    Returns:
        识别到的敏感信息列表。如果模型不可用或推理失败，返回空列表。
    """
    if not text or not text.strip():
        return []

    api_url = f"{model_url.rstrip('/')}/api/chat"

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "stream": False,
        "options": {
            "temperature": 0.0,   # 确定性输出，不需要创造力
            "num_predict": 512,   # 限制输出长度
        },
    }

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(api_url, json=payload)

        elapsed = time.monotonic() - start_time

        if resp.status_code != 200:
            logger.warning(
                "[EE] 本地模型响应异常: status=%d, elapsed=%.1fms",
                resp.status_code, elapsed * 1000,
            )
            return []

        # 解析 Ollama 响应
        resp_data = resp.json()
        content = resp_data.get("message", {}).get("content", "").strip()

        # 解析模型输出的 JSON
        results = _parse_model_output(content, original_text=text)

        logger.info(
            "[EE] 本地模型识别完成: found=%d, elapsed=%.0fms, model=%s",
            len(results), elapsed * 1000, model_name,
        )
        return results

    except httpx.TimeoutException:
        elapsed = time.monotonic() - start_time
        logger.warning(
            "[EE] 本地模型推理超时 (%.1fs > %.1fs)，降级为正则模式",
            elapsed, timeout,
        )
        return []

    except httpx.ConnectError:
        logger.warning(
            "[EE] 无法连接本地模型服务 (%s)，降级为正则模式",
            model_url,
        )
        return []

    except Exception as e:
        logger.warning(
            "[EE] 本地模型调用异常: %s，降级为正则模式",
            str(e),
        )
        return []


# ============================================================
# 输出解析与校验
# ============================================================

def _parse_model_output(
    content: str,
    original_text: str,
) -> list[DetectedSecret]:
    """解析模型输出的 JSON，并进行严格校验。

    防御模型幻觉：
    1. value 必须在原始文本中实际存在
    2. type 必须是预定义类型之一
    3. value 长度必须 >= 3（过短的值大概率是误判）
    """
    if not content:
        return []

    # 清理 markdown 代码块包裹（部分模型会自动添加）
    cleaned = content.strip()
    if cleaned.startswith("```"):
        # 移除 ```json 或 ``` 包裹
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    # 尝试提取 JSON 数组
    # 有些模型会在 JSON 前后输出额外文字
    json_start = cleaned.find("[")
    json_end = cleaned.rfind("]")
    if json_start == -1 or json_end == -1:
        if cleaned == "[]":
            return []
        logger.debug("[EE] 模型输出不包含有效 JSON 数组: %s", cleaned[:200])
        return []

    json_str = cleaned[json_start:json_end + 1]

    try:
        items = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning("[EE] 模型输出 JSON 解析失败: %s, raw=%s", str(e), json_str[:200])
        return []

    if not isinstance(items, list):
        return []

    valid_types = {"password", "api_key", "private_key", "connection_string"}
    results: list[DetectedSecret] = []
    seen_values: set[str] = set()

    for item in items:
        if not isinstance(item, dict):
            continue

        value = str(item.get("value", "")).strip()
        secret_type = str(item.get("type", "")).strip()
        label = str(item.get("label", "")).strip()

        # 校验 1：value 不能为空且长度 >= 3
        if len(value) < 3:
            continue

        # 校验 2：type 必须是预定义类型
        if secret_type not in valid_types:
            continue

        # 校验 3：value 必须在原始文本中实际存在（防幻觉）
        if value not in original_text:
            logger.debug(
                "[EE] 模型幻觉过滤: value='%s' 不存在于原始文本中",
                value[:20],
            )
            continue

        # 校验 4：去重
        if value in seen_values:
            continue
        seen_values.add(value)

        results.append(DetectedSecret(
            value=value,
            secret_type=secret_type,
            label=label or f"model_{secret_type}",
        ))

    return results


# ============================================================
# 健康检查
# ============================================================

async def check_model_health(
    model_url: str,
    timeout: float = 2.0,
) -> dict:
    """检查本地模型服务是否可用。

    Returns:
        {"available": bool, "models": [...], "error": str}
    """
    try:
        api_url = f"{model_url.rstrip('/')}/api/tags"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(api_url)

        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            return {"available": True, "models": models, "error": ""}
        else:
            return {"available": False, "models": [], "error": f"HTTP {resp.status_code}"}

    except Exception as e:
        return {"available": False, "models": [], "error": str(e)}
