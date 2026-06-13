"""
BlindVault Agent CLI 交互式命令行工具
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langgraph.types import Command

from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings

# 配置日志（CLI 保持简洁）
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)


async def local_subprocess_executor(command: str) -> dict:
    """CLI 本地测试用执行器。
    
    安全机制：生产中必须部署到沙箱 Docker，此处作为 CLI 展示提供本地执行。
    """
    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=60)
        return {
            "stdout": stdout_bytes.decode(errors="replace"),
            "stderr": stderr_bytes.decode(errors="replace"),
            "exit_code": proc.returncode or 0
        }
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {
            "stdout": "",
            "stderr": "执行超时（60秒限制）",
            "exit_code": -1
        }


def print_agent_messages(messages: list[BaseMessage], last_printed_idx: int) -> int:
    """打印新的 Agent 消息。"""
    for idx, msg in enumerate(messages[last_printed_idx:], start=last_printed_idx):
        role = type(msg).__name__
        content = msg.content
        
        # 优化打印展示
        if role == "HumanMessage":
            print(f"\n👤 [用户] {content}")
        elif role == "AIMessage":
            if content:
                print(f"🤖 [Agent] {content}")
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    print(f"⚙️ [工具请求] {tc.get('name')}({tc.get('args')})")
        elif role == "ToolMessage":
            status_indicator = "✅" if not msg.additional_kwargs.get("status") == "error" else "❌"
            print(f"🔌 [工具返回] {status_indicator} 输出: {content[:300]}")
            if len(str(content)) > 300:
                print("   ... (部分输出已省略)")
    return len(messages)


async def main_async():
    print("=" * 60)
    print("         BlindVault 安全运维 Agent 控制终端")
    print("=" * 60)
    
    settings = get_agent_settings()
    print(f"  当前模型: {settings.default_model}")
    print(f"  API 网关: {settings.litellm_base_url}")
    print(f"  Redis:    {settings.redis_url}")
    print("=" * 60)
    print("  提示: 输入 'exit' 或 'quit' 退出终端。")
    print("  测试用密码可用明文输入，系统将自动执行拦截点 A 脱敏加密。")
    print("=" * 60)

    # 1. 创建安全运维 Agent 并注入本地 subprocess 执行器
    agent = create_blindvault_agent(executor=local_subprocess_executor)
    
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    
    last_printed_idx = 0

    while True:
        try:
            user_input = input("\nBlindVault> ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("exit", "quit"):
                print("👋 已退出终端")
                break
            
            # 2. 执行第一轮调用
            result = await agent.ainvoke(
                {"messages": [{"role": "user", "content": user_input}]},
                config=config
            )
            
            # 打印当前产生的消息
            messages = result.get("messages", [])
            last_printed_idx = print_agent_messages(messages, last_printed_idx)
            
            # 3. 循环检查并处理中断暂停状态 (HITL)
            while True:
                state = agent.agent_graph.get_state(config)
                
                pending_interrupts = []
                for task in state.tasks:
                    if task.interrupts:
                        pending_interrupts.extend(task.interrupts)
                
                # 如果没有挂起的中断，说明这轮交互已完成
                if not pending_interrupts:
                    break
                
                # 处理高危人工确认
                interrupt_val = pending_interrupts[0].value
                print(f"\n🛑 [安全审核拦截] 警告：触发高危操作！")
                print(f"   原因: {interrupt_val.get('risk_description', '未知危险模式')}")
                print(f"   命令: {interrupt_val.get('command')}")
                print("-" * 50)
                
                while True:
                    choice = input("   👉 是否批准该命令执行？(Y/yes 批准, N/no 拒绝): ").strip().lower()
                    if choice in ("y", "yes"):
                        decision = "approve"
                        break
                    elif choice in ("n", "no"):
                        decision = "reject"
                        break
                    else:
                        print("   ⚠️ 无效输入，请输入 Y/yes 或 N/no。")
                
                # 发送 resume 决策信号恢复 Graph 运行
                resume_data = {"decisions": [{"type": decision}]}
                print(f"   正在发送审批决策: {decision} ...\n")
                
                result = await agent.ainvoke(Command(resume=resume_data), config=config)
                messages = result.get("messages", [])
                last_printed_idx = print_agent_messages(messages, last_printed_idx)

        except KeyboardInterrupt:
            print("\n👋 已退出终端")
            break
        except Exception as e:
            print(f"\n❌ 终端交互异常: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()


def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
