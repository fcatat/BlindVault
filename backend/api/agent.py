"""
BlindVault Agent API

POST /api/agent/run — 调用 LangGraph agent 处理用户消息。

安全规则：
- 用户消息中的密码等敏感信息会被自动检测并替换为 secret_ref
- LLM 只看到 {{secret:sec_xxx}} 引用，永远看不到真实密码
- secret 解析只发生在 SecureToolNode 内部
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException

from backend.agent.graph import run_agent
from backend.models import AgentRunRequest, AgentRunResponse, RunPlanStepRequest, RunPlanStepResponse, ExecutionContext, HealPlanStepRequest, HealPlanStepResponse
from backend.redis_store import get_store
from backend.sanitizer import sanitize_message, detect_leaked_secrets
from backend.config import get_settings
from backend.tools.secure_shell import secure_shell

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/run", response_model=AgentRunResponse)
async def agent_run(
    req: AgentRunRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_session_id: str = Header(None, alias="X-Session-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    运行 agent 处理用户消息。

    处理流程：
    1. 预处理：自动检测消息中的密码/token，创建 secret 并替换
    2. LLM 调用：模型只看到 {{secret:sec_xxx}} 引用
    3. 工具执行：SecureToolNode 在安全环境中解析 secret

    Headers:
    - X-User-Id: 用户 ID（必需）
    - X-Session-Id: 会话 ID（可选，默认使用请求体中的 session_id）
    - X-Tenant-Id: 租户 ID（可选，默认 "default"）
    """
    session_id = x_session_id or req.session_id
    store = await get_store()

    # ---- 消息预处理：自动检测并保护敏感信息 ----
    sanitized_message, auto_created_refs = await sanitize_message(
        message=req.user_message,
        store=store,
        user_id=x_user_id,
        session_id=session_id,
        tenant_id=x_tenant_id,
    )

    if auto_created_refs:
        logger.info(
            "消息预处理完成: 自动创建了 %d 个 secret",
            len(auto_created_refs),
        )

    # ---- 安全防护策略检测：任何包含未加密明文凭证的操作，统统进行硬拦截阻断 ----
    leaked = detect_leaked_secrets(sanitized_message)
    if leaked is not None:
        raise HTTPException(
            status_code=400,
            detail=f"检测到疑似明文凭证数据（{leaked}）外泄！为了系统安全，该指令已被拦截。请在凭证库中录入凭据并使用安全引用。"
        )

    # ---- 调用 Agent（使用已脱敏的消息）----
    result = await run_agent(
        user_message=sanitized_message,
        store=store,
        user_id=x_user_id,
        session_id=session_id,
        tenant_id=x_tenant_id,
        history=req.history,
        confirmed=req.confirmed,
    )

    # 合并自动创建的 secret_refs
    all_refs = list(set(result.get("secret_refs_used", []) + auto_created_refs))
    result["secret_refs_used"] = all_refs
    result["sanitized_input"] = sanitized_message

    # 旁路安全审计检测明文泄漏
    result["leak_detected"] = leaked is not None
    result["leaked_value"] = leaked

    return AgentRunResponse(**result)


