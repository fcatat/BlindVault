"""
BlindVault 数据模型

定义请求/响应/内部数据结构。
关键安全原则：任何返回前端的模型**绝不**包含 value 或 ciphertext 字段。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, SecretStr, Field


# ============================================================
# 枚举
# ============================================================


class SecretStatus(str, Enum):
    """Secret 生命周期状态"""
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"  # read_count >= max_reads


class SecretType(str, Enum):
    """Secret 类型分类"""
    PASSWORD = "password"
    API_KEY = "api_key"
    TOKEN = "token"
    DATABASE_PASSWORD = "database_password"
    SSH_KEY = "ssh_key"
    OTHER = "other"


# ============================================================
# 请求模型
# ============================================================


class CreateSecretRequest(BaseModel):
    """创建 secret 的请求体。value 使用 SecretStr 防止意外序列化。"""
    secret_type: SecretType = SecretType.PASSWORD
    label: str = Field(..., min_length=1, max_length=256, description="Secret 的人类可读标签")
    value: SecretStr = Field(..., description="真实 secret 值（不会被记录或返回）")
    allowed_tools: list[str] = Field(
        default_factory=lambda: ["secure_shell"],
        description="允许使用此 secret 的工具列表",
    )
    allowed_destinations: list[str] = Field(
        default_factory=list,
        description="允许的目标地址列表（origin 级别，如 https://example.com）",
    )
    ttl_seconds: int = Field(default=3600, ge=60, le=86400, description="过期时间（秒）")
    max_reads: int = Field(default=1, ge=1, le=999999, description="最大读取次数")


# ============================================================
# 内部存储模型（Redis）
# ============================================================


class SecretRecord(BaseModel):
    """存储在 Redis 中的完整 secret 记录。"""
    secret_ref: str
    user_id: str
    session_id: str
    tenant_id: str
    label: str
    secret_type: SecretType
    ciphertext: str  # AES-GCM 加密后的 base64 字符串
    allowed_tools: list[str]
    allowed_destinations: list[str]
    created_at: datetime
    expires_at: datetime
    read_count: int = 0
    max_reads: int = 1
    status: SecretStatus = SecretStatus.ACTIVE


# ============================================================
# 响应模型（绝不包含 value / ciphertext）
# ============================================================


class SecretResponse(BaseModel):
    """创建 secret 后的返回体。只包含引用信息，不含真实值。"""
    secret_ref: str
    placeholder: str  # {{secret:sec_xxx}}
    label: str
    secret_type: SecretType
    allowed_tools: list[str]
    allowed_destinations: list[str]
    expires_at: datetime
    reads_left: int
    status: SecretStatus


class SecretMetadataResponse(BaseModel):
    """Secret 列表中的元数据项。"""
    secret_ref: str
    label: str
    secret_type: SecretType
    allowed_tools: list[str]
    allowed_destinations: list[str]
    expires_at: datetime
    reads_left: int
    status: SecretStatus


# ============================================================
# 执行上下文模型
# ============================================================


class ExecutionContext(BaseModel):
    """
    工具执行上下文。由服务端构造，不信任客户端传入的 user_id/session_id。
    """
    user_id: str
    session_id: str
    tenant_id: str
    tool_name: str


class ResolveRequest(BaseModel):
    """Secret 解析请求。"""
    secret_ref: str
    requested_use: str = "default"  # 用途说明，如 "password", "api_key"
    destination: str = ""  # 目标地址，如 "https://example.com"


# ============================================================
# Agent 相关模型
# ============================================================


class AgentRunRequest(BaseModel):
    """Agent 运行请求。"""
    user_message: str = Field(..., min_length=1, description="用户消息")
    session_id: str = Field(..., min_length=1, description="会话 ID")
    history: list[dict] = Field(default_factory=list, description="对话历史 [{role, content}]")
    confirmed: bool = Field(default=False, description="高危操作是否已被用户确认")


class TaskPlanStep(BaseModel):
    """单步执行计划步骤。"""
    index: int
    title: str
    command: str
    secret_ref: Optional[str] = None
    status: str = "pending"  # pending | running | success | failed | skipped
    stdout: Optional[str] = None
    stderr: Optional[str] = None


class TaskPlan(BaseModel):
    """多步骤任务计划。"""
    id: str
    steps: list[TaskPlanStep]


class AgentRunResponse(BaseModel):
    """Agent 运行响应。"""
    reply: str
    tool_calls: list[dict] = Field(default_factory=list)
    secret_refs_used: list[str] = Field(default_factory=list)
    sanitized_input: str = Field(default="", description="脱敏后的用户输入，用于构建安全的对话历史")
    leak_detected: bool = Field(default=False, description="是否检测到敏感信息泄漏至模型")
    leaked_value: Optional[str] = Field(default=None, description="泄漏的敏感明文内容")
    status: str = Field(default="success", description="执行状态：success | requires_approval | error | plan_generated")
    requires_approval: bool = Field(default=False, description="是否需要用户确认")
    pending_command: Optional[str] = Field(default=None, description="等待审批的高危命令")
    triggered_rule: Optional[str] = Field(default=None, description="触发的高危拦截规则")
    plan: Optional[TaskPlan] = Field(default=None, description="多步骤执行计划（若生成）")


class RunPlanStepRequest(BaseModel):
    """单步计划执行请求。"""
    command: str = Field(..., min_length=1, description="待执行命令")
    secret_ref: Optional[str] = Field(default=None, description="绑定的凭据引用")
    session_id: str = Field(..., min_length=1, description="会话 ID")


class RunPlanStepResponse(BaseModel):
    """单步计划执行结果。"""
    exit_code: int
    stdout: str
    stderr: str
    status: str


class ScheduledTaskResponse(BaseModel):
    """定时/计划任务详情。"""
    id: str
    user_id: str
    session_id: str
    tenant_id: str
    label: str
    command: str
    secret_ref: Optional[str] = None
    cron_expression: Optional[str] = None
    delay_seconds: Optional[int] = None
    next_run_at: datetime
    status: str
    created_at: datetime
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_run_output: Optional[str] = None



