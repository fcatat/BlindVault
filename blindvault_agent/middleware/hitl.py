"""
BlindVault HITL 审批（拦截点 B 审批）

🔴 安全关键代码 —— 必须人工/强模型 review

设计：
- 高危命令判定在 secure_shell 工具内部完成
- 只有高危命令才触发 LangGraph interrupt() 暂停审批
- 非高危命令直接执行，不审批
- 审批状态序列化时不含明文密钥（命令中只有占位符）

B2 修复：移除对所有 secure_shell 的无差别拦截，
改为在工具内部按高危规则有条件触发 interrupt()。

安全铁律：
- 审批时模型和人工看到的都是脱敏后的命令（含占位符 {{secret:xxx}}）
- 明文只在 approve 后、工具执行瞬间由 resolve_secret 注入
- reject 则不执行，明文永远不出现
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from langgraph.types import interrupt

logger = logging.getLogger(__name__)


# ============================================================
# 高危命令规则
# ============================================================

# 高危命令正则模式
_HIGH_RISK_PATTERNS = [
    (r"rm\s+(-[rfR]+\s+)?/", "rm -rf /（删除根目录）"),
    (r"mkfs\.", "mkfs（格式化分区）"),
    (r"dd\s+if=", "dd（磁盘写入）"),
    (r":()\s*\{\s*:\|:\s*&\s*\};:", "fork bomb"),
    (r">\s*/dev/sd", "覆写磁盘设备"),
    (r"chmod\s+(-R\s+)?777\s+/", "chmod 777 /（全局开放权限）"),
    (r"curl.*\|\s*(bash|sh|zsh)", "curl | bash（远程执行）"),
    (r"wget.*\|\s*(bash|sh|zsh)", "wget | bash（远程执行）"),
    (r"shutdown|reboot|halt|poweroff", "关机/重启"),
    (r"iptables\s+-F", "清空防火墙规则"),
    (r"DROP\s+DATABASE", "删除数据库"),
    (r"DROP\s+TABLE", "删除表"),
    (r"TRUNCATE\s+TABLE", "清空表"),
]

_COMPILED_HIGH_RISK = [
    (re.compile(pattern, re.IGNORECASE), desc)
    for pattern, desc in _HIGH_RISK_PATTERNS
]


def is_command_high_risk(command: str) -> Optional[str]:
    """
    检查命令是否高危。
    首先检查配置中的 agent_high_risk_commands 列表，然后检查内置正则模式。
    返回风险描述（str）或 None（安全）。
    """
    from blindvault_agent.security.config import get_settings

    # 1. 检查配置的字符串列表
    config_commands = get_settings().agent_high_risk_commands.split(",")
    for cmd_prefix in config_commands:
        cmd_prefix = cmd_prefix.strip()
        if not cmd_prefix:
            continue
        # 简单匹配：如果命令包含该高危词汇（考虑边界）
        if re.search(r'\b' + re.escape(cmd_prefix) + r'(\b|\s)', command, re.IGNORECASE):
            return f"配置指定的高危操作（{cmd_prefix}）"

    # 2. 检查内置正则
    for pattern, description in _COMPILED_HIGH_RISK:
        if pattern.search(command):
            return description

    return None


def check_and_interrupt_if_high_risk(command: str) -> None:
    """
    检查命令是否高危，如果是则触发 LangGraph interrupt() 暂停审批。

    此函数应在 secure_shell 工具内部、凭证 resolve 之前调用，
    确保审批状态中只有占位符，不含明文。

    非高危命令不触发中断，直接返回。

    恢复方式：
        from langgraph.types import Command
        agent.invoke(
            Command(resume={"decisions": [{"type": "approve"}]}),
            config={"configurable": {"thread_id": thread_id}},
        )

    Raises:
        langgraph.types.interrupt: 高危命令触发中断
    """
    risk = is_command_high_risk(command)
    if risk is None:
        return  # 非高危，放行

    logger.warning("🚨 高危命令审批: %s — %s", command[:80], risk)

    # 触发 LangGraph interrupt
    decision = interrupt({
        "type": "high_risk_command",
        "command": command,  # 此时命令中只有占位符，不含明文
        "risk_description": risk,
        "message": f"检测到高危命令（{risk}），需要人工确认。approve 执行，reject 取消。",
    })

    # interrupt() 返回 resume 值
    if isinstance(decision, dict):
        decisions = decision.get("decisions", [])
        if decisions and decisions[0].get("type") == "approve":
            logger.info("✅ 高危命令已获批准: %s", command[:80])
            return
        else:
            logger.warning("❌ 高危命令被拒绝: %s", command[:80])
            raise HighRiskCommandRejected(command, risk)
    else:
        # 未知 resume 格式，安全起见拒绝
        logger.warning("❌ 高危命令审批格式异常，拒绝执行")
        raise HighRiskCommandRejected(command, risk)


class HighRiskCommandRejected(Exception):
    """高危命令被人工拒绝执行。"""

    def __init__(self, command: str, risk: str):
        self.risk = risk
        # 不在错误信息中暴露完整命令
        super().__init__(f"高危命令被拒绝执行（风险：{risk}）")
