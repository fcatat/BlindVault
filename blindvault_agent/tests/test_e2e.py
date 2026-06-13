"""
BlindVault Agent 端到端安全与功能集成验收测试 (#22)

验证：
1. 双模型 (GPT/Claude) 均能在 LiteLLM 网关下正常完成对话与脱敏。
2. 拦截点 A：用户贴入明文密码，在 Graph 执行前被入口层预脱敏，进入 State 时已变为 {{secret:sec_xxx}} 占位符。
3. 拦截点 B：高危命令触发暂停，Redis 存储完整状态。
4. S3 泄露检测：扫描 Redis 中所有的 checkpoint 记录，验证不含有任何明文密码。
5. 真实恢复 (resume)：approve 恢复运行，命令带真实密码执行，且 resolve 只执行一次。
"""

from __future__ import annotations

import asyncio
import os
import re
from unittest.mock import patch

import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from langgraph.checkpoint.redis import RedisSaver
from langgraph.types import Command

from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings
from blindvault_agent.security.crypto import decrypt
from blindvault_agent.security.redis_store import SecretStore
from blindvault_agent.tests.conftest import TEST_KEY_RAW


class E2EMockExecutor:
    """E2E 测试用执行器，记录执行命令。"""

    def __init__(self, stdout="E2E Ok", stderr="", exit_code=0):
        self.commands = []
        self._stdout = stdout
        self._stderr = stderr
        self._exit_code = exit_code

    async def __call__(self, command: str) -> dict:
        self.commands.append(command)
        return {
            "stdout": self._stdout,
            "stderr": self._stderr,
            "exit_code": self._exit_code,
        }


@pytest_asyncio.fixture
async def e2e_redis():
    """连接本地真实的 Redis 容器，测试开始前清空当前库。"""
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    client = aioredis.from_url(url, decode_responses=False)  # 用 bytes 便于扫描明文密码
    await client.flushdb()
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def e2e_store(e2e_redis):
    """创建使用真实 Redis 的金库存储。"""
    # decode_responses=True 用于内部正常操作
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    client_str = aioredis.from_url(url, decode_responses=True)
    store = SecretStore(client_str, key_prefix="e2e_test:")
    yield store
    await client_str.aclose()


async def scan_redis_for_plaintext(redis_client: aioredis.Redis, plaintext: str) -> bool:
    """扫描 Redis 中所有 Key 的值，寻找是否存在包含明文密码的项。"""
    plaintext_bytes = plaintext.encode("utf-8")
    
    # 扫描所有 key
    async for key in redis_client.scan_iter(match="*"):
        key_type = await redis_client.type(key)
        key_type_str = key_type.decode()
        
        # 针对不同数据类型读取值
        if key_type_str == "string":
            val = await redis_client.get(key)  # type: ignore
            if val and plaintext_bytes in val:
                return True
        elif key_type_str == "hash":
            fields = await redis_client.hgetall(key)  # type: ignore
            for f_key, f_val in fields.items():
                if plaintext_bytes in f_key or plaintext_bytes in f_val:
                    return True
        elif key_type_str == "list":
            elements = await redis_client.lrange(key, 0, -1)  # type: ignore
            for el in elements:
                if plaintext_bytes in el:
                    return True
        elif key_type_str == "set":
            members = await redis_client.smembers(key)  # type: ignore
            for mem in members:
                if plaintext_bytes in mem:
                    return True
        elif key_type_str == "zset":
            members = await redis_client.zrange(key, 0, -1)  # type: ignore
            for mem in members:
                if plaintext_bytes in mem:
                    return True
                    
    return False


