"""
BlindVault HITL 审批 Middleware 配置（拦截点 B 审批）

🔴 安全关键代码 —— 必须人工/强模型 review

功能：
- 对 secure_shell 工具调用启用 HumanInTheLoopMiddleware
- 高危命令暂停 → 存 Redis checkpoint → 人工 approve/reject → 恢复/拒绝
- 审批状态序列化时不含明文密钥（命令中只有占位符，明文在 resolve 瞬间才注入）

安全铁律：
- 审批时模型和人工看到的都是脱敏后的命令（含占位符 {{secret:xxx}}）
- 明文只在 approve 后、工具执行瞬间由 resolve_secret 注入
- reject 则不执行，明文永远不出现
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from langchain.agents.middleware import HumanInTheLoopMiddleware

logger = logging.getLogger(__name__)


# ============================================================
# 高危命令规则（移植自 backend/tools/secure_shell.py）
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

    返回风险描述（str）或 None（安全）。
    """
    for pattern, description in _COMPILED_HIGH_RISK:
        if pattern.search(command):
            return description
    return None


# ============================================================
# HITL Middleware 工厂
# ============================================================


def create_hitl_middleware() -> HumanInTheLoopMiddleware:
    """
    创建 HITL 审批 middleware。

    拦截 secure_shell 工具调用，要求人工审批。

    使用方式：
        agent = create_agent(
            model=llm,
            tools=[...],
            checkpointer=redis_checkpointer,  # 必须！
            middleware=[
                sanitize_mw,       # 拦截点 A 主层
                pii_backstop_mw,   # 拦截点 A 兜底
                create_hitl_middleware(),  # 拦截点 B 审批
            ],
        )

    审批恢复：
        from langgraph.types import Command
        agent.invoke(
            Command(resume={"decisions": [{"type": "approve"}]}),
            config={"configurable": {"thread_id": thread_id}},
        )
    """
    return HumanInTheLoopMiddleware(
        interrupt_on={
            "secure_shell": {
                "allowed_decisions": ["approve", "reject"],
            },
        },
    )
