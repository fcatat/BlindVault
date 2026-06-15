import asyncio
import os
import uuid
from blindvault_agent.agent import create_blindvault_agent
from blindvault_agent.config import get_agent_settings
from langchain_core.messages import HumanMessage
from blindvault_agent.middleware.reversible_sanitize import make_sync_save_record

async def dummy_executor(command: str) -> dict:
    return {"stdout": "mock", "stderr": "", "exit_code": 0}

async def run_test(model_name: str):
    print(f"\n--- Testing model: {model_name} ---")
    os.environ["BLINDVAULT_DEFAULT_MODEL"] = model_name
    agent = create_blindvault_agent(
        executor=dummy_executor,
        system_prompt=get_agent_settings().system_prompt
    )
    
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        result = agent.invoke({"messages": [HumanMessage(content="删掉测试库 mydb")]}, config=config)
        state = agent.agent_graph.get_state(config)
        pending_interrupts = []
        for task in state.tasks:
            if task.interrupts:
                pending_interrupts.extend(task.interrupts)
                
        if pending_interrupts:
            cmd = pending_interrupts[0].value.get("command")
            print(f"✅ HITL TRIGGERED with command: {cmd}")
        else:
            print("❌ NO INTERRUPT.")
            last_msg = result["messages"][-1]
            if last_msg.type == "ai":
                print(f"AI response: {last_msg.content}")
            else:
                print(f"Last message type: {last_msg.type}")
    except Exception as e:
        print(f"Exception: {e}")

async def main():
    await run_test("gpt-5.4-mini")
    await run_test("claude-sonnet-4-6")

if __name__ == "__main__":
    asyncio.run(main())
