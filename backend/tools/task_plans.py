import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from croniter import croniter

from backend.db import save_scheduled_task

logger = logging.getLogger(__name__)

# generate_task_plan JSON Schema 定义
GENERATE_TASK_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "description": "按顺序执行的步骤列表，必须拆解为最小粒度、安全的单步操作命令",
            "items": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "步骤的简要标题，例如 '启动 Nginx 容器'"
                    },
                    "command": {
                        "type": "string",
                        "description": "要执行的具体 Shell 命令，如果有密码则用 $SECRET 占位"
                    },
                    "secret_ref": {
                        "type": "string",
                        "description": "可选，该步骤命令需要解密替换使用的凭据引用 {{secret:sec_xxx}} 中的 sec_xxx"
                    }
                },
                "required": ["title", "command"]
            }
        }
    },
    "required": ["steps"]
}

# create_scheduled_task JSON Schema 定义
CREATE_SCHEDULED_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "command": {
            "type": "string",
            "description": "需要定时/延迟执行的 Shell 命令。密码位置使用 $SECRET 占位。"
        },
        "cron_expression": {
            "type": "string",
            "description": "可选。标准 Crontab 表达式，用于周期性任务。例如 '*/10 * * * *' 代表每10分钟，'0 2 * * *' 代表每天凌晨2点。如果是单次延迟任务则留空。"
        },
        "delay_seconds": {
            "type": "integer",
            "description": "可选。延迟执行的秒数，用于单次定时任务。例如 300 代表5分钟后执行。若是周期性 cron 任务则忽略此参数。"
        },
        "secret_ref": {
            "type": "string",
            "description": "可选。该命令执行所需的凭证引用 (如 sec_live_xxx)"
        },
        "label": {
            "type": "string",
            "description": "该计划任务的描述性标签，如 '每天2点备份数据库'"
        }
    },
    "required": ["command", "label"]
}


async def generate_task_plan(steps: list[dict], **kwargs) -> dict:
    """生成复合多步骤执行计划。"""
    logger.info("生成步骤计划: steps_count=%d", len(steps))
    return {
        "status": "plan_generated",
        "steps": steps,
        "message": "多步骤计划已成功生成，等待前端拉起控制面板执行。"
    }


async def create_scheduled_task_tool(
    command: str,
    label: str,
    cron_expression: Optional[str] = None,
    delay_seconds: Optional[int] = None,
    secret_ref: Optional[str] = None,
    **kwargs
) -> dict:
    """在后台创建并调度定时或单次延迟任务。"""
    ctx = kwargs.get("ctx")
    user_id = ctx.user_id if ctx else "default"
    session_id = ctx.session_id if ctx else "default"
    tenant_id = ctx.tenant_id if ctx else "default"

    task_id = f"task_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)

    # 计算下一次运行时间
    next_run_at = now
    if cron_expression:
        try:
            iter = croniter(cron_expression, now)
            next_run_at = iter.get_next(datetime)
        except Exception as e:
            logger.error("Cron 解析错误: %s, expr=%s", str(e), cron_expression)
            return {"error": f"Invalid cron expression: {str(e)}"}
    elif delay_seconds is not None:
        next_run_at = now + timedelta(seconds=delay_seconds)
    else:
        # 默认 10 秒后执行
        next_run_at = now + timedelta(seconds=10)

    try:
        await save_scheduled_task(
            id=task_id,
            user_id=user_id,
            session_id=session_id,
            tenant_id=tenant_id,
            label=label,
            command=command,
            secret_ref=secret_ref,
            cron_expression=cron_expression,
            delay_seconds=delay_seconds,
            next_run_at=next_run_at,
            status="active"
        )
        logger.info("后台定时任务已持久化: id=%s, label=%s, next_run=%s", task_id, label, next_run_at.isoformat())
        return {
            "status": "success",
            "task_id": task_id,
            "label": label,
            "next_run_at": next_run_at.isoformat(),
            "message": f"成功创建定时任务：'{label}'，下次运行时间为 {next_run_at.isoformat()}"
        }
    except Exception as e:
        logger.exception("保存定时任务失败")
        return {"error": f"Failed to save scheduled task: {str(e)}"}
