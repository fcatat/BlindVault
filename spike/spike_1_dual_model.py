"""
Spike 验收 1+2：LiteLLM 双模型路由 + create_agent 工具调用

验证：经 LiteLLM 网关，用 GPT 和 Claude 两个模型分别调通 create_agent 工具调用。
通过标准：两个模型都成功调用 dummy 工具并返回合理结果。
"""
import os
import sys
import datetime

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langchain_core.tools import tool

# ---- 配置 ----
LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "https://aigateway.sunmi.com/v1")
LITELLM_API_KEY = os.environ.get("LITELLM_API_KEY", "sk-jddaKxs8yjzDeniS7lo-wA")

# 网关上可用的模型别名
MODELS = {
    "GPT": "gpt-5.4-mini",
    "Claude": "claude-sonnet-4-6",
}

# ---- Dummy 工具 ----
@tool
def get_current_time() -> str:
    """获取当前系统时间，格式 YYYY-MM-DD HH:MM:SS"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def test_model(model_label: str, model_name: str) -> bool:
    """用指定模型创建 agent 并测试工具调用"""
    print(f"\n{'='*60}")
    print(f"  测试 {model_label}（{model_name}）")
    print(f"{'='*60}")

    try:
        # 所有模型都经 LiteLLM 网关的 OpenAI 兼容接口
        llm = ChatOpenAI(
            model=model_name,
            base_url=LITELLM_BASE_URL,
            api_key=LITELLM_API_KEY,
            temperature=0,
        )

        agent = create_agent(
            model=llm,
            tools=[get_current_time],
            system_prompt="你是一个运维助手。当用户询问时间时，调用 get_current_time 工具。",
        )

        result = agent.invoke({
            "messages": [{"role": "user", "content": "现在几点了？请调用工具告诉我。"}]
        })

        # 检查结果
        messages = result.get("messages", [])
        print(f"\n  消息数量: {len(messages)}")

        # 检查是否有工具调用
        tool_called = False
        final_answer = ""
        for msg in messages:
            msg_type = type(msg).__name__
            print(f"  [{msg_type}] {str(msg.content)[:100]}")
            if msg_type == "ToolMessage":
                tool_called = True
            if msg_type == "AIMessage" and msg.content and not getattr(msg, 'tool_calls', None):
                final_answer = msg.content

        if tool_called:
            print(f"\n  ✅ {model_label} 工具调用成功")
            print(f"  最终回答: {final_answer[:200]}")
            return True
        else:
            print(f"\n  ❌ {model_label} 未触发工具调用")
            return False

    except Exception as e:
        print(f"\n  ❌ {model_label} 异常: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("=" * 60)
    print("  Spike 1: 双模型路由 + 工具调用验证")
    print("=" * 60)
    print(f"  网关: {LITELLM_BASE_URL}")
    print(f"  模型: {list(MODELS.values())}")

    results = {}
    for label, model_name in MODELS.items():
        results[label] = test_model(label, model_name)

    # 汇总
    print(f"\n{'='*60}")
    print("  验收结果汇总")
    print(f"{'='*60}")
    all_pass = True
    for label, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {label}: {status}")
        if not passed:
            all_pass = False

    if all_pass:
        print(f"\n  🎉 验收 1+2 全部通过！")
    else:
        print(f"\n  🚨 验收 1+2 有红灯，需要排查。")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
