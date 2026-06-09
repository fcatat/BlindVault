from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List
from croniter import croniter

from fastapi import APIRouter, Header, HTTPException

from backend.db import (
    list_scheduled_tasks,
    get_scheduled_task,
    save_scheduled_task,
    update_scheduled_task_status,
    delete_scheduled_task,
)
from backend.models import ScheduledTaskResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=List[ScheduledTaskResponse])
async def get_tasks(
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
):
    """获取当前租户和用户的所有定时任务。"""
    tasks = await list_scheduled_tasks(tenant_id=x_tenant_id, user_id=x_user_id)
    return [ScheduledTaskResponse(**t) for t in tasks]


@router.post("/{task_id}/pause")
async def pause_task(
    task_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
):
    """暂停定时任务。"""
    task = await get_scheduled_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != x_user_id:
        raise HTTPException(status_code=403, detail="Permission denied")
        
    await update_scheduled_task_status(task_id, "paused")
    return {"status": "paused", "task_id": task_id}


@router.post("/{task_id}/resume")
async def resume_task(
    task_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
):
    """恢复并重新激活定时任务，重新计算下一次执行时间。"""
    task = await get_scheduled_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != x_user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    now = datetime.now(timezone.utc)
    next_run = now
    if task["cron_expression"]:
        try:
            iter = croniter(task["cron_expression"], now)
            next_run = iter.get_next(datetime)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid cron expression: {str(e)}")
    elif task["delay_seconds"]:
        next_run = now + timedelta(seconds=task["delay_seconds"])
    else:
        next_run = now + timedelta(seconds=10)

    await save_scheduled_task(
        id=task["id"],
        user_id=task["user_id"],
        session_id=task["session_id"],
        tenant_id=task["tenant_id"],
        label=task["label"],
        command=task["command"],
        secret_ref=task["secret_ref"],
        cron_expression=task["cron_expression"],
        delay_seconds=task["delay_seconds"],
        next_run_at=next_run,
        status="active"
    )

    return {
        "status": "active",
        "task_id": task_id,
        "next_run_at": next_run.isoformat(),
    }


@router.delete("/{task_id}")
async def remove_task(
    task_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
):
    """删除计划任务。"""
    task = await get_scheduled_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != x_user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    await delete_scheduled_task(task_id)
    return {"status": "deleted", "task_id": task_id}


@router.get("/{task_id}/logs")
async def get_task_logs(
    task_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
):
    """查询定时任务最近一次执行的详细控制台输出日志。"""
    task = await get_scheduled_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != x_user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {
        "task_id": task_id,
        "last_run_at": task["last_run_at"].isoformat() if task["last_run_at"] else None,
        "last_run_status": task["last_run_status"],
        "output": task["last_run_output"] or "暂无执行日志记录",
    }
