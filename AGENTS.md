# AGENTS.md — BlindVault 跨工具协作规约

> 本文件是 Claude Code / Antigravity 等任意 agent IDE 的**唯一事实源**。
> Claude Code 经 `CLAUDE.md` 的 `@AGENTS.md` 导入读取；Antigravity 作环境上下文读取。
> 改架构/决策/规约只改这里，别复制多份。

---

## 1. 项目是什么

BlindVault：一个**独立、自带模型访问能力**的运维 Agent 产品。让没有任何云厂商账户的运维用 LLM Agent 执行运维任务，而 **密码/密钥永不进入模型上下文**、**高危操作强制人工确认**。

当前方向（2026-06）：不再自研 agent 循环，改为给成熟 agent 框架叠加安全层。

## 2. 技术方向（已定）

- **Agent 宿主**：LangChain `create_agent`（LangGraph 1.0 durable runtime）。`langgraph.prebuilt.create_react_agent` 已废弃，统一用 `langchain.agents.create_agent`。
- **模型访问**：经自有 **LiteLLM 网关**分发（GPT + Claude），用户无需云厂商账户；virtual key 做多租户。
- **两个拦截点**（整个产品的核心）：
  - **拦截点 A — 出站脱敏**：一切流向模型的内容必须无密码。落点：单层可逆脱敏（主层）`AgentMiddleware.before_model`。未来 PII 阻断由 LiteLLM 网关层（路线图）接管。
  - **拦截点 B — 执行注入 + 审批**：工具层 resolve + HITL 审批。执行瞬间 resolve 占位符为真密码；高危命令暂停等人工确认。落点：`secure_shell` 工具内 `resolve_secret` + 内置 `HumanInTheLoopMiddleware`（需 checkpointer）。

## 3. 复用 vs 丢弃

- **原样复用**：`backend/crypto.py`、`backend/policy.py`（resolve_secret 9 步校验）、`backend/redis_store.py`、`backend/models.py`、`Dockerfile.sandbox`。
- **丢弃**：`backend/agent/graph.py` 整个自研循环、`approval_block` / `breaker` 节点、自研 SSE 流式。

## 4. 安全铁律（违反 = 密码泄露，最高优先级）

1. **密钥绝不进入会被序列化的状态**：不放进 agent state、不放进 `RunContextWrapper.context`。密码只活在「金库 + 工具执行的瞬间」。
2. **可逆脱敏只走自有金库**：单层可逆脱敏（主层）。原 Agent 内置 `PIIMiddleware` 已弃用，兜底防线统一由 LiteLLM 网关层接管。
3. **guardrail 只在 LiteLLM 翻译层 `/v1/chat/completions` 生效**，禁用 `/anthropic/*` 等原生透传。
4. **LiteLLM 锁可信版本**、校验哈希、自建镜像（曾有 1.82.7/1.82.8 投毒版）。
5. middleware 顺序：确定性正则在前、模型识别在后（便宜的先拦）。
6. **LiteLLM API key 只由部署方在 .env 中维护**，绝不在任何 API/UI 中暴露或允许修改。修改 key 必须直接编辑 .env 并重启服务。

## 5. 安全关键代码 —— 必须人工/强模型 review，不得便宜模型写完直接提交

- 可逆脱敏 middleware（拦截点 A 主层）
- `policy.resolve_secret` 及其调用方
- PII 识别规则 / 高危命令规则

骨架、配置、CLI、测试等非安全关键部分可由便宜模型独立完成。

## 6. 协作规约（强制）

1. **每个任务一次 git 提交**，commit message 说清动了什么。
2. **结束任何会话/任务前，必须往 `PROGRESS.md` 追加一条交接 note**（格式见该文件头部）。这是强制规则，不是可选。
3. 任务规格见 `docs/tasks.md`；按依赖顺序做。
4. 跨工具状态只放仓库文件（Antigravity 的 Knowledge Items 不跨工具共享，不可依赖）。

## 7. 关键文档

- 产品设计：`docs/product-design-secure-agent-layer.md`
- MVP 构建计划：`docs/mvp-build-plan-langgraph.md`
- 任务规格：`docs/tasks.md`
- 进度/交接日志：`PROGRESS.md`
