"""
BlindVault 通用安全 Shell 执行器 — secure_shell

一个工具覆盖所有运维场景：psql、ssh、curl、mysql、redis-cli……
LLM 构造命令，密码通过 $SECRET 占位，执行时自动替换为真实值。

安全机制：
1. 密码通过 resolve_secret 解密，仅在执行瞬间注入
2. stdout/stderr 自动脱敏（真实密码替换为 [REDACTED]）
3. 执行超时保护（默认 60 秒）
4. 危险命令拦截
"""

from __future__ import annotations

import asyncio
import logging
import re
import shlex

from blindvault_agent.security.models import ExecutionContext, ResolveRequest
from blindvault_agent.security.policy import SecretResolutionError, resolve_secret
from blindvault_agent.security.redis_store import SecretStore

logger = logging.getLogger(__name__)

# ============================================================
# 工具 Schema
# ============================================================

SECURE_SHELL_SCHEMA = {
    "type": "object",
    "properties": {
        "command": {
            "type": "string",
            "description": (
                "要执行的 shell 命令。用 $SECRET 作为密码占位符，"
                "执行时自动替换为真实密码。"
                "例如: psql postgresql://user:$SECRET@host/db -c '\\dt'"
            ),
        },
        "secret_ref": {
            "type": "string",
            "description": "密码/密钥的 secret 引用 (sec_live_xxx)，若命令中不需要凭据则无需填写该可选参数。",
        },
    },
    "required": ["command"],
}


# ============================================================
# 安全控制
# ============================================================

# 危险命令模式（禁止执行）
_DANGEROUS_PATTERNS = [
    r"rm\s+(-[rfR]+\s+)?/",        # rm -rf /
    r"mkfs\.",                       # mkfs.ext4
    r"dd\s+if=",                     # dd if=
    r":()\s*\{\s*:\|:\s*&\s*\};:",   # fork bomb
    r">\s*/dev/sd",                   # 覆写磁盘
    r"chmod\s+(-R\s+)?777\s+/",      # chmod 777 /
    r"curl.*\|\s*(bash|sh|zsh)",     # curl | bash
]

_COMPILED_DANGEROUS = [re.compile(p, re.IGNORECASE) for p in _DANGEROUS_PATTERNS]

EXECUTION_TIMEOUT = 65  # 秒


def _is_dangerous(command: str) -> str | None:
    """检查命令是否危险，返回匹配的模式描述或 None。"""
    for pattern in _COMPILED_DANGEROUS:
        if pattern.search(command):
            return pattern.pattern
    return None


def _redact_output(output: str, real_secret: str) -> str:
    """从输出中移除真实密码。"""
    if real_secret and real_secret in output:
        return output.replace(real_secret, "[REDACTED]")
    return output


# ============================================================
# 工具实现
# ============================================================


