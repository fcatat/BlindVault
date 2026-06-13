# docs/tasks.md — 任务规格（spec-per-task）

> 给便宜模型/任意 IDE 照着执行用。每条自包含：目标 / 依赖 / 文件 / 验收 / 坑 / 归属。
> 先读 `AGENTS.md`（规约 + 安全铁律）。按 ID 顺序做。做完更新 `PROGRESS.md` 并提交。
> 归属标记：🟢 便宜模型可独立完成 ｜ 🔴 安全关键，须强模型 review 后才提交。

---

## #13 Phase 0 Spike 排雷 🟢（结论需人确认）
- **目标**：用最小代码验证四件方案成立性，全绿才进 Phase 1。
- **依赖**：无。
- **文件**：临时 `spike/` 目录，可丢弃。
- **验收**：
  1. LiteLLM 配 `gpt-4o` + `claude-*` 两 alias，`create_agent` 只改模型字符串，两者都能正常工具调用；
  2. dummy 工具挂 `HumanInTheLoopMiddleware`：暂停 → 状态存 Redis checkpointer → 恢复续跑；
  3. 自定义 `AgentMiddleware.before_model` 能读到并改写发往模型的完整消息列表。
- **坑**：LiteLLM 锁可信版本（避开 1.82.7/1.82.8）。
- **任一红灯**：停下重估，勿继续。

## #14 工程骨架 + 依赖 🟢
- **目标**：建新应用模块与依赖。
- **依赖**：#13 通过。
- **文件**：`pyproject.toml`/`requirements.txt`（加 langchain、langgraph、langchain redis checkpointer、litellm）、新包目录。
- **验收**：空 `create_agent` 能启动、能连 LiteLLM、能连 Redis。
- **坑**：LiteLLM 版本 pin + 哈希校验。

## #15 迁移复用安全资产 🔴（review 迁移正确性）
- **目标**：把现有安全资产原样搬入新结构。
- **依赖**：#14。
- **文件**：搬 `backend/crypto.py`、`backend/policy.py`、`backend/redis_store.py`、`backend/models.py`；沙箱沿用 `Dockerfile.sandbox`。
- **验收**：`policy.resolve_secret` 现有单测（test_policy.py 全部，含 9 步校验）在新结构下全绿。
- **坑**：不要趁迁移改逻辑；仅搬运 + 调 import 路径。

## #16 LiteLLM 网关配置 🟢
- **目标**：网关可路由 GPT/Claude，create_agent 指过去。
- **依赖**：#14。
- **文件**：`litellm/config.yaml`、compose 服务项。
- **验收**：同一份 agent 代码改 model alias 即可在 GPT/Claude 间切换；virtual key 生效。
- **坑**：必须走 `/v1/chat/completions`，禁用原生透传。

## #17 可逆脱敏 middleware（拦截点 A 主层）🔴
- **目标**：把 `sanitizer` 逻辑做成自定义 `AgentMiddleware`，可逆 + 回写金库。
- **依赖**：#15、#16。
- **文件**：新 `middleware/reversible_sanitize.py`；复用 `crypto`/`redis_store`/`models`。
- **验收**：`before_model` 命中凭证 → encrypt 存金库 → 原文替换为 `{{secret:sec_xxx}}`；工具输出同样处理；模型侧拿不到明文。
- **坑（铁律）**：占位符→明文映射只存金库，**绝不进 agent state / context**；确定性正则在前、模型识别在后。

## #18 PII 兜底 middleware（拦截点 A 兜底）🔴
- **目标**：内置 `PIIMiddleware`（block 模式）+ 自定义密码/密钥识别器，作失效保险。
- **依赖**：#17。
- **文件**：middleware 注册处 + 自定义识别器配置。
- **验收**：故意让主层漏一个密钥，兜底层 block 整个请求。
- **坑**：兜底层不可逆，**不回写金库**，角色仅为 backstop。

## #19 secure_shell 工具（拦截点 B 注入）🔴
- **目标**：移植工具，执行瞬间 resolve 占位符为明文。
- **依赖**：#15。
- **文件**：`tools/secure_shell.py`（移植自 `backend/tools/secure_shell.py`）。
- **验收**：`{{secret:...}}` / `$SECRET` / 裸 `sec_live_xxx` 三种引用都能 resolve、注入、沙箱执行；危险命令拦截；回显脱敏；现有 test_tools.py 全绿。
- **坑**：resolve 后明文用完即弃，不写入任何会被序列化的地方。

## #20 HITL 审批 + Redis checkpointer（拦截点 B 审批）🔴
- **目标**：高危命令暂停等人工确认，可恢复。
- **依赖**：#19、#14（checkpointer）。
- **文件**：middleware 配置 + checkpointer 接线；移植 `_is_command_high_risk` 规则。
- **验收**：高危命令（如 `rm -rf`）触发暂停 → 存 Redis → approve 后从原处恢复；reject 则不执行。
- **坑**：审批状态序列化时确认不含明文密钥。

## #21 薄入口 API/CLI 🟢
- **目标**：驱动 create_agent，处理中断→确认→恢复循环，流式输出。
- **依赖**：#17–#20。
- **文件**：`app/main.py` 或 CLI 入口。
- **验收**：一轮完整对话可跑通，含一次高危审批暂停-恢复，进度流式可见。

## #22 端到端验收 🔴
- **目标**：验证两个拦截点在双上游下都成立。
- **依赖**：#17–#21。
- **文件**：`tests/e2e/`。
- **验收**：
  1. 三条泄露路径（贴密码 / 读 `.env` / 命令回显）在 **GPT 和 Claude** 下模型侧都只见 `{{secret:sec_xxx}}`；
  2. 高危命令暂停-确认-恢复，turn/历史连续；
  3. 抽查 checkpoint 序列化内容，确认无明文密钥。