@pytest.mark.asyncio
@pytest.mark.parametrize("model_alias", ["gpt-5.4-mini", "claude-sonnet-4-6"])
async def test_end_to_end_flow(e2e_redis, e2e_store, model_alias):
    """
    完整的 E2E 拦截、暂停、Redis 安全验证和恢复测试。
    
    测试场景：
    1. 用户贴入明文密码并要求执行高危命令。
    2. 入口层预脱敏（拦截 S3 泄露）。
    3. 工具调用前被 HITL 拦截。
    4. 检查 Redis 全库，断言所有 checkpoint 中绝不包含明文密码。
    5. approve 恢复，注入明文密码并成功执行。
    """
    settings = get_agent_settings()
    
    # 验证网关连通性与 API Key 存在
    if not settings.litellm_api_key or settings.litellm_api_key == "PLACEHOLDER":
        pytest.skip("跳过 E2E 测试：未配置 LiteLLM 网关密钥")

    # 1. 初始化 agent，配置 checkpointer 与 mock executor
    checkpointer_ctx = RedisSaver.from_conn_string(settings.redis_url)
    checkpointer = checkpointer_ctx.__enter__()
    checkpointer.setup()

    system_prompt = (
        "你是一个运维助手。当用户要求你执行任何运维命令或 shell 命令时，"
        "你必须且只能调用 secure_shell 工具，将对应的 shell 命令作为 command 参数传入。"
        "哪怕命令中包含密码或连接串，也必须直接把命令传给 secure_shell 工具的 command 参数。"
        "绝对不要直接用文本形式回答，必须且只能执行工具调用！"
    )

    executor = E2EMockExecutor()
    agent = create_blindvault_agent(
        settings=settings,
        model=model_alias,
        store=e2e_store,
        checkpointer=checkpointer,
        executor=executor,
        system_prompt=system_prompt,
    )

    # 2. 构造包含明文密码和高危操作的输入
    secret_pwd = "MySecretSshPassword999!"
    # psql 包含高危的 DROP DATABASE 操作，密码以明文形式贴在连接串中
    user_input = f"请运行命令：psql postgresql://admin:{secret_pwd}@localhost:5432/mydb -c 'DROP DATABASE production'"
    
    thread_id = f"e2e-test-thread-{model_alias}"
    config = {"configurable": {"thread_id": thread_id}}

    # 3. 发起调用，期望因为高危操作触发 interrupt() 暂停
    result = agent.invoke(
        {"messages": [{"role": "user", "content": user_input}]},
        config=config
    )

    # 4. 确认 Agent 处于中断挂起状态
    state = agent.agent_graph.get_state(config)
    pending_interrupts = []
    for task in state.tasks:
        if task.interrupts:
            pending_interrupts.extend(task.interrupts)
            
    assert len(pending_interrupts) > 0, "未能成功触发高危人工审核中断暂停"
    
    # 5. 校验中断数据安全：审批参数绝不含明文密码，且必须含有脱敏占位符
    interrupt_val = pending_interrupts[0].value
    assert secret_pwd not in interrupt_val["command"], "审批的拦截命令中泄露了明文密码"
    assert "DROP DATABASE" in interrupt_val["command"]
    assert "{{secret:sec_" in interrupt_val["command"] or "$SECRET" in interrupt_val["command"]

    # 6. 核心安全验证：【S3 时序泄露检测】
    # 扫描 Redis 中全部 key-value，确认没有任何 checkpoint 包含明文密码
    found_plaintext = await scan_redis_for_plaintext(e2e_redis, secret_pwd)
    assert not found_plaintext, "🚨 严重安全漏洞 (S3 Checkpoint timing leak)：Redis 状态持久化中发现明文密码！"

    # 7. 从金库中校验该密钥已安全加密存入
    # 遍历金库中的 key，获取我们加密存储的那条记录并做解密测试
    all_vault_keys = [k async for k in e2e_redis.scan_iter(match="e2e_test:secret:*")]
    assert len(all_vault_keys) > 0, "Redis 金库中找不到任何加密凭据"
    
    # 解密验证
    decrypted_ok = False
    for k in all_vault_keys:
        # 比如 k 是 e2e_test:secret:sec_live_xxx
        ref = k.decode().replace("e2e_test:secret:", "")
        record = await e2e_store.get_secret(ref)
        if record:
            plain_val = decrypt(record.ciphertext, TEST_KEY_RAW)
            if plain_val == secret_pwd:
                decrypted_ok = True
                break
    assert decrypted_ok, "Redis 金库中存储的密文无法正确解密出原始密码"

    # 8. 恢复执行并批准 (approve)
    resume_data = {"decisions": [{"type": "approve"}]}
    resume_result = agent.invoke(Command(resume=resume_data), config=config)
    
    # 9. 确认恢复后命令被成功执行，且密码被注入
    assert len(executor.commands) == 1, "恢复后命令未能成功触发 executor 执行"
    executed_cmd = executor.commands[0]
    assert secret_pwd in executed_cmd, "执行器中未能成功注入真实密码"
    assert "DROP DATABASE" in executed_cmd

    # 10. 确认 resolve 只被执行了一次，密钥的 read_count 恰好为 1
    # 获取存入金库的那条记录，查看 read_count
    for k in all_vault_keys:
        ref = k.decode().replace("e2e_test:secret:", "")
        record = await e2e_store.get_secret(ref)
        if record:
            plain_val = decrypt(record.ciphertext, TEST_KEY_RAW)
            if plain_val == secret_pwd:
                assert record.read_count == 1, f"密钥被重复解析了：read_count={record.read_count}"
                break

    # 11. 校验回显脱敏
    messages = resume_result.get("messages", [])
    tool_message = None
    for msg in messages:
        if type(msg).__name__ == "ToolMessage":
            tool_message = msg.content
            break
            
    assert tool_message is not None, "未找到工具返回消息"
    assert secret_pwd not in tool_message, "回显脱敏失败，输出中包含明文密码"
    
    # 清理 checkpointer 上下文
    checkpointer_ctx.__exit__(None, None, None)
