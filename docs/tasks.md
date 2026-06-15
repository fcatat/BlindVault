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

---

## #23 演示 Web UI（真连后端）🟢（含 1 处整合注意）
- **目标**：一个能上手体验的网页，连真实 agent，重点突出**脱敏回显**和**高危审批暂停**两个效果。
- **依赖**：#21（BlindVaultAgent 包装器）、#22。
- **文件**：
  - 新增 `blindvault_agent/web.py`（FastAPI，包一层 web API + 服务单页）。
  - 单页前端：内联 HTML+JS 即可（不要去改老的 `frontend/` React 工程，太重）。
- **接口**：
  - `POST /api/chat` body `{message, thread_id}` → 调 `BlindVaultAgent.invoke({"messages":[{"role":"user","content":message}]}, config={"configurable":{"thread_id":...}})`；
    - 若触发高危中断：返回 `{status:"interrupt", pending:{command, risk_description}}`（command 是占位符版，**断言不含明文**）；
    - 否则返回 `{status:"done", reply, tool_output, sanitized_count}`。
  - `POST /api/approve` body `{thread_id, decision}` → 用 `BlindVaultAgent.invoke(Command(resume={"decisions":[{"type":decision}]}), config=...)` 恢复；返回执行结果（含脱敏后的 stdout/stderr）。
- **页面要展示的"效果"**：
  1. **脱敏回显**：执行结果区把工具 stdout/stderr 显示出来，真实密码处显示 `[REDACTED]`；并提示"本轮已生成 N 个临时凭证（密码未进入模型）"。
  2. **高危审批暂停**：命中高危命令时，聊天流停住，弹出审批卡片，显示**占位符版命令** + 风险描述 + 【批准执行】/【拒绝】按钮；点批准才继续、点拒绝则不执行。
- **验收**：
  1. 输入 `psql postgresql://admin:MyPass123@db/app -c 'DROP DATABASE x'` → 页面提示已脱敏、暂停并弹审批卡，卡片里**看不到 MyPass123**（只有 `$SECRET`/`{{secret:...}}`）；
  2. 点【批准】→ 执行，结果区 stdout 里密码显示 `[REDACTED]`；点【拒绝】→ 不执行；
  3. 切 GPT / Claude 两个模型都能跑通。
- **整合坑（重要）**：
  - **resume 必须走 `BlindVaultAgent.invoke(Command(resume=...))`，不能直接调底层 graph** —— 否则 ContextVar 注入的 store/ctx/executor 丢失，工具拿不到依赖。
  - **web 层不要把原始请求体/`message` 写进日志**（脱敏发生在 agent 入口，请求体在到达 agent 前是明文）。
  - 必须注入沙箱 executor（B1 fail-closed），demo 可用 `Dockerfile.sandbox` 的执行器，或一个返回拟真输出的安全 mock executor。
  - 每个浏览器会话用独立 `thread_id`（checkpointer 按 thread 存）。
- **归属**：🟢 非安全关键（展示层）。但完成后仍拿回强模型扫一眼上面 3 个整合坑有没有踩。

---

# Phase 2 — 现代 Agent 能力（详见 docs/phase2-roadmap.md）

## #24 自愈重试移植 🟢（输出后处理触碰脱敏边界，注意顺序）
- **目标**：让 agent 命令失败时能自行诊断、调整、重试，恢复旧版的"诊断增强"观感。
- **依赖**：#19 secure_shell、#21。
- **文件**：`blindvault_agent/tools/secure_shell.py`（或新增 middleware）+ 系统提示词。
- **做法**：
  - create_agent 循环本就让模型看到 ToolMessage 里的报错后自行重试——先确认这条 baseline 生效。
  - 移植旧版 `backend/tools/executor.py` 的诊断增强：识别 `command not found`/`connection refused` 等，在返回里追加排错建议（如"先 apt install X"）。
  - 调系统提示词，鼓励"失败→分析 stderr→修正→重试，连续 3 次同错则换方案"。
- **验收**：给一条会失败的命令（如缺依赖），agent 自动补救并重试成功；过程在日志/返回里可见。
- **坑（🔴 注意）**：诊断增强**必须在密码脱敏之后**追加到 stderr，绝不能把明文带进增强文本。

## #25 任务计划/拆解 + UI 露出 🟢
- **目标**：复杂任务先出计划（todo/步骤）再执行，并在 demo 页显示计划。
- **依赖**：#23 demo UI。
- **文件**：agent 组装处（加 planning 能力）+ `web.py`/前端（显示计划）。
- **做法**：用 `langchain-ai/deepagents`（自带 planning）或 planning middleware；把计划步骤通过接口暴露给前端列出。
- **验收**：输入一个多步运维任务，页面先显示拆解出的步骤清单，再逐步执行。

## #26 适配现有 frontend/ 到新 agent + 执行过程露出 🟢（流式端点含 1 处 🔴）
- **目标**：把现有 `frontend/` React 应用接到新 BlindVault agent，让计划/重试/审批/脱敏回显都在 UI 看得见。**不内联 HTML，用 frontend 工程。**
- **依赖**：#23（web.py 接口）、#24/#25（产生计划/重试事件）。
- **关键前提（已勘查）**：`frontend/` 是旧后端的完整应用，`api.ts` 全是旧接口（secrets CRUD / rules / config / scheduled tasks），新 agent 只有 `/api/chat` + `/api/approve`。**不要去重建旧后端接口**（含已砍的 scheduled tasks）。要"看见"的现代功能全在 **Chat 视图**里。
- **范围（省力策略）**：
  - **复用**：前端外壳（Header / Sidebar / 样式 / i18n / main.tsx）。
  - **以 Chat 为中心适配**：把 `Chat.tsx` 接到新 agent。
  - **其余旧标签页**（Dashboard / RulesConfig / ScheduledTasks / AgentConfig / AddCredentialModal / LocalModel）：先**隐藏或标 "legacy 未接入"**，本轮不重建其后端。
