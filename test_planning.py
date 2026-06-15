import asyncio
import uuid
import sys
from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings
from langchain_core.messages import HumanMessage

async def dummy_executor(command: str) -> dict:
    return {"stdout": "success", "stderr": "", "exit_code": 0}

async def run_test():
    agent = create_blindvault_agent(
        executor=dummy_executor,
        system_prompt=get_agent_settings().system_prompt
    )
    
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    
    result = agent.invoke({"messages": [HumanMessage(content="装好 nginx 并启动、再验证端口监听")]}, config=config)
    
    plan_called = False
    for msg in result["messages"]:
        if msg.type == "ai" and getattr(msg, "tool_calls", None):
            for tc in msg.tool_calls:
                print(f"AI Tool Call: {tc['name']} - {tc['args']}")
                if tc['name'] == 'record_plan':
                    plan_called = True
        elif msg.type == "tool":
            print(f"Tool Result ({msg.name}): {msg.content}")
        elif msg.type == "ai" and msg.content:
            print(f"AI Message: {msg.content}")
            
    if not plan_called:
        print("❌ ERROR: record_plan was not called!")
        sys.exit(1)
    else:
        print("✅ SUCCESS: record_plan was called successfully.")

if __name__ == "__main__":
    asyncio.run(run_test())
