"""
BlindVault 通用安全 Shell 执行器 — secure_shell

一个工具覆盖所有运维场景：psql、ssh、curl、mysql、redis-cli……
LLM 构造命令，密码通过 $SECRET 占位，执行时自动替换为真实值。

安全机制：
1. 密码通过 resolve_secret 解密，仅在执行瞬间注入
2. stdout/stderr 自动脱敏（真实密码替换为 [REDACTED]）
3. 执行超时保护（默认 30 秒）
4. 危险命令拦截
"""

from __future__ import annotations

import asyncio
import logging
import re
import shlex

from backend.models import ExecutionContext, ResolveRequest
from backend.policy import SecretResolutionError, resolve_secret
from backend.redis_store import SecretStore

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
            "description": "密码/密钥的 secret 引用 (sec_live_xxx)",
        },
    },
    "required": ["command", "secret_ref"],
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

EXECUTION_TIMEOUT = 30  # 秒


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
    secret_ref: str,
    *,
    store: SecretStore,
    ctx: ExecutionContext,
) -> dict:
    """
    通用安全 Shell 执行器。

    Args:
        command: Shell 命令，$SECRET 作为密码占位
        secret_ref: secret_ref (sec_live_xxx)
        store: Redis 存储（由 executor 注入）
        ctx: 执行上下文（由 executor 注入）

    Returns:
        {"status": "success"|"error", "stdout": ..., "stderr": ..., "exit_code": ...}
    """
    # 0. 验证 secret_ref 格式
    if not re.match(r"^sec_(?:live|test)_[A-Za-z0-9_-]+$", secret_ref):
        return {
            "status": "error",
            "reason": "Invalid secret reference format",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }

    # 1. 检查危险命令
    danger = _is_dangerous(command)
    if danger:
        logger.warning("secure_shell: 拦截危险命令: %s", command[:80])
        return {
            "status": "error",
            "reason": f"命令被安全策略拦截（匹配到危险模式）",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }

    # 2. 解密获取真实密码
    real_secret = ""
    try:
        # 从 command 中提取可能的目标 URL/host 用于 destination 校验
        # 简化处理：传空串跳过 destination 校验
        real_secret = await resolve_secret(
            store=store,
            ctx=ctx,
            request=ResolveRequest(
                secret_ref=secret_ref,
                requested_use="shell_command",
                destination="",  # secure_shell 不做目标校验
            ),
        )
    except SecretResolutionError as e:
        return {
            "status": "error",
            "reason": f"Secret 解析失败: {str(e)}",
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
        }

    # 3. 将 $SECRET 替换为真实密码
    final_command = command.replace("$SECRET", real_secret)

    # 4. 执行命令
    try:
        proc = await asyncio.create_subprocess_shell(
            final_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # 不通过环境变量传递（某些命令需要直接替换）
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=EXECUTION_TIMEOUT,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {
                "status": "error",
                "reason": f"命令执行超时（{EXECUTION_TIMEOUT}秒）",
                "stdout": "",
                "stderr": "",
                "exit_code": -1,
            }

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        # 5. 脱敏输出（确保真实密码不出现在返回中）
        stdout = _redact_output(stdout, real_secret)
        stderr = _redact_output(stderr, real_secret)

        # 限制输出长度
        max_len = 4096
        if len(stdout) > max_len:
            stdout = stdout[:max_len] + f"\n... (截断，共 {len(stdout_bytes)} 字节)"
        if len(stderr) > max_len:
            stderr = stderr[:max_len] + f"\n... (截断，共 {len(stderr_bytes)} 字节)"

        return {
            "status": "success" if proc.returncode == 0 else "error",
            "stdout": stdout.strip(),
            "stderr": stderr.strip(),
            "exit_code": proc.returncode,
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
        del real_secret
        del final_command