- **后端（web.py 加流式）**：
  - 新增 `GET /api/chat/stream`（SSE），用 `agent.astream_events` 推送事件，事件类型至少：`plan`(record_plan 的 steps 列表) / `tool_start`(工具名+占位符命令) / `tool_end`(脱敏后的 stdout/stderr) / `retry`(自愈重试) / `interrupt`(需审批：占位符命令+风险) / `done`(最终回复)。
  - 保留 `/api/approve`（resume，必须走 BlindVaultAgent 包装器）。
- **前端（adapt Chat）**：
  - 新建一个精简 agent API 客户端（如 `agentApi.ts`），只含 stream + approve；旧 api.ts 不动或按需裁剪。
  - Chat 消费 SSE，渲染**执行时间线**：计划清单（随执行打勾）、每步工具调用、重试、最终回复。
  - 收到 `interrupt` 事件 → 弹**审批卡**（占位符命令 + 风险 + 批准/拒绝），调 /api/approve 后继续。
  - `tool_end` 的输出里把 `[REDACTED]` 高亮；显示"本轮已生成 N 个临时凭证（密码未进模型）"。
  - 每个会话独立 `thread_id`（UUID）。
- **验收**：
  1. 浏览器开 frontend，发一个多步任务（如"装 nginx 并启动、验证端口"）→ 页面**先列出计划步骤**、再**逐步执行**、中途失败**自动重试**全程可见；
  2. 发带高危的命令（DROP DATABASE + 密码）→ 暂停弹**审批卡**（看不到明文）→ 批准后执行、输出里密码显示 `[REDACTED]`；
  3. GPT/Claude 都能跑通。
- **🔴 坑（流式端点安全）**：SSE 只能推**脱敏后**的内容——绝不能把脱敏前的原始输入/明文塞进事件流；tool_end 推的是已 `_redact_output` 的 stdout。web 层不记录 message 日志。这条须强模型复审。
- **归属**：🟢 UI 主体 + 🔴 流式端点（无明文）。完成后拿回复审流式端点。


## #28 接回定时/周期任务 scheduler 🔴（安全敏感，须复审）
- **目标**：支持延迟/cron 后台任务（如每日维护）。
- **依赖**：Batch 1。
- **文件**：移植 `backend/scheduler.py` 适配新结构。
- **坑（🔴）**：后台任务用 `resolve_secret` 解析凭证，须确认 9 步校验、tool_name、明文不落盘；这是 🔴 必须强模型复审。

---

## #29 高危判断交给审批层（生产系统提示词）🔴（改 prompt 即改拒绝行为，须复审）
- **决策（2026-06-14）**：高危操作的判断权归 BlindVault 的 HITL 审批层，**模型不应自行拒绝**高危运维命令——否则合法的高危操作（如 DROP 测试库）到不了审批流，用户体验是"它不干活"。
- **目标**：把这个原则写进**生产默认系统提示词**（不是 demo 里那句粗暴的"绝不拒绝"），让模型把运维意图翻译成 secure_shell 调用、把"要不要执行"交给审批层。
- **依赖**：无（但影响所有对话行为）。
- **文件**：`blindvault_agent/config.py` 的 `system_prompt` 默认值（或独立 prompt 模块）；demo 的 web.py 改为复用生产 prompt。
- **生产 prompt 应传达的原则**（给实现者的要点，措辞可优化）：
  1. 你是运行在 BlindVault 受控环境里的运维执行 Agent，外层有完整的安全架构，你应信任并交给它：
     - 密码已自动脱敏，你只会看到 {{secret:...}} 占位符，绝不要猜测/索取真实密码；
     - 高危命令在执行前有**人工审批关卡**，由人决定批准/拒绝——你**无需自我审查或拒绝**高危操作；
     - 真正灾难级的命令由系统硬规则兜底拦截，与你无关。
  2. 因此：收到运维请求（即便是 DROP DATABASE、rm 这类破坏性操作），直接翻译成 secure_shell 调用，凭证位用 $SECRET 占位；**不要拒答、不要说教、不要反问"你确定吗"**——确认由审批层完成。
  3. 仍要：命令构造准确严谨、执行后验证结果、失败则自愈重试（见 #24）。
- **验收**：
  1. 对话里直接说"删掉测试库 mydb" → 模型调用 secure_shell（命令含 DROP），触发 HITL 审批，而**不是**自己回一句"我不能帮你删数据库"；
  2. GPT 和 Claude 两个模型都验：记录各自的"听话程度"（是否仍偶发自我拒绝）。
- **诚实前提（写进结论，别承诺过头）**：
  - 系统提示词只能**降低**模型层自我拒绝的概率，**不能 100% 保证**——provider 级安全策略对极端请求仍可能拦截，与 system prompt 无关。
  - 因此要**优雅处理残留拒绝**：模型若仍拒答，不要死循环，给用户清晰提示。
  - 模型选型也是杠杆：不同模型听话程度不同，#29 验收顺带产出"哪个模型更适合走审批层"的结论，供路由策略参考。
- **归属**：🔴 改 system prompt = 改模型拒绝/执行行为，属安全相关，须强模型复审。



