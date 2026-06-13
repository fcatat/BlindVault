# BlindVault MVP 构建计划 — LangChain create_agent

> 宿主已定：**LangChain `create_agent`**（LangGraph 1.0 durable runtime）。
> 模型经自有 **LiteLLM 网关**分发（GPT + Claude），用户无需任何云厂商账户。
> 复用资产：`crypto.py` / `policy.py`(resolve_secret 9 步) / `redis_store.py` / `models.py` / `Dockerfile.sandbox`。
> 丢弃：`graph.py` 整个自研循环、`approval_block` / `breaker` 节点、自研 SSE。

---

## 两个拦截点 → LangChain middleware 落点

| 拦截点 | 职责 | 落点 |
|---|---|---|
| A 主层 | 出站内容可逆脱敏，回写金库 | 自定义 `AgentMiddleware.before_model`（扫描完整消息列表）+ 工具输出脱敏 |
| A 兜底 | 不可逆失效保险 | 内置 `PIIMiddleware`（block 模式）+ 自定义凭证识别器；LiteLLM 网关 Presidio 作网络层 backstop |
| B 注入 | 执行瞬间 resolve 占位符为真密码 | `secure_shell` 工具内调 `policy.resolve_secret` |
| B 审批 | 高危命令暂停等人工确认 | 内置 `HumanInTheLoopMiddleware`（`interrupt_on`）+ Redis checkpointer |

---

## Phase 0 — Spike（约 1 天，先排雷）

目标：用最小代码验证四件「方案成立与否」的事。任何一条红灯，先停下来重估，别往上盖楼。

1. LiteLLM 起一个最小实例，配 `gpt-4o` 和 `claude-*` 两个 model alias。
2. `create_agent` + 一个 dummy 工具（如 `echo`），**只改模型字符串**，确认 GPT 和 Claude 都能正常工具调用。
3. 给 dummy 工具挂 `HumanInTheLoopMiddleware`，确认：暂停 → 状态存 **Redis checkpointer** → 恢复后从原处继续。
4. 写一个最小自定义 `AgentMiddleware`，确认 `before_model` 能**读到并改写**发往模型的完整消息列表。

**通过标准**：四条全绿 → 进 Phase 1。

---

## Phase 1 — MVP（约 2–3 周）

按依赖顺序：

1. **工程骨架**：新建应用模块，依赖 `langchain`、`langgraph`、`langchain` Redis checkpointer、`litellm`。锁定 LiteLLM 可信版本（避开 1.82.7/1.82.8 投毒版）。
2. **迁移复用资产**：`crypto.py`、`policy.py`、`redis_store.py`、`models.py` 原样搬入；沙箱沿用 `Dockerfile.sandbox`。
3. **LiteLLM 网关**：`config.yaml` 配 GPT+Claude alias、virtual key（多租户底座）；`create_agent` 的 model 指向网关 `/v1/chat/completions`。
4. **可逆脱敏 middleware（拦截点 A 主层）**：继承 `AgentMiddleware`，移植 `sanitizer` 逻辑——`before_model` 扫描消息、命中凭证则 `encrypt`+存 Redis 金库、替换为 `{{secret:sec_xxx}}`；同样作用于工具输出。
5. **PII 兜底（拦截点 A 兜底）**：加内置 `PIIMiddleware`（**block 模式**）+ 自定义密码/密钥识别器，作为不依赖应用正确性的失效保险。
6. **secure_shell 工具（拦截点 B 注入）**：移植；执行时用 `policy.resolve_secret` 把 `{{secret:...}}` 解析为明文、注入、沙箱执行、输出脱敏。
7. **HITL 审批（拦截点 B 审批）**：`HumanInTheLoopMiddleware` 配 `interrupt_on`，移植 `_is_command_high_risk` 高危规则；approve/reject。
8. **Redis checkpointer**：接到 `create_agent`，支撑审批的暂停-持久化-恢复。
9. **薄入口（API/CLI）**：驱动 `create_agent`，处理「中断 → 等确认 → 恢复」循环，流式输出执行进度。
10. **端到端验收**：见下。

---

## 验收标准（Definition of Done）

- **三条泄露路径，GPT 和 Claude 两种上游下，模型侧都只见 `{{secret:sec_xxx}}`**：
  1. 用户直接在输入里贴密码；
  2. agent 读到含密码的文件（如 `.env`）；
  3. 命令回显里出现密码。
- **高危命令**（如 `rm -rf`）触发暂停，用户确认后从原处恢复执行，turn/历史连续。
- **密码绝不进入会被 checkpointer 序列化的状态**（不放进 agent state / context），只活在金库 + 工具执行的瞬间。

---

## 必守的几条铁律

1. 可逆脱敏只走你自己的金库；内置 `PIIMiddleware` 不可逆，**只做 block 兜底**。
2. middleware 顺序：确定性（正则）在前、模型识别在后（便宜的先拦）。
3. 密钥**绝不**放进 `RunContextWrapper.context` / agent state（会随 checkpoint 序列化外泄）。
4. guardrail 只在 LiteLLM 翻译层 `/v1/chat/completions` 生效，禁用原生透传。
5. LiteLLM 锁版本、校验哈希、自建镜像。
