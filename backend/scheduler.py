import asyncio
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from croniter import croniter
import httpx

from backend.config import get_settings
from backend.db import _get_pool, update_scheduled_task_after_run
from backend.redis_store import get_store
from backend.policy import resolve_secret, SecretResolutionError
from backend.models import ResolveRequest, ExecutionContext

logger = logging.getLogger(__name__)

# 后台任务循环控制
_running = False
_task: Optional[asyncio.Task] = None


async def run_scheduler_loop() -> None:
    """定时任务后台扫描循环。"""
    global _running
    _running = True
    logger.info("BlindVault 定时任务调度 Worker 已启动")

    while _running:
        try:
            pool = _get_pool()
        except RuntimeError:
            # 数据库尚未初始化
            await asyncio.sleep(2)
            continue

        try:
            now = datetime.now(timezone.utc)
            # 1. 捞出所有 active 且已经到达下一次执行时间的项目
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT id, user_id, session_id, tenant_id, label, command, 
                           secret_ref, cron_expression, delay_seconds, next_run_at, status
                    FROM scheduled_tasks
                    WHERE status = 'active' AND next_run_at <= $1
                    """,
                    now
                )
            
            for row in rows:
                task_dict = dict(row)
                logger.info("调度执行定时任务: id=%s, label=%s", task_dict["id"], task_dict["label"])
                # 异步运行该任务，防止阻塞主循环
                asyncio.create_task(_execute_task(task_dict))

        except Exception as e:
            logger.error("定时任务调度扫描发生异常: %s", str(e), exc_info=True)

        await asyncio.sleep(5)  # 每5秒扫描一次


async def _execute_task(task: Dict[str, Any]) -> None:
    """在后台执行一个定时任务。"""
    task_id = task["id"]
    command = task["command"]
    secret_ref = task["secret_ref"]
    cron_expr = task["cron_expression"]

    real_secrets_list = []
    final_command = command
    now_run = datetime.now(timezone.utc)
    settings = get_settings()

    # 1. 解析密码引用（如果配置了 secret_ref，且命令包含 $SECRET 占位符）
    if secret_ref:
        try:
            store = await get_store()
            ctx = ExecutionContext(
                user_id=task["user_id"],
                session_id=task["session_id"],
                tenant_id=task["tenant_id"],
                tool_name="secure_shell"
            )
            real_secret = await resolve_secret(
                store=store,
                ctx=ctx,
                request=ResolveRequest(
                    secret_ref=secret_ref,
                    requested_use="scheduler_shell_command",
                    destination=""
                )
            )
            real_secrets_list.append(real_secret)
            final_command = command.replace("$SECRET", real_secret)
        except SecretResolutionError as e:
            logger.error("定时任务解析凭据失败: task_id=%s, error=%s", task_id, str(e))
            await _handle_task_failure(task, now_run, f"Secret 解析失败: {str(e)}")
            return
        except Exception as e:
            logger.error("定时任务加载凭据系统异常: task_id=%s, error=%s", task_id, str(e))
            await _handle_task_failure(task, now_run, f"凭证服务连通异常: {str(e)}")
            return

    # 2. 自动代换命令中其他可能出现的 {{secret:sec_xxx}} 加密占位符
    pattern_curly = re.compile(r"\{\{secret:(sec_(?:live|test)_[A-Za-z0-9_-]+)\}\}")
    for match in pattern_curly.finditer(command):
        ref = match.group(1)
        try:
            store = await get_store()
            ctx = ExecutionContext(
                user_id=task["user_id"],
                session_id=task["session_id"],
                tenant_id=task["tenant_id"],
                tool_name="secure_shell"
            )
            val = await resolve_secret(
                store=store,
                ctx=ctx,
                request=ResolveRequest(
                    secret_ref=ref,
                    requested_use="scheduler_shell_command_multi",
                    destination=""
                )
            )
            real_secrets_list.append(val)
            final_command = final_command.replace(match.group(0), val)
        except Exception as e:
            logger.warning("定时任务解析占位符失败: task_id=%s, ref=%s, error=%s", task_id, ref, str(e))

    # 3. 将命令发送至诊断隔离沙箱执行
    sandbox_url = f"{settings.sandbox_url.rstrip('/')}/execute"
    stdout = ""
    stderr = ""
    exit_code = -1
    success = False

    try:
        async with httpx.AsyncClient(timeout=65.0) as client:
            resp = await client.post(sandbox_url, json={"command": final_command})
            if resp.status_code == 200:
                res_data = resp.json()
                stdout = res_data.get("stdout", "")
                stderr = res_data.get("stderr", "")
                exit_code = res_data.get("exit_code", -1)
                success = (exit_code == 0)
            else:
                stderr = f"沙箱异常响应: HTTP {resp.status_code}\n{resp.text}"
    except Exception as e:
        logger.error("定时任务连接沙箱失败: task_id=%s, error=%s", task_id, str(e))
        stderr = f"无法连接到沙箱执行环境: {str(e)}"

    # 4. 对输出内容进行安全脱敏，屏蔽明文密码
    for secret in real_secrets_list:
        if secret and secret in stdout:
            stdout = stdout.replace(secret, "[REDACTED]")
        if secret and secret in stderr:
            stderr = stderr.replace(secret, "[REDACTED]")

    # 清除内存密码
    if 'real_secrets_list' in locals():
        for secret in real_secrets_list:
            del secret
        del real_secrets_list

    # 5. 更新任务状态与日志
    log_output = f"--- STDOUT ---\n{stdout.strip()}\n\n--- STDERR ---\n{stderr.strip()}".strip()
    last_run_status = "success" if success else "failed"

    if cron_expr:
        try:
            # 周期性任务，计算下一次运行时间
            iter = croniter(cron_expr, now_run)
            next_run = iter.get_next(datetime)
            await update_scheduled_task_after_run(
                task_id=task_id,
                last_run_at=now_run,
                last_run_status=last_run_status,
                last_run_output=log_output,
                next_run_at=next_run
            )
            logger.info("定时任务执行完毕，已安排下一次运行: task_id=%s, next_run=%s", task_id, next_run.isoformat())
        except Exception as e:
            logger.error("计算 Cron 下一次执行时间失败: task_id=%s, cron=%s, error=%s", task_id, cron_expr, str(e))
            # 退化为 400 延迟保护
            next_run = now_run + timedelta(seconds=600)
            await update_scheduled_task_after_run(
                task_id=task_id,
                last_run_at=now_run,
                last_run_status="failed",
                last_run_output=f"{log_output}\n\n[ERROR] 计算下一次 Cron 触发失败: {str(e)}",
                next_run_at=next_run,
                status="failed"
            )
    else:
        # 单次延迟任务，标记为已完成
        await update_scheduled_task_after_run(
            task_id=task_id,
            last_run_at=now_run,
            last_run_status=last_run_status,
            last_run_output=log_output,
            next_run_at=now_run,
            status="completed" if success else "failed"
        )
        logger.info("单次延时任务执行完毕: task_id=%s, final_status=%s", task_id, last_run_status)


async def _handle_task_failure(task: Dict[str, Any], run_time: datetime, reason: str) -> None:
    """定时任务辅助处理密码解析等前置失败。"""
    task_id = task["id"]
    cron_expr = task["cron_expression"]
    log_output = f"[前置失败] {reason}"

    if cron_expr:
        try:
            iter = croniter(cron_expr, run_time)
            next_run = iter.get_next(datetime)
            await update_scheduled_task_after_run(
                task_id=task_id,
                last_run_at=run_time,
                last_run_status="failed",
                last_run_output=log_output,
                next_run_at=next_run
            )
        except Exception:
            next_run = run_time + timedelta(seconds=600)
            await update_scheduled_task_after_run(
                task_id=task_id,
                last_run_at=run_time,
                last_run_status="failed",
                last_run_output=log_output,
                next_run_at=next_run,
                status="failed"
            )
    else:
        await update_scheduled_task_after_run(
            task_id=task_id,
            last_run_at=run_time,
            last_run_status="failed",
            last_run_output=log_output,
            next_run_at=run_time,
            status="failed"
        )


def start_scheduler() -> asyncio.Task:
    """在后台开启调度器 Worker。"""
    global _task, _running
    if _task is None or _task.done():
        _running = True
        _task = asyncio.create_task(run_scheduler_loop())
    return _task


async def stop_scheduler() -> None:
    """优雅停止调度器 Worker。"""
    global _running, _task
    _running = False
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
    logger.info("BlindVault 定时任务调度 Worker 已停止")
