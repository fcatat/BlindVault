import pytest
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

from backend.config import get_settings
from backend.db import (
    init_db,
    save_scheduled_task,
    list_scheduled_tasks,
    get_scheduled_task,
    update_scheduled_task_status,
    delete_scheduled_task,
)
from backend.scheduler import _execute_task


@pytest.mark.asyncio
async def test_scheduled_task_db_crud():
    """验证计划任务的数据库 CRUD 操作。"""
    settings = get_settings()
    # 连接测试数据库
    await init_db(settings.database_url)

    task_id = f"test_task_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)

    # 1. 保存任务
    await save_scheduled_task(
        id=task_id,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        label="Test Cron Task",
        command="echo 'test' && date",
        secret_ref=None,
        cron_expression="*/5 * * * *",
        delay_seconds=None,
        next_run_at=now + timedelta(minutes=5),
        status="active"
    )

    # 2. 查询单个任务
    task = await get_scheduled_task(task_id)
    assert task is not None
    assert task["label"] == "Test Cron Task"
    assert task["status"] == "active"
    assert task["cron_expression"] == "*/5 * * * *"

    # 3. 列出任务
    tasks = await list_scheduled_tasks(tenant_id="default", user_id="test_user")
    assert len(tasks) >= 1
    assert any(t["id"] == task_id for t in tasks)

    # 4. 更新状态为 paused
    await update_scheduled_task_status(task_id, "paused")
    task = await get_scheduled_task(task_id)
    assert task["status"] == "paused"

    # 5. 删除任务
    await delete_scheduled_task(task_id)
    task = await get_scheduled_task(task_id)
    assert task is None


@pytest.mark.asyncio
async def test_scheduled_task_execution_mocked():
    """验证定时任务在 Worker 中的后台执行逻辑（Mock 沙箱）。"""
    settings = get_settings()
    await init_db(settings.database_url)

    task_id = f"test_task_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)

    await save_scheduled_task(
        id=task_id,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
        label="Test Command Run",
        command="echo '$SECRET' && uptime",
        secret_ref=None,
        cron_expression=None,
        delay_seconds=10,
        next_run_at=now,
        status="active"
    )

    task = await get_scheduled_task(task_id)

    from unittest.mock import MagicMock
    # Mock httpx.AsyncClient.post 来模拟沙箱执行
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "stdout": "12:00:01 up 10 mins, load average: 0.10",
        "stderr": "",
        "exit_code": 0
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        await _execute_task(task)

    # 验证执行完后状态是否更新为 completed 且有执行结果
    updated_task = await get_scheduled_task(task_id)
    assert updated_task["status"] == "completed"
    assert updated_task["last_run_status"] == "success"
    assert "load average" in updated_task["last_run_output"]

    # 清除测试任务
    await delete_scheduled_task(task_id)


@pytest.mark.asyncio
async def test_api_run_plan_step(test_client):
    """验证单步运行 API (POST /api/agent/run_plan_step)。"""
    mock_res = {
        "status": "success",
        "stdout": "Step execution success",
        "stderr": "",
        "exit_code": 0
    }

    with patch("backend.api.agent.secure_shell", return_value=mock_res) as mock_ssh:
        response = await test_client.post(
            "/api/agent/run_plan_step",
            json={
                "command": "echo 'step test'",
                "secret_ref": None,
                "session_id": "test_session_id"
            },
            headers={
                "X-User-Id": "test_user",
                "X-Tenant-Id": "default"
            }
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["exit_code"] == 0
    assert data["stdout"] == "Step execution success"
    mock_ssh.assert_called_once()
