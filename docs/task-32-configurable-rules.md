# 任务 #32：脱敏规则可配置 + AI 辅助生成 + 测试调试

> 用户决策（2026-06-15）：脱敏规则回到「可配置」路线。默认规则不硬编码，可删可恢复；用户可录入自定义规则（特定格式的 key/密码）；AI 辅助根据示例生成正则；提供测试对话框实时验证。
> ⚠️ **本任务直接动 🔴 主层脱敏识别——错的规则 = 漏报 = 密码外泄给模型。必须强模型复审。**

> 同时合并 #31：RulesConfig / AgentConfig 的硬编码中文走 i18n。

---

## 一、架构改动（🔴 改主层脱敏）

### 1. 规则存储改为运行时可读

- 新建 `blindvault_agent/security/rules_store.py`，用 Redis 持久化规则集合（不是放 PG，与金库同库简化部署）。schema：
  ```
  {
    "id": "uuid",
    "name": "AWS Secret Access Key",
    "pattern": "(?i)aws[_-]?secret[_-]?access[_-]?key\\s*[:=]\\s*([A-Za-z0-9/+=]{40})",
    "secret_type": "api_key",
    "label": "auto_aws_sk",
    "capture_group": 1,
    "enabled": true,
    "is_builtin": true,         # true=默认规则（可禁用/删除）, false=用户自定义
    "created_at": "...",
    "updated_at": "..."
  }
  ```
- 默认规则（移自 `_BUILTIN_RULES`）：首次启动时通过 `seed_builtin_rules()` 写入 Redis（**仅当不存在时**），用户删了就不再恢复（除非显式调"恢复默认"）。
- 现有 `reversible_sanitize.py`：
  - `_BUILTIN_RULES` **不删**，作为 seed 数据源保留；
  - `ReversibleSanitizeMiddleware.__init__` 时**从 store 加载一次规则并编译**，作为实例属性。`detect_secrets_in_text` 用这份编译好的副本。
  - **规则改动对本轮会话不生效，下一次新建会话/重启时生效**——这是有意设计，避免实时刷新机制的复杂度（version 号、缓存失效、并发安全），用户预期里"改规则给下次用"也是自然的。
  - 前端在 RulesConfig 顶部用一句话告知用户："规则改动将在新会话生效。"

### 2. 规则 CRUD 端点（`blindvault_agent/web.py`）

- `GET  /api/sanitize-rules`           — 列出所有规则
- `POST /api/sanitize-rules`           — 新建（body: name, pattern, secret_type, label, capture_group）
- `PUT  /api/sanitize-rules/{id}`      — 更新（含 enabled 切换）
- `DELETE /api/sanitize-rules/{id}`    — 删除（builtin 也允许删）
- `POST /api/sanitize-rules/restore-defaults` — 把缺失的默认规则补回（不覆盖已存在的同 id）

**安全约束**：
- 服务端必须 `re.compile()` 校验正则合法性，编译失败返回 400；
- 限制 `pattern` 最大长度（如 500 字符）防 ReDoS；
- **每次写操作都打审计日志**（谁、何时、改了哪条、新旧 pattern）；
- 删除 builtin 规则前后端都要二次确认提示。

### 3. AI 辅助生成正则（新端点）

- `POST /api/sanitize-rules/ai-suggest`，body: `{ "samples": ["AKIAIOSFODNN7EXAMPLE", "AKIAI44QH8DHBEXAMPLE"], "description": "AWS access key" }`
- 后端调 LiteLLM 网关（用现有的 `litellm_base_url` + `default_model`），prompt 要求返回严格 JSON：
  ```json
  { "pattern": "...", "secret_type": "...", "label": "...", "capture_group": 1, "explanation": "..." }
  ```
- **铁律**：AI 给的正则**不直接落库**，只返回给前端做"候选"，用户在前端测试通过、手动点保存才入库。
- 服务端拿到 AI 返回后立刻 `re.compile()` 校验，失败就返回 400 让前端重试。

### 4. 规则测试对话框（新端点）

