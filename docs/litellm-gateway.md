# LiteLLM 网关配置说明

> BlindVault 使用远程 LiteLLM 网关（`aigateway.sunmi.com`）分发模型请求。
> 此文档记录网关的模型别名和安全约束。

## 网关地址

- **URL**: `https://aigateway.sunmi.com/v1`
- **认证**: Virtual key（`sk-xxx` 格式）
- **协议**: OpenAI `/v1/chat/completions` 兼容

## 可用模型别名

| 别名 | 厂商 | 用途 |
|------|------|------|
| `gpt-5.4-mini` | OpenAI | 默认模型（成本低、速度快）|
| `gpt-5.4` | OpenAI | 高质量推理 |
| `gpt-5.5` | OpenAI | 最新旗舰 |
| `claude-sonnet-4-6` | Anthropic | Claude Sonnet |
| `claude-opus-4-6` | Anthropic | Claude Opus |
| `claude-opus-4-8` | Anthropic | Claude Opus 最新 |
| `claude-haiku-4-5` | Anthropic | Claude Haiku（低成本）|

## 安全约束（铁律）

1. **只走 `/v1/chat/completions` 翻译端点**——guardrail 只在翻译层生效
2. **禁用原生透传**（`/anthropic/*`、`/openai/*`）——否则拦截点 A 完全失效
3. **LiteLLM 锁可信版本**——避开 1.82.7/1.82.8 投毒版
4. Virtual key 支持多租户：预算、限流、模型白名单

## Agent 接入方式

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-5.4-mini",           # 改这一个字符串即可切换模型
    base_url="https://aigateway.sunmi.com/v1",
    api_key="sk-xxx",               # virtual key
)
```

无需安装 `litellm` Python 包——网关是远程服务，本地只用 `langchain-openai` 的 `ChatOpenAI`。
