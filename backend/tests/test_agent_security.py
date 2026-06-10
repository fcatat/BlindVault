import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.agent.graph import run_agent, _is_command_high_risk
from backend.redis_store import SecretStore
from backend.config import get_settings


def test_is_command_high_risk():
    # 测试普通命令放行
    assert not _is_command_high_risk("ls -la /tmp")
    assert not _is_command_high_risk("cat /etc/hosts")

    # 测试高危指令拦截 (单词边界边界)
    assert _is_command_high_risk("rm -rf /")
    assert _is_command_high_risk("rm file.txt")
    assert not _is_command_high_risk("arm_test") # 单词边界，不应误判

    # 测试服务停止和重启
    assert _is_command_high_risk("reboot")
    assert _is_command_high_risk("systemctl stop docker")
    assert _is_command_high_risk("docker rm -f my_container")

    # 测试数据库 SQL
    assert _is_command_high_risk("drop database prod")
    assert _is_command_high_risk("truncate table logs")


@pytest.mark.asyncio
@patch("backend.agent.graph.get_settings")
@patch("langchain_openai.ChatOpenAI")
async def test_agent_max_retries(mock_llm, mock_settings):
    # 配置最大重试为 2
    settings = MagicMock()
    settings.llm_provider = "openai"
    settings.agent_max_retries = 2
    settings.agent_approval_required = True
    settings.agent_high_risk_commands = "rm,mv,reboot"
    mock_settings.return_value = settings

    import uuid
    # 模拟大模型总是返回工具调用（导致进入死循环尝试）
    mock_llm_instance = MagicMock()
    mock_llm_instance.bind_tools.return_value.invoke.side_effect = lambda *args, **kwargs: AIMessage(
        content="",
        tool_calls=[
            {
                "id": f"call_{uuid.uuid4().hex[:8]}",
                "name": "secure_shell",
                "args": {"command": "ls -l"},
            }
        ]
    )
    mock_llm.return_value = mock_llm_instance

    # 模拟工具执行总是成功
    mock_store = MagicMock()
    
    with patch("backend.agent.graph.secure_tool_node", new_callable=AsyncMock) as mock_tool_node:
        async def mock_tool_node_func(state, *args, **kwargs):
            messages = state["messages"]
            last_ai_msg = [m for m in messages if isinstance(m, AIMessage) and m.tool_calls][-1]
            tc_id = last_ai_msg.tool_calls[0]["id"]
            return {
                "messages": [
                    ToolMessage(content='{"stdout": "file1", "stderr": "", "exit_code": 0}', tool_call_id=tc_id)
                ]
            }
        mock_tool_node.side_effect = mock_tool_node_func

        # 运行 Agent，预期由于 loop_count 达到 2，会在第三轮调用工具前被熔断
        res = await run_agent(
            user_message="列出文件",
            store=mock_store,
            user_id="user_123",
            session_id="session_123",
            tenant_id="default",
        )
        print("\nDEBUG AGENT RESPONSE FOR RETRIES:", res)
        # 获取最新的 result 以打印 messages
        print("\nRESULT MESSAGES:")
        # 我们可以通过 mock run_agent 或在这里直接查看它

        assert res["status"] == "error"
        assert "[安全熔断" in res["reply"]


@pytest.mark.asyncio
@patch("backend.agent.graph.get_settings")
@patch("langchain_openai.ChatOpenAI")
async def test_agent_approval_required(mock_llm, mock_settings):
    # 配置
    settings = MagicMock()
    settings.llm_provider = "openai"
    settings.agent_max_retries = 5
    settings.agent_approval_required = True
    settings.agent_high_risk_commands = "rm,mv,reboot"
    mock_settings.return_value = settings

    # 模拟大模型决定执行高危删除命令
    mock_llm_instance = MagicMock()
    mock_llm_instance.bind_tools.return_value.invoke.return_value = AIMessage(
        content="",
        tool_calls=[
            {
                "id": "call_123",
                "name": "secure_shell",
                "args": {"command": "rm -rf /data"},
            }
        ]
    )
    mock_llm.return_value = mock_llm_instance
    mock_store = MagicMock()

    # 1. 第一阶段：未确认执行 (confirmed=False) -> 应该拦截并返回 requires_approval=True
    res1 = await run_agent(
        user_message="删除数据",
        store=mock_store,
        user_id="user_123",
        session_id="session_123",
        tenant_id="default",
        confirmed=False,
    )

    assert res1["status"] == "requires_approval"
    assert res1["requires_approval"] is True
    assert res1["pending_command"] == "rm -rf /data"
    assert "已被硬性拦截" in res1["reply"]

    # 2. 第二阶段：用户确认执行 (confirmed=True) -> 应该放行进入工具节点
    with patch("backend.agent.graph.secure_tool_node", new_callable=AsyncMock) as mock_tool_node:
        mock_tool_node.return_value = {
            "messages": [
                ToolMessage(content='{"stdout": "Success deleted", "stderr": "", "exit_code": 0}', tool_call_id="call_123")
            ]
        }

        # 模拟大模型在工具返回结果后给出最终总结回答
        mock_llm_instance.bind_tools.return_value.invoke.side_effect = [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call_123",
                        "name": "secure_shell",
                        "args": {"command": "rm -rf /data"},
                    }
                ]
            ),
            AIMessage(content="高危删除命令已授权并成功执行。")
        ]

        res2 = await run_agent(
            user_message="删除数据",
            store=mock_store,
            user_id="user_123",
            session_id="session_123",
            tenant_id="default",
            confirmed=True,
        )

        assert res2["status"] == "success"
        assert res2["requires_approval"] is False
        assert "已授权" in res2["reply"]


