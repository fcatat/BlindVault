# 任务 #30：接回开源版三个功能页 + 移除定时任务菜单

> 给 Antigravity 执行。背景：左侧"开源版必要功能"（凭证金库 / 脱敏规则 / Agent 配置 / 定时任务）当前标"legacy 未接入"，因为它们对接的是旧 backend 接口，新 `blindvault_agent.web` 还没暴露。
> 用户决定：**凭证金库接入、脱敏规则做只读展示、Agent 配置接入、定时任务从菜单移除。**
> 已勘查：新 `security/redis_store.py` 有现成 `list_secrets` / `revoke_secret`；新脱敏规则是 `reversible_sanitize.py` 里的 `_BUILTIN_RULES`（硬编码，非 DB）；新配置在 `config.py` 的 `AgentSettings`（LiteLLM 网关）。

---

## 子任务 A：凭证金库 Credential Vault（🟢 易、高价值，先做）

让用户看见密码被托管成 `sec_live_***`、TTL、剩余读取次数，并可撤销。

**后端（`blindvault_agent/web.py` 新增 2 个端点）：**
- `GET /api/secrets?user_id=...`（或用固定 demo_user）→ 调 `store.list_secrets(user_id)`，返回元数据列表：`secret_ref, label, secret_type, allowed_tools, expires_at, reads_left=max(0,max_reads-read_count), status`。**绝不返回 ciphertext / 明文。**
- `POST /api/secrets/{secret_ref}/revoke` → 调 `store.revoke_secret(ref)`。
- 用全局 `agent.store`（已初始化的 SecretStore），不要新建连接。

**前端：**
- 复用现有 `Dashboard.tsx`（凭证金库页）。
- 把它用的旧 api（`listSecrets`/`revokeSecret`）指到上面新端点（在 `agentApi.ts` 里加，或裁剪 `api.ts`）。字段已对齐旧 `SecretMetadataResponse`，基本不用改组件。
- 去掉该菜单项的 "(legacy 未接入)" 标记。

**验收**：聊一句带密码的指令 → 打开凭证金库页 → 看到对应 `sec_live_***` 条目、TTL 倒计时、reads_left；点撤销后状态变 revoked。

## 子任务 B：脱敏规则 Sanitization Rules（🟡 只读展示）

**后端：** `GET /api/sanitize-rules` → 返回 `reversible_sanitize.py` 里 `_BUILTIN_RULES`（及连接串规则）的**只读**描述：每条给 `name/description/example`，**不要暴露可被绕过的完整正则细节也无妨，但重点是只读、不可改**。
**前端：** 复用 `RulesConfig.tsx`，改成只读列表（去掉增删改的 UI 或禁用）。去掉 legacy 标记，可加一行说明"当前为内置规则，只读"。
**验收**：页面列出当前生效的脱敏规则（中文密码 / 英文 password / 连接串 / API Key 等），不可编辑、不报错。

## 子任务 C：Agent 配置 Agent Config（🟡 接入，注意语义已变）

**重要**：新架构模型走 **LiteLLM 网关**，不是旧的"页面配 LLM provider"。所以这页改成**展示+少量可改**：
- 展示（只读）：`litellm_base_url`（网关地址）、`default_model`、`has_api_key`（bool，**绝不返回 key 明文**）、`max_iterations`。
- 可改（可选，二期）：`default_model`、`system_prompt`。MVP 可先只读展示，标注"模型经 LiteLLM 网关分发"。

**后端：** `GET /api/agent-config` → 从 `get_agent_settings()` 返回上述字段（key 只返回 `has_api_key: bool`）。若做可改：`PUT /api/agent-config` 更新 default_model / system_prompt（落 .env 或运行时，**注意 lru_cache 的 get_agent_settings 要能刷新**）。
**前端：** 复用 `AgentConfig.tsx`，字段映射：旧 `llm_model`→`default_model`，`llm_base_url`→`litellm_base_url`，`has_api_key` 保留，`system_prompt` 保留；删掉旧的 provider 切换（mock/openai 已废）。去 legacy 标记。
**验收**：页面显示当前网关地址、默认模型、系统提示词、has_api_key=true；不泄露 key 明文。

## 子任务 D：移除定时任务菜单（🟢）

- 新架构无 scheduler（#28 已砍）。把 `Scheduled Tasks` 菜单项从 `Sidebar.tsx` / `App.tsx` **直接移除**（不是标 legacy）。
- 相关旧组件 `ScheduledTasks.tsx` 可留文件不引用，或删除。

---

## 安全铁律（所有子任务通用）
- 任何端点**绝不返回**：密钥明文、ciphertext、LLM api key 明文。
- 金库/配置端点复用已初始化的 `agent.store` / `get_agent_settings()`，不新建连接、不绕过。
- web 层不记录含密码的请求体日志。

## 归属与复审
- A/B/D 🟢；C 🟡（涉及配置语义）。
- 完成后拿回复审：重点查"端点是否泄露明文/key"。先做 A，跑通再做 B/C/D。
- 完成更新 PROGRESS.md。