@router.post("/run_plan_step", response_model=RunPlanStepResponse)
async def agent_run_plan_step(
    req: RunPlanStepRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    单步直接执行计划里的某一步骤。
    解密安全引用，替换 $SECRET 占位符后，在沙箱运行并脱敏返回结果。
    """
    store = await get_store()

    # 构造执行上下文
    ctx = ExecutionContext(
        user_id=x_user_id,
        session_id=req.session_id,
        tenant_id=x_tenant_id,
        tool_name="secure_shell",
    )

    # 执行命令
    res = await secure_shell(
        command=req.command,
        secret_ref=req.secret_ref,
        store=store,
        ctx=ctx,
    )

    return RunPlanStepResponse(
        exit_code=res.get("exit_code", -1),
        stdout=res.get("stdout", ""),
        stderr=res.get("stderr", "") or res.get("reason", ""),
        status=res.get("status", "error"),
    )


@router.post("/heal_plan_step", response_model=HealPlanStepResponse)
async def agent_heal_plan_step(
    req: HealPlanStepRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """
    智能单步自愈：分析失败的命令与报错日志，并生成修正后的命令。
    """
    import re
    settings = get_settings()
    use_mock = settings.llm_provider == "mock"

    if use_mock:
        # 1. 模拟网络与权限故障自愈（例如 SSH 代理连接失败退化为本地执行）
        suggested = req.command
        analysis = "分析：命令在连接远程主机 10.14.101.22 时因网络不可达或超时而失败。自愈建议：直接在本地隔离沙箱中执行相同的核心指令，剔除 SSH 代理。"

        # 匹配 sshpass ... root@10.14.101.22 "cmd" 结构
        ssh_match = re.search(r'sshpass\s+.*?ssh\s+.*?\s+root@10\.14\.101\.22\s+"(.*?)"', req.command)
        if ssh_match:
            suggested = ssh_match.group(1)
        else:
            # 兼容单引号
            ssh_match_single = re.search(r"sshpass\s+.*?ssh\s+.*?\s+root@10\.14\.101\.22\s+'(.*?)'", req.command)
            if ssh_match_single:
                suggested = ssh_match_single.group(1)
            else:
                # 再次兼容不带 sshpass 的普通 ssh 代理
                ssh_match_simple = re.search(r'ssh\s+.*?\s+root@10\.14\.101\.22\s+"(.*?)"', req.command)
                if ssh_match_simple:
                    suggested = ssh_match_simple.group(1)
                elif "ssh" in req.command and "10.14.101.22" in req.command:
                    # 如果命令包含 ssh 和该 IP，但正则没配对，我们直接提供本地化 nginx 测试命令作为降级
                    if "pull" in req.command:
                        suggested = "docker pull nginx:alpine"
                    elif "run" in req.command:
                        suggested = "docker run -d -p 8888:80 --name nginx-test nginx:alpine"
                    else:
                        suggested = "docker images"

        return HealPlanStepResponse(
            suggested_command=suggested,
            analysis=analysis,
        )

    # 2. 真实大模型调用分支
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.prompts import ChatPromptTemplate
        import json

        llm = ChatOpenAI(
            model=settings.llm_model,
            openai_api_key=settings.llm_api_key,
            openai_api_base=settings.llm_base_url or None,
            temperature=0.1,
        )

        prompt = ChatPromptTemplate.from_messages([
            ("system", (
                "You are an expert DevOps engineer and self-healing agent.\n"
                "The user will provide a command that failed in a Linux sandbox, along with the stderr/error log.\n"
                "Your task is to analyze the error, find the root cause, and provide a corrected command that can run successfully in the same environment.\n\n"
                "You MUST output a valid JSON object containing exactly two fields:\n"
                "1. 'suggested_command': The corrected single-line command (do not include markdown block, output only the raw string).\n"
                "2. 'analysis': A concise Chinese explanation of what went wrong and how you fixed it.\n\n"
                "Format requirement: JSON output only. Example:\n"
                "{{\n"
                "  \"suggested_command\": \"docker run -d -p 8080:80 nginx\",\n"
                "  \"analysis\": \"检测到80端口冲突，已将宿主机映射端口更改为8080进行重试。\"\n"
                "}}"
            )),
            ("user", "Failed Command: {command}\nError Output: {stderr}")
        ])

        chain = prompt | llm
        resp = await chain.ainvoke({"command": req.command, "stderr": req.stderr})
        text = resp.content.strip()

        # 去除 markdown 标记
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        data = json.loads(text)
        return HealPlanStepResponse(
            suggested_command=data.get("suggested_command", req.command),
            analysis=data.get("analysis", "未识别到具体异常，建议重试。"),
        )
    except Exception as e:
        logger.exception("AI 自愈接口异常")
        return HealPlanStepResponse(
            suggested_command=req.command,
            analysis=f"自愈模型调用异常: {str(e)}，建议人工介入修改命令。",
        )
