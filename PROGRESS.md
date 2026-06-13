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

## 2026-06-14 00:17 — Antigravity (Claude Opus 4.6 Thinking) — B1/B2/S1/S2 修复
- 范围：修复安全 review 中 2 个 🔴 Blocker + 2 个 🟠 Should-fix
- 修复明细：
  - **B1 [#19] fail-closed**：删除本地 subprocess 回退，无 executor 直接拒绝执行。测试 `test_fail_closed_no_executor` 验证。
  - **B2 [#20] HITL 接线**：移除 HumanInTheLoopMiddleware 的无差别拦截，改为 `check_and_interrupt_if_high_risk()` 在工具内部按高危规则有条件触发 LangGraph `interrupt()`。非高危命令不审批。
  - **S1 [#17+#18] 扫描覆盖**：新增 `msg_utils.py`，`extract_scannable_texts()` 覆盖 str/list content + tool_calls args；`rebuild_content()`/`rebuild_tool_calls()` 在所有位置执行替换。两层 middleware 均已接入。测试 `test_middleware_list_content`、`test_middleware_tool_calls_args`、`test_middleware_blocks_list_content`、`test_middleware_blocks_tool_call_args` 验证。
  - **S2 [#18] 香农熵**：新增 `_shannon_entropy()` + `_detect_high_entropy_strings()`，对 20+ 字符 token 计算信息熵（阈值 4.0 bits/char），覆盖无已知前缀的通用密钥。白名单排除 secret_ref/URL/hex hash/snake_case 变量名。测试 `test_detect_generic_high_entropy`、`test_no_detect_normal_long_word`、`test_no_detect_hex_hash`、`test_detect_mixed_case_numbers` 验证。
- 动过的文件：
  - 改 blindvault_agent/tools/secure_shell.py（B1 fail-closed）
  - 改 blindvault_agent/middleware/hitl.py（B2 重构）
  - 改 blindvault_agent/middleware/reversible_sanitize.py（S1 扫描扩展）
  - 改 blindvault_agent/middleware/pii_backstop.py（S1 + S2 香农熵）
  - 新增 blindvault_agent/middleware/msg_utils.py（S1 文本提取工具）
  - 改 blindvault_agent/tests/ 全部 4 个测试文件（新增 9 个测试）
- 验收结果：**89 个测试全绿**（policy 15 + 脱敏 20 + PII 20 + shell 14 + HITL 18 + 余 2 = 89）
- S3 按指示留到 #21
- 状态：🔴 **待复审**

## 2026-06-14 — Claude Code (Opus 4.8) — 🔴 安全 REVIEW 结论
- 范围：#15 迁移 + #17 可逆脱敏 + #18 PII 兜底 + #19 secure_shell + #20 HITL
- **#15 迁移：通过 ✅** crypto/policy/redis_store/models 与 backend/ 逻辑字节级一致（仅 import 路径），9 步校验链完整。可提交。
- **结论：#17/#18 方向对但要补盲区；#19/#20 各有 1 个 blocker。修掉下列 🔴/🟠 再提交。**

### 🔴 Blocker（必须改）
- **B1 [#19] secure_shell 默认本地 shell 执行 = 沙箱逃逸风险。** 未注入 `executor` 时回退到 `create_subprocess_shell` 在宿主直接跑（带明文密码 + 危险命令仅弱黑名单）。改为 **fail-closed**：无 executor 直接拒绝执行，不许默默本地跑。生产必须注入沙箱 executor。
- **B2 [#20] HITL 高危判定未接线。** `is_command_high_risk`（13 条规则）是死代码；`create_hitl_middleware` 对**所有** secure_shell 调用都拦审批。要么把高危过滤接上（按设计：高危才拦），要么明确产品决定"全部命令都审批"并删掉死代码。

### 🟠 Should-fix（泄露面，强烈建议）
- **S1 [#17+#18] 只扫 `msg.content` 且仅当 str。** list/多模态 content、以及 AIMessage 的 `tool_calls` 参数里的密钥**两层都漏**。至少处理 list-form content blocks，并考虑扫 tool_call args。
- **S2 [#18] 兜底层"高熵"实为前缀匹配。** `_PATTERN_HIGH_ENTROPY` 只认已知前缀(sk/ghp/AKIA/eyJ…)；无前缀的通用密钥 + 无 `password=` 上下文 → 两层都漏。这是残余泄露核心，建议补真正的香农熵检测。
- **S3 [整合] checkpoint 时序泄露。** 用户原始明文进 state 后、before_model 脱敏前，是否已被 RedisSaver 持久化？若是则违反"密钥不进序列化状态"。需在 #21 入口层先脱敏再进图，或验证 checkpoint 时序。#22 验收项 3 必须真验。

### 🟡 Nice-to-have
- N1 [#17] before_model 返回全量 messages 依赖每条有稳定 id（add_messages 按 id 替换），否则多轮可能重复 —— 加多轮测试确认。
- N2 [#17] `make_sync_save_record` 每存一个 secret 新建一个 ThreadPoolExecutor，低效，建议复用。
- N3 [#19] `del secret` 是安全表演（不真清零内存）；`shlex` 未使用。
- N4 [#17] sanitize 默认 `max_reads=999999` + ttl 900s，建议收紧。
- N5 [agent.py] checkpointer `__enter__` 无对应 `__exit__`。

### 整合层提醒（#21 薄入口必须处理）
- middleware 顺序必须 `[ReversibleSanitize, PIIBackstop, HITL]`（before_model 按列表序跑，sanitize 必须在兜底前）。
- secure_shell 的 store/ctx/executor 注入：**ctx.tool_name 必须 ="secure_shell"** 否则 resolve_secret 第 6 步 allowed_tools 校验过不了；executor 必须是沙箱（见 B1）。用 LangChain InjectedState/InjectedToolArg 注入。
- agent.py 目前仍是 echo 占位 + 空 middleware，真正组装在 #21 —— 上面 S1/S3/顺序 在组装时一并验。

### 处置建议
- #15：可直接提交。
- #17/#18：补 S1、S2 后提交。
- #19：改 B1 后提交。#20：改 B2 后提交。
- S3 + 整合项留到 #21，#22 端到端务必抽查 Redis checkpoint 无明文。

## 2026-06-13 23:58 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#20 HITL 审批 + Redis checkpointer 🔴 **待 review**
- 完成度：代码完成，待人工/强模型 review
- 动过的文件：
  - 新增 blindvault_agent/middleware/hitl.py（拦截点 B 审批，HITL middleware 工厂 + 高危命令规则）
  - 新增 blindvault_agent/tests/test_hitl.py（18 个测试）
- #20 设计要点：
  - `is_command_high_risk()`：13 种高危命令正则（rm -rf、mkfs、dd、shutdown、DROP DATABASE 等）
  - `create_hitl_middleware()`：工厂函数创建 HumanInTheLoopMiddleware，拦截 secure_shell 调用
  - 审批时命令中只有占位符 {{secret:xxx}}，不含明文密钥
  - 明文只在 approve 后由 resolve_secret 瞬间注入，reject 则永不出现
  - Redis checkpointer 已在 spike #13 验证（暂停→存 Redis→恢复续跑）
- 验收结果：80 个测试全绿（policy 15 + 脱敏 18 + PII 16 + shell 13 + HITL 18）
- 下一步：#21 薄入口 API/CLI
- 提交：待提交

## 2026-06-13 23:56 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#18 PII 兜底 middleware + #19 secure_shell 工具 🔴 **待 review**
- 完成度：代码完成，待人工/强模型 review
- 动过的文件：
  - 新增 blindvault_agent/middleware/pii_backstop.py（拦截点 A 兜底层，BLOCK 模式）
  - 新增 blindvault_agent/tools/secure_shell.py（拦截点 B 注入，从 backend/ 迁移 + 改用可注入执行器）
  - 新增 blindvault_agent/tests/test_pii_backstop.py（16 个测试）
  - 新增 blindvault_agent/tests/test_secure_shell.py（13 个测试）
  - 更新 blindvault_agent/tests/conftest.py（增加 autouse settings 缓存清除，修复跨文件密钥冲突）
- #18 设计要点：
  - PIIBackstopMiddleware：BLOCK 模式，不可逆，不回写金库
  - 5 种检测规则：高熵 token、连接串、私钥、password 赋值、AWS Key
  - 已被主层处理的 {{secret:xxx}} 占位符不触发误报
  - 核心验收：主层处理后放行，但遗漏的凭证被兜底层阻断
- #19 设计要点：
  - 三种引用格式都能 resolve：{{secret:sec_xxx}} / $SECRET / 裸 sec_live_xxx
  - 危险命令拦截（rm -rf、mkfs、curl|bash 等）
  - 回显脱敏（真实密码→[REDACTED]）
  - 执行器可注入（生产用沙箱/测试用 mock）
  - 明文用完即弃（finally 块清除引用）
- 验收结果：62 个测试全绿（policy 15 + 脱敏 18 + PII 16 + shell 13）
- ⚠️ review 要点：
  1. PII 兜底规则覆盖率和误报率
  2. secure_shell 的 resolve 路径是否有遗漏
  3. 回显脱敏是否覆盖所有输出路径
- 下一步：#20 HITL 审批 + Redis checkpointer
- 提交：待提交

## 2026-06-13 23:32 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#15 review 通过 + #17 可逆脱敏 middleware 🔴 **待 review**
- 完成度：
  - #15 迁移安全资产：review 通过 ✅ diff 仅含 import 路径变化，零逻辑变更
  - #17 可逆脱敏 middleware：代码完成，待人工/强模型 review 后提交
- 动过的文件：
  - 新增 blindvault_agent/middleware/reversible_sanitize.py（拦截点 A 主层）
  - 新增 blindvault_agent/tests/test_reversible_sanitize.py（18 个测试）
- #17 设计要点：
  - ReversibleSanitizeMiddleware 类，`before_model` 扫描消息 → 正则检测 → AES 加密存金库 → 替换为 `{{secret:sec_xxx}}`
  - 接受 `save_record` 同步回调（而非直接持有异步 store），解决 sync/async 兼容
  - 提供 `make_sync_save_record(store)` 工厂函数桥接异步 store
  - 内置规则：中文密码、英文密码、连接串密码、API Key（确定性正则在前）
  - 安全铁律遵守：映射只存金库不进 state；金库不可达抛异常阻断
- 验收结果：33 个测试全绿（policy 15 + 脱敏 18）
- ⚠️ #17 review 要点：
  1. 正则规则覆盖率是否足够（当前为最小集，后续可从 DB 动态加载）
  2. `save_record` 回调设计是否足够安全（同步阻塞，金库不可达即中断）
  3. 占位符格式 `{{secret:sec_xxx}}` 与旧版 sanitizer 一致
- 下一步具体动作：等 #17 review 通过后，继续 #18 PII 兜底 / #19 secure_shell / #20 HITL
- 卡点/注意：🔴 安全关键代码
- 提交：待提交

## 2026-06-13 23:23 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#16 LiteLLM 网关配置
- 完成度：done
- 动过的文件：docs/litellm-gateway.md（新增网关配置文档）、blindvault_agent/verify_gateway.py（验收脚本）
- 验收结果：同一份 create_blindvault_agent 代码，改 model alias 即可在 GPT(gpt-5.4-mini) 和 Claude(claude-sonnet-4-6) 间切换，virtual key 生效
- 说明：LiteLLM 网关已远程部署（aigateway.sunmi.com），无需本地 compose 服务。Agent 通过 ChatOpenAI(base_url=网关) 接入
- 下一步具体动作：等 #15 review 通过后，开始 #17 可逆脱敏 middleware（🔴 安全关键）
- 卡点/注意：#17-#20 均标 🔴，须写草稿待 review
- 提交：待提交

## 2026-06-13 23:22 — Antigravity (Claude Opus 4.6 Thinking)
- 当前任务：#15 迁移复用安全资产 🔴 **待 review**
- 完成度：代码完成，待人工/强模型 review 后提交
- 动过的文件：
  - 新增 blindvault_agent/security/{config.py, crypto.py, policy.py, redis_store.py, models.py}（从 backend/ 原样复制 + 调 import 路径）
  - 新增 blindvault_agent/tests/{conftest.py, test_policy.py}（测试迁移）
  - 更新 blindvault_agent/security/__init__.py（re-exports）
- 迁移原则：**仅搬运 + 调 import 路径（backend.xxx → blindvault_agent.security.xxx），未改任何逻辑**
- 验收结果：test_policy.py 15 个测试全绿（9 步校验链完整）；原 backend 测试也全绿未被破坏
- ⚠️ review 要点：
  1. 确认 import 路径替换完整正确，无遗漏
  2. 确认未趁迁移改任何逻辑（diff 应只有 import 行变化）
  3. 确认 security/config.py 中的 `get_settings()` 提供的 `encryption_key_bytes` 与原版一致
  4. Pyrefly lint 报 redis_store.py async 类型错误——与原文件一致，是 linter 对 redis.asyncio 的误报，不影响运行
- 下一步具体动作：等 review 通过后提交；同时可并行开始 #16 LiteLLM 网关配置
- 卡点/注意：🔴 安全关键代码，必须 review 后才提交
- 提交：未提交（待 review）

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
