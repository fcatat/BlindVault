"""
Task #16 验收脚本：LiteLLM 网关配置验证

验收标准：
1. 同一份 agent 代码改 model alias 即可在 GPT/Claude 间切换
2. Virtual key 生效
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from blindvault_agent.config import AgentSettings
from blindvault_agent.agent import create_blindvault_agent


def main():
    print("=" * 60)
    print("  Task #16 验收：LiteLLM 网关配置")
    print("=" * 60)

    base_settings = AgentSettings(
        litellm_base_url="https://aigateway.sunmi.com/v1",
        litellm_api_key=os.environ.get("LITELLM_API_KEY", "sk-jddaKxs8yjzDeniS7lo-wA"),
        redis_url="redis://localhost:6379/0",
    )

    models = {
        "GPT": "gpt-5.4-mini",
        "Claude": "claude-sonnet-4-6",
    }

    results = {}

    for label, model_name in models.items():
        print(f"\n  测试 {label}（{model_name}）...")
        try:
            agent = create_blindvault_agent(settings=base_settings, model=model_name)
            config = {"configurable": {"thread_id": f"verify-16-{label.lower()}"}}
            result = agent.invoke(
                {"messages": [{"role": "user", "content": "请调用 echo 工具，输入 'test'"}]},
                config=config,
            )
            messages = result.get("messages", [])
            tool_called = any(type(m).__name__ == "ToolMessage" for m in messages)
            if tool_called:
                print(f"  ✅ {label} 工具调用成功")
                results[label] = True
            else:
                print(f"  ✅ {label} 连通（未触发工具但返回正常）")
                results[label] = True
        except Exception as e:
            print(f"  ❌ {label} 失败: {e}")
            results[label] = False

    # 汇总
    print(f"\n{'='*60}")
    print("  验收结果汇总")
    print(f"{'='*60}")
    all_pass = True
    for name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {name}: {status}")
        if not passed:
            all_pass = False

    if all_pass:
        print(f"\n  🎉 验收通过：同一份代码改 model alias 即可切换 GPT/Claude，virtual key 生效。")
    else:
        print(f"\n  🚨 验收有红灯。")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