@pytest.mark.asyncio
async def test_agent_api_history_sanitization(test_client):
    """测试 /api/agent/run 接口是否能自动对 history 中的 user 消息进行脱敏保护。"""
    response = await test_client.post(
        "/api/agent/run",
        json={
            "user_message": "你看着弄",
            "session_id": "session_history_test",
            "history": [
                {"role": "user", "content": "我的密码是 1qazxsw2 帮我登录"},
                {"role": "assistant", "content": "好的，我会为您处理"},
            ],
            "confirmed": False,
        },
        headers={
            "X-User-Id": "user_history_test",
            "X-Session-Id": "session_history_test",
        },
    )
    assert response.status_code == 200
    data = response.json()

    # 因为 history 里的明文密码被脱敏了，所以应该产生了 secret_refs
    assert "secret_refs_used" in data
    assert len(data["secret_refs_used"]) > 0
    ref = data["secret_refs_used"][0]
    assert ref.startswith("sec_live_")

    # 且返回结果中应该包含了 sanitized_input
    assert data["sanitized_input"] == "你看着弄"


@pytest.mark.asyncio
async def test_agent_run_open_source_intercept(test_client, monkeypatch):
    """测试开源版下正则匹配到敏感凭证后被拦截，不调用 Agent 直接返回拦截状态。"""
    from backend.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_model_url", "")

    response = await test_client.post(
        "/api/agent/run",
        json={
            "user_message": "帮我登录，密码是 1qazxsw2",
            "session_id": "session_intercept_test",
            "history": [],
            "confirmed": False,
        },
        headers={
            "X-User-Id": "user_intercept_test",
            "X-Session-Id": "session_intercept_test",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["credential_detected"] is True
    assert data["detected_credential_type"] == "password"
    assert data["status"] == "credential_detected"
    assert data["local_model_configured"] is False
    assert "拦截" in data["reply"]


@pytest.mark.asyncio
async def test_agent_run_enterprise_auto_sanitize(test_client, monkeypatch):
    """测试企业版下正则匹配到敏感凭证后不拦截，而是自动脱敏生成临时凭证并放行执行。"""
    from backend.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_model_url", "http://localhost:8000/v1")

    response = await test_client.post(
        "/api/agent/run",
        json={
            "user_message": "帮我登录，密码是 1qazxsw2",
            "session_id": "session_enterprise_test",
            "history": [],
            "confirmed": False,
        },
        headers={
            "X-User-Id": "user_enterprise_test",
            "X-Session-Id": "session_enterprise_test",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["credential_detected"] is False
    assert data["local_model_configured"] is True
    assert len(data["secret_refs_used"]) > 0
    assert data["secret_refs_used"][0].startswith("sec_live_")


@pytest.mark.asyncio
async def test_agent_run_audit_bypass_leak(test_client, monkeypatch):
    """测试审计层触发明文外泄时，放行指令执行，并在响应中标记 leak_detected 和 leaked_value。"""
    from backend.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_model_url", "")

    # 三元组匹配审计层：IP root 密码
    response = await test_client.post(
        "/api/agent/run",
        json={
            "user_message": "连接到 10.14.101.22 root 1qazxsw2 获取日志",
            "session_id": "session_audit_test",
            "history": [],
            "confirmed": False,
        },
        headers={
            "X-User-Id": "user_audit_test",
            "X-Session-Id": "session_audit_test",
        },
    )
    assert response.status_code == 200
    data = response.json()
    # 应当放行，且 leak_detected=True 标记成功
    assert data["credential_detected"] is False
    assert data["leak_detected"] is True
    assert data["leaked_value"] == "1qazxsw2"


