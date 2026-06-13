import asyncio
import uuid
from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings
from langchain_core.messages import HumanMessage

async def dummy_executor(command: str) -> dict:
    return {"stdout": "", "stderr": "bash: mysql: command not found", "exit_code": 127}

async def run_test():
    agent = create_blindvault_agent(
        executor=dummy_executor,
        system_prompt=get_agent_settings().system_prompt
    )
    
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    
    # 强制模型不带 secret_ref 参数，以便直接执行并触发 dummy_executor 的 127 错误
    result = agent.invoke({"messages": [HumanMessage(content="帮我连上 mysql 执行 show databases（注意不要传 secret_ref 参数），如果失败请自己重试分析")]}, config=config)
    for msg in result["messages"]:
        if msg.type == "ai" and getattr(msg, "tool_calls", None):
            print(f"AI Tool Call: {msg.tool_calls[0]['name']} - {msg.tool_calls[0]['args']}")
        elif msg.type == "tool":
            print(f"Tool Result: {msg.content}")
        elif msg.type == "ai" and msg.content:
            print(f"AI Message: {msg.content}")

if __name__ == "__main__":
    asyncio.run(run_test())
