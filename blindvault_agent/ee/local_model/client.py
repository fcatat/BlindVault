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
- password: 登录密码、口令、passphrase、各种服务的密码（数据库密码、root密码、MySQL密码等）
- api_key: API 密钥（sk-xxx, token, bearer 等）
- private_key: SSH 私钥、证书密钥
- connection_string: 包含凭证的数据库连接串（postgresql://user:PASS@host）

典型的密码出现场景（都必须提取）：
- "密码设置为123456" → 提取 "123456"
- "密码是 abc@2024" → 提取 "abc@2024"
- "root密码 P@ssw0rd" → 提取 "P@ssw0rd"
- "MYSQL_ROOT_PASSWORD=mypass123" → 提取 "mypass123"
- "-p 3306 -e PASSWORD=xxx" → 提取 "xxx"
- "用密码 test123 登录" → 提取 "test123"
- "口令为 Qwerty!@#" → 提取 "Qwerty!@#"

规则：
1. 仅提取真正的凭证值（密码、密钥、token），不要提取用户名、IP 地址、端口号、容器名等非密码信息
2. 当用户说"密码设置为X"、"密码是X"、"密码为X"、"密码X"时，X 就是密码，必须提取
3. 如果无法确定是否为敏感信息，不要提取（宁可漏过，不可误判）
4. 仅返回 JSON 数组，不要输出任何其他文字
5. 不要用 markdown 代码块包裹，直接返回 JSON

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
    api_type: str = "ollama",
    system_prompt: str = "",
    disable_cot: bool = True,
) -> list[DetectedSecret]:
    """调用本地部署的模型服务提取敏感信息。

    支持 Ollama、OpenAI 及自定义 FastAPI 的协议载荷转换。

    Args:
        text: 用户输入的原始消息
        model_url: 本地大模型服务地址（如 http://localhost:11434）
        model_name: 模型标识符（如 qwen3:0.6b）
        timeout: 超时限制（秒）
        api_type: 协议类型（"ollama" | "openai" | "custom_fastapi"）
        system_prompt: 自定义 System Prompt
        disable_cot: 是否强制禁用 CoT 思考链

    Returns:
        识别到的敏感信息列表。
    """
    if not text or not text.strip():
        return []

    # 1. 确定并增强 System Prompt（限制思考过程 CoT）
    sys_prompt = system_prompt.strip() if system_prompt else _SYSTEM_PROMPT
    if disable_cot:
        cot_instructions = (
            "\n\n[Constraint: You must output the JSON result directly. "
            "DO NOT output any reasoning, thinking process, CoT, or <think> tags. Do not explain.]"
            "\n[约束：你必须直接输出提取到的 JSON 结果。严禁输出任何思考过程、推导步骤或 <think> 标签。不作解释。]"
        )
        if "DO NOT output any reasoning" not in sys_prompt:
            sys_prompt += cot_instructions

    # 2. 组装接口 URL 和请求 Payload
    api_type = api_type.lower().strip()
    payload = {}

    if api_type == "openai":
        api_url = f"{model_url.rstrip('/')}/v1/chat/completions"
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": text},
            ],
            "stream": False,
            "temperature": 0.0,
            "max_tokens": 512,
        }
    elif api_type == "custom_fastapi":
        api_url = f"{model_url.rstrip('/')}/api/v1/chat"
        payload = {
            "model": model_name,
            "system_prompt": sys_prompt,
            "input": text,
        }
    else:  # 默认 ollama
        api_url = f"{model_url.rstrip('/')}/api/chat"
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": text},
            ],
            "stream": False,
            "options": {
                "temperature": 0.0,   # 确定性输出
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
                "[EE] 本地模型响应异常 (%s): status=%d, elapsed=%.1fms",
                api_type, resp.status_code, elapsed * 1000,
            )
            return []

        # 3. 自适应解析各大模型的文本响应内容
        resp_data = resp.json()
        content = ""

        if api_type == "openai":
            try:
                content = resp_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            except (IndexError, AttributeError):
                content = ""
        elif api_type == "custom_fastapi":
            content = _extract_text_from_response(resp_data)
        else:  # ollama
            content = resp_data.get("message", {}).get("content", "").strip()

        if not content and api_type != "custom_fastapi":
            # 二次兜底探测
            content = _extract_text_from_response(resp_data)

        # 4. 严格校验与防幻觉过滤
        logger.info("[EE] 本地模型返回原始文本: %r", content)
        results = _parse_model_output(content, original_text=text)

        logger.info(
            "[EE] 本地模型识别完成: type=%s, found=%d, elapsed=%.0fms, model=%s",
            api_type, len(results), elapsed * 1000, model_name,
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


def _extract_text_from_response(resp_data: any) -> str:
    """自适应从各推理接口返回的结构化 JSON 数据中寻找核心的 AI 文本响应字段。"""
    if isinstance(resp_data, str):
        return resp_data.strip()
    if not isinstance(resp_data, dict):
        return ""

    # 1. 提取常用的直属文本 key
    for key in ("response", "output", "message", "content", "reply", "result", "text"):
        val = resp_data.get(key)
        if isinstance(val, str):
            return val.strip()
        if isinstance(val, dict) and "content" in val:
            return str(val.get("content")).strip()
        if isinstance(val, list) and len(val) > 0:
            first_val = val[0]
            if isinstance(first_val, str):
                return first_val.strip()
            if isinstance(first_val, dict) and "content" in first_val:
                return str(first_val.get("content")).strip()
            if isinstance(first_val, dict) and "text" in first_val:
                return str(first_val.get("text")).strip()

    # 2. 备用查找：查找首个含有 JSON-String 格式的 string 字段
    for k, v in resp_data.items():
        if isinstance(v, str) and ("[" in v or "]" in v or "{" in v):
            return v.strip()

    return ""


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
    api_type: str = "ollama",
    model_name: str = "qwen3:0.6b",
) -> dict:
    """检查本地模型服务是否可用。

    根据 api_type 提供自适应连通探测。

    Returns:
        {"available": bool, "models": [...], "error": str}
    """
    api_type = api_type.lower().strip()

    # 1. Ollama 原生活性检查
    if api_type == "ollama":
        try:
            api_url = f"{model_url.rstrip('/')}/api/tags"
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(api_url)

            if resp.status_code == 200:
                try:
                    data = resp.json()
                except Exception:
                    return {"available": False, "models": [], "error": "返回格式错误：非 JSON 响应"}
                
                if isinstance(data, dict) and "models" in data:
                    models = [m.get("name", "") for m in data.get("models", [])]
                    return {"available": True, "models": models, "error": ""}
                else:
                    return {"available": False, "models": [], "error": "返回格式错误：未找到 models 列表，这可能不是真正的 Ollama 服务"}
            else:
                return {"available": False, "models": [], "error": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"available": False, "models": [], "error": str(e)}

    # 2. OpenAI 协议活性检查
    elif api_type == "openai":
        try:
            api_url = f"{model_url.rstrip('/')}/v1/models"
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(api_url)
            # 只要响应在 200 或是 401 范围，均能判定服务端点正常，而不是 DNS 劫持或中间代理拦截
            if resp.status_code in (200, 401):
                return {"available": True, "models": [], "error": ""}
            else:
                return {"available": False, "models": [], "error": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"available": False, "models": [], "error": f"连接 OpenAI 接口失败: {str(e)}"}

    # 3. 自定义 FastAPI 活性检查（向 /api/v1/chat 发送轻量级测试 POST Payload）
    elif api_type == "custom_fastapi":
        try:
            api_url = f"{model_url.rstrip('/')}/api/v1/chat"
            payload = {
                "model": model_name,
                "system_prompt": "ping",
                "input": "ping"
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(api_url, json=payload)
            # 只要收到来自该具体端点的响应 (即便返回 400 校验错误或 422)，也能断定接口后端是活跃运转的
            if resp.status_code in (200, 400, 422):
                return {"available": True, "models": [], "error": ""}
            else:
                return {"available": False, "models": [], "error": f"接口异常 HTTP {resp.status_code}"}
        except Exception as e:
            return {"available": False, "models": [], "error": f"连接自定义 FastAPI 接口失败: {str(e)}"}



# ============================================================
# 同步桥接
# ============================================================

def make_sync_extract_secrets() -> callable:
    """
    返回一个同步的 extract_secrets 函数，用于在同步中间件中调用。
    使用独立线程或 asyncio.run 运行异步逻辑。
    """
    import asyncio
    import concurrent.futures

    def sync_extract_secrets(
        text: str,
        *,
        model_url: str,
        model_name: str = "qwen3:0.6b",
        timeout: float = 2.0,
        api_type: str = "ollama",
        system_prompt: str = "",
        disable_cot: bool = True,
    ) -> list[DetectedSecret]:
        async def _run():
            return await extract_secrets(
                text,
                model_url=model_url,
                model_name=model_name,
                timeout=timeout,
                api_type=api_type,
                system_prompt=system_prompt,
                disable_cot=disable_cot,
            )
            
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            
        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                future = pool.submit(asyncio.run, _run())
                return future.result()
        else:
            return asyncio.run(_run())

    return sync_extract_secrets
