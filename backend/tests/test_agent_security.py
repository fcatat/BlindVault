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
