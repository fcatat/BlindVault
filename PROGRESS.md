# PROGRESS.md — 进度与交接日志

> **交接规则（强制）**：任何 agent 结束会话/任务前，在「交接日志」顶部追加一条，格式如下。
> 谁接手就读最上面一条即可机械恢复。
>
> ```
> ## YYYY-MM-DD HH:MM — <谁/哪个IDE模型>
> - 当前任务：#<id> <标题>
> - 完成度：<如 60%，或 done>
> - 动过的文件：<列表>
> - 下一步具体动作：<一句可执行的话>
> - 卡点/注意：<无 或 描述>
> - 提交：<commit hash 或 未提交>
> ```

---

## 里程碑总览

- [x] 旧版安全审查 + 清理（去内置正则、删 mock、补测试）
- [x] 方向确定：独立产品 + LangChain create_agent + LiteLLM 网关
- [x] 产品设计文档 / MVP 计划 / 任务规格 / 协作脚手架
- [x] Phase 0：Spike 排雷（#13）✅ 四条全绿
- [ ] Phase 1：MVP（#14–#22）
- [ ] 端到端验收（#22）

---

## 交接日志（最新在上）

## 2026-06-13 23:18 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#14 工程骨架 + 依赖
- 完成度：done
- 动过的文件：blindvault_agent/（新建整个包：__init__.py、config.py、agent.py、middleware/、tools/、security/、tests/、verify_skeleton.py）、requirements.txt（锁版本）、pyproject.toml（加 project 元数据 + 新测试路径）
- 验收结果：
  1. ✅ 包导入：blindvault_agent v0.1.0
  2. ✅ 配置加载：pydantic-settings 从 .env + 环境变量加载（env_prefix=BLINDVAULT_，extra=ignore）
  3. ✅ Agent 创建 + Redis 连接：create_blindvault_agent() → CompiledStateGraph，Redis checkpointer 初始化通过
  4. ✅ LiteLLM 连通：echo 工具调用成功（gpt-5.4-mini 经 aigateway.sunmi.com）
- 新包结构：blindvault_agent/{config,agent,middleware/,tools/,security/,tests/}
- 下一步具体动作：开始 #15 迁移复用安全资产（crypto.py/policy.py/redis_store.py/models.py → blindvault_agent/security/）
- 卡点/注意：#15 标 🔴（review 迁移正确性）；迁移时不要改逻辑，仅搬运 + 调 import 路径
- 提交：2043137

## 2026-06-13 23:05 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#13 Phase 0 Spike 排雷
- 完成度：done ✅ 四条验收全绿
- 动过的文件：spike/spike_1_dual_model.py、spike/spike_2_hitl.py、spike/spike_3_middleware.py、spike/README.md、docker-compose.yml（Redis→Redis Stack）、docker-compose.override.yml（加 Redis 端口映射）
- Spike 验收结果：
  1. ✅ 双模型路由：经 LiteLLM 网关（aigateway.sunmi.com），GPT(gpt-5.4-mini) 和 Claude(claude-sonnet-4-6) 都成功调用 `get_current_time` 工具
  2. ✅ HITL + Redis Checkpointer：`HumanInTheLoopMiddleware` 在工具调用处暂停 → Redis 持久化 12 个 checkpoint key → `Command(resume={"decisions":[{"type":"approve"}]})` 恢复执行 → 工具成功返回
  3. ✅ 自定义 Middleware：装饰器式 `@before_model` 成功拦截消息列表，将 `password123` → `{{secret:sec_001}}`、`mysql://root:p@ssw0rd@db:3306` → `{{secret:sec_003}}`；类式 `AgentMiddleware` 也能读取完整消息列表
- 环境变化：Redis 镜像改为 redis/redis-stack-server（langgraph-checkpoint-redis 需要 RedisJSON+RediSearch）；venv 追加安装 langchain 1.3.9、langgraph 1.2.5、langchain-openai、langgraph-checkpoint-redis 0.4.1
- 下一步具体动作：开始 #14 工程骨架 + 依赖锁定
- 卡点/注意：LiteLLM 是远程网关（aigateway.sunmi.com），不需要本地安装 litellm Python 包；HITL resume 格式必须是 `{"decisions": [{"type": "approve"}]}`（非简单字符串）
- 提交：5c80129

## 2026-06-13 — Claude Code (Opus 4.8)
- 当前任务：协作脚手架搭建（AGENTS.md / CLAUDE.md / PROGRESS.md / docs/tasks.md）
- 完成度：done
- 动过的文件：AGENTS.md、CLAUDE.md、PROGRESS.md、docs/tasks.md、docs/product-design-secure-agent-layer.md、docs/mvp-build-plan-langgraph.md
- 下一步具体动作：开始 Phase 0 Spike（#13）—— 起最小 LiteLLM（GPT+Claude alias）+ create_agent dummy 工具，验四条排雷项
- 卡点/注意：安全关键代码（脱敏 middleware / resolve_secret）必须强模型 review，勿便宜模型直接提交
- 提交：未提交