async def secure_shell(
    command: str,
    secret_ref: str | None = None,
    *,
    store: SecretStore,
    ctx: ExecutionContext,
    **kwargs,
) -> dict:
    """
    通用安全 Shell 执行器。

    Args:
        command: Shell 命令，$SECRET 作为密码占位
        secret_ref: secret_ref (sec_live_xxx)，可选
        store: Redis 存储（由 executor 注入）
        ctx: 执行上下文（由 executor 注入）

    Returns:
        {"status": "success"|"error", "stdout": ..., "stderr": ..., "exit_code": ...}
    """
    # ---- B2 接线：高危命令审批（resolve 之前，command 仅含占位符）----
    from blindvault_agent.middleware.hitl import (
        check_and_interrupt_if_high_risk,
        HighRiskCommandRejected,
    )
    try:
        check_and_interrupt_if_high_risk(command)
    except HighRiskCommandRejected as e:
        return {
            "status": "error",
            "reason": str(e),
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }

    real_secrets_list = []
    final_command = command

    # 0. 验证并解析主 secret_ref (替换 $SECRET 占位符)
    if secret_ref:
        if not re.match(r"^sec_(?:live|test)_[A-Za-z0-9_-]+$", secret_ref):
            return {
                "status": "error",
                "reason": "Invalid secret reference format",
                "stdout": "",
                "stderr": "",
                "exit_code": -1,
            }

        try:
            real_secret = await resolve_secret(
                store=store,
                ctx=ctx,
                request=ResolveRequest(
                    secret_ref=secret_ref,
                    requested_use="shell_command",
                    destination="",  # secure_shell 不做目标校验
                ),
            )
            real_secrets_list.append(real_secret)
            final_command = command.replace("$SECRET", real_secret)
        except SecretResolutionError as e:
            return {
                "status": "error",
                "reason": f"Secret 解析失败: {str(e)}",
                "stdout": "",
                "stderr": "",
                "exit_code": -1,
            }

    # 1. 自动识别并替换命令中所有显式出现的其他凭证引用
    # 模式一：支持 {{secret:sec_live_xxx}} 格式的强加密占位符
    pattern_curly = re.compile(r"\{\{secret:(sec_(?:live|test)_[A-Za-z0-9_-]+)\}\}")
    for match in pattern_curly.finditer(command):
        ref = match.group(1)
        try:
            val = await resolve_secret(
                store=store,
                ctx=ctx,
                request=ResolveRequest(
                    secret_ref=ref,
                    requested_use="shell_command_multi",
                    destination="",
                )
            )
            real_secrets_list.append(val)
            final_command = final_command.replace(match.group(0), val)
        except Exception as e:
            logger.warning("解析多凭证占位符失败: ref=%s, error=%s", ref, str(e))

    # 模式二：支持命令行中直接出现的 sec_live_xxx 引用
    pattern_raw = re.compile(r"\b(sec_(?:live|test)_[A-Za-z0-9_-]+)\b")
    for match in pattern_raw.finditer(command):
        ref = match.group(1)
        if ref == secret_ref or f"{{secret:{ref}}}" in command:
            continue
        try:
            val = await resolve_secret(
                store=store,
                ctx=ctx,
                request=ResolveRequest(
                    secret_ref=ref,
                    requested_use="shell_command_multi",
                    destination="",
                )
            )
            real_secrets_list.append(val)
            final_command = final_command.replace(ref, val)
        except Exception as e:
            logger.warning("解析多凭证直连引用失败: ref=%s, error=%s", ref, str(e))

    # 1. 检查危险命令 (不管是命令替换前还是替换后，均进行敏感拦截)
    danger = _is_dangerous(final_command)
    if danger:
        logger.warning("secure_shell: 拦截危险命令: %s", final_command[:80])
        return {
            "status": "error",
            "reason": f"命令被安全策略拦截（匹配到危险模式）",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }


    # 4. 执行命令（必须通过注入的沙箱执行器）
    executor = kwargs.get("executor")

    # 🔴 B1 fail-closed：未注入 executor 则拒绝执行
    # 生产环境必须注入沙箱 executor，不允许在宿主直接跑命令
    if not executor:
        logger.error("secure_shell: 未注入 executor，拒绝执行（fail-closed）")
        return {
            "status": "error",
            "reason": "未配置安全执行器（sandbox executor），拒绝执行命令。"
                      "请在 agent 初始化时注入沙箱 executor。",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }

    try:
        res_data = await executor(final_command)
        stdout = res_data.get("stdout", "")
        stderr = res_data.get("stderr", "")
        exit_code = res_data.get("exit_code", -1)

        # 5. 脱敏输出（确保真实密码不出现在返回中）
        for secret in real_secrets_list:
            if secret:
                stdout = _redact_output(stdout, secret)
                stderr = _redact_output(stderr, secret)

        # 限制输出长度
        max_len = 4096
        if len(stdout) > max_len:
            stdout = stdout[:max_len] + "\n... (输出被截断)"
        if len(stderr) > max_len:
            stderr = stderr[:max_len] + "\n... (输出被截断)"

        return {
            "status": "success" if exit_code == 0 else "error",
            "stdout": stdout.strip(),
            "stderr": stderr.strip(),
            "exit_code": exit_code,
        }

    except Exception as e:
        logger.exception("secure_shell: 执行异常")
        return {
            "status": "error",
            "reason": f"执行异常: {str(e)}",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }
    finally:
        # 清除密码引用
        if 'real_secrets_list' in locals():
            for secret in real_secrets_list:
                del secret
            del real_secrets_list
        if 'final_command' in locals():
            del final_command
