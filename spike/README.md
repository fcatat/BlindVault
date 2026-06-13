# Phase 0 Spike — 排雷验证

> Task #13：验证 LangChain create_agent + LiteLLM 网关方案的可行性。
> 全部通过后代码可丢弃，不进入生产。

## 验收项

1. **双模型路由 + 工具调用** (`spike_1_dual_model.py`)：经 LiteLLM 网关用 GPT 和 Claude 分别调通工具
2. **HITL + Redis Checkpointer** (`spike_2_hitl.py`)：暂停→状态存 Redis→恢复续跑
3. **自定义 Middleware** (`spike_3_middleware.py`)：`before_model` 能读写发往模型的消息列表

## 运行方式

```bash
# 确保 Redis Stack 运行中（需 RedisJSON + RediSearch 模块）
docker-compose up -d redis

# 逐个验证
.venv/bin/python spike/spike_1_dual_model.py
.venv/bin/python spike/spike_2_hitl.py
.venv/bin/python spike/spike_3_middleware.py
```

## 环境变量

- `LITELLM_BASE_URL`：LiteLLM 网关地址（默认 https://aigateway.sunmi.com）
- `LITELLM_API_KEY`：网关 virtual key
