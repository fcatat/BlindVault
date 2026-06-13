"""
BlindVault Agent — 安全运维 Agent 层

基于 LangChain create_agent (LangGraph runtime) + LiteLLM 网关。
核心能力：出站脱敏（密码绝不进模型上下文）+ 执行注入 + 高危人工审批。
"""

__version__ = "0.1.0"