- `POST /api/sanitize-rules/test`，body: `{ "pattern": "...", "capture_group": 1, "test_text": "我的密码是 hunter2" }`
- 后端对 pattern 做合法/长度校验后，在沙箱里跑 `finditer`（带超时 100ms 防 ReDoS）；
- 返回匹配命中：`{ "matches": [{ "value": "hunter2", "start": 7, "end": 14 }] }`
- **测试时绝不写库、不进金库**。

---

## 二、前端（🟢，但要注意安全提示）

### 1. RulesConfig.tsx 重写为「可配置 + AI 辅助」

布局：左侧规则列表（按 builtin/custom 分组），右侧编辑区（name / pattern / type / capture_group / enabled）。
- 列表里 builtin 规则用灰色 badge 标"默认"，删除按钮带红色二次确认；
- 「+ 新建」按钮 → 弹一个三段式向导：
  1. **示例输入**：用户粘 1-N 条样例文本 + 一句描述（"我的 Acme 内部 token 长这样"）；
  2. **AI 生成**：调 `/ai-suggest`，把候选 pattern 显示出来；
  3. **测试调试**：实时输入测试文本，下方高亮命中部分，用户能在保存前反复改 pattern + 调测试。
- 顶部加按钮"恢复默认规则"调 `restore-defaults`。

### 2. 合并 #31：i18n 补齐

- RulesConfig.tsx、AgentConfig.tsx 所有硬编码中文走 `i18n.tsx` 的 zh/en 键。
- AI 助手 / 测试对话框的提示词、错误信息也都走 i18n。

### 3. 用户安全提示

- 自定义规则保存前在 UI 上明显标注：「⚠️ 自定义规则错误可能导致密码未被脱敏。请使用测试框充分验证。」
- AI 候选 pattern 旁标「AI 生成，请人工核对」。

---

## 三、验收

1. 默认 4 条规则首次启动出现在列表；删除"中文密码"后刷新仍消失；点"恢复默认"后回来 ✓
2. 用户用 AI 助手粘 2 条 AWS key 样例 + 描述 → 生成候选 pattern → 测试框命中 → 保存 → 在 Chat 里贴一条 AWS key，**被脱敏成占位符** ✓
3. 写一条故意有 ReDoS 的正则（如 `(a+)+$`）→ 测试端点 100ms 超时拒绝 ✓
4. 写一条非法正则 → 服务端 400，前端友好提示 ✓
5. 双语切换：所有页面文案都翻译，无残留中文 ✓
6. 复审重点：① detect_secrets_in_text 切换到 store 加载后，#22 那套 e2e（贴密码不进模型）仍全绿；② 改规则后**新建会话**用新规则、旧会话用旧规则（不要求实时刷新）；③ AI 端点不会泄露 LiteLLM key、不会把用户测试文本写日志。

## 四、🔴 红线（违反 = 任务作废）

- AI 返回的 pattern **绝不**直接进生效规则集——必须经用户保存才入库。
- 规则 CRUD 端点和 AI 端点都要严格校验/限长 pattern，拒绝 ReDoS 风险。
- 测试端点跑用户 pattern 时**带超时**，防止把后端打挂。
- 改了规则集合**不要求**对本轮会话立即生效——新会话生效即可。这是有意决策（避免缓存失效+并发安全的复杂度，用户预期也符合）。前端要明示这一点。
- 默认规则 seed 只在首次启动时写入（判存在），用户删了就别恢复（用户意图至上）。

## 五、归属

- 一(规则存储 + 主层改造) **🔴 强模型必审**
- 二(前端) 🟢
- 三/四(AI 端点、测试端点)  **🔴 强模型必审**（涉及 ReDoS、LiteLLM 调用、不入库铁律）

## 六、执行顺序建议（一段一段做，每段做完拿回复审）

1. **A**：rules_store + 默认规则种子化 + middleware 改用 store（不动 API、不动前端）
2. **B**：CRUD 端点 + 缓存失效
3. **C**：AI 端点 + 测试端点
4. **D**：前端重写 + i18n 合并 #31
5. 端到端验收：跑 #22 e2e 套件保证回归 + 跑本任务三/4 全部验收点

A 段最大风险（动 middleware），单独提交、单独复审；其余按顺序往后。
