# 任务 #33：Agent 配置页 — 分区可编辑 + 健康面板

> 当前状态：Agent 配置页是 5 字段铺平的纯只读卡片。问题：`litellm_base_url`/`has_api_key` 改不了却展示、`system_prompt` 是 #29 定的安全策略不该让用户改、`default_model`/`max_iterations` 真该能改却不能。
> 用户决策（方案 1 + 健康面板）：分区，只让该改的能改；顺手加系统健康面板让此页有自身价值。

---

## 后端（blindvault_agent/web.py）

### 1. 改造 GET /api/agent-config 的返回结构

把字段按"可编辑性"分组返回，前端按组渲染：

```json
{
  "editable": {
    "default_model": "gpt-5.4-mini",
    "max_iterations": 15
  },
  "readonly": {
    "litellm_base_url": "https://...",
    "has_api_key": true,
    "system_prompt_preview": "你是运行在 BlindVault 受控环境..."   // 截断显示前 200 字符 + "...(已隐藏)"
  }
}
```

**🔴 铁律**：
- `litellm_api_key` 全文绝不返回；
- `system_prompt` **绝不返回全文**，只返回前 200 字符预览（因为它现在承载 #29 的安全策略，让用户能完整看到全文等于公开你的护栏写法，方便绕过）。

### 2. 新建 PUT /api/agent-config（只接受可编辑字段）

```python
class AgentConfigUpdate(BaseModel):
    default_model: Optional[str] = None
    max_iterations: Optional[int] = Field(None, ge=5, le=30)   # 限 5-30 防恶意拉爆资源
```

**🔴 铁律（防漏写）**：
- Pydantic 模型**只列两个字段**——`system_prompt` / `litellm_*` 等绝不在 model 里；
- 用 `model_config = ConfigDict(extra="forbid")`，多传字段直接 422；
- 服务端从 model 里只取 `default_model` 和 `max_iterations`，**不要用 `req.dict()` 全量 setattr**（防有人改字段名误导）；
- 写入靠重新设置 `get_agent_settings()` 缓存或落 .env，但**不许动 system_prompt**——审计日志记录每次改动（旧值/新值）。

### 3. 新增 GET /api/agent-health

```json
{
  "uptime_seconds": 12345,
  "started_at": "2026-06-15T...",
  "redis": { "ok": true, "latency_ms": 2 },
  "litellm_gateway": { "ok": true, "latency_ms": 120, "default_model": "gpt-5.4-mini" },
  "active_secrets_count": 7,
  "agent_runs_today": 42   // 可选，没有就不放
}
```

- Redis 连通性：`agent.store._redis.ping()` 带 1s 超时
- LiteLLM 连通性：往 `litellm_base_url + /models` 或 `/health` 发一次轻量请求（要支持网关的真实路由）；**绝不**返回 api_key
- active_secrets：`store.list_secrets("system")` 长度
- 失败时不抛 500，返回 `{ok: false, error: "..."}` 让前端能优雅渲染
- **服务端缓存 5 秒**：避免用户疯狂点刷新时把网关打爆;短暂窗口内的多次请求复用同一结果

---

## 前端（frontend/src/components/AgentConfig.tsx）

整页重构成两个分区 + 一个健康面板：

### 区块 1：运行时偏好（可编辑）
- `default_model`：下拉选择（候选先从 `/api/agent-health` 里的 `default_model` 字段 + 静态常用列表合并；或直接文本输入，简单）
- `max_iterations`：数字输入框（5–30，超界前端阻止 + 后端 422）
- 底部 [保存] 按钮，调 PUT；保存成功提示"已保存。下一次新会话生效。"

### 区块 2：基础设施（只读 + 折叠）
- `litellm_base_url`、`has_api_key` (✓/✗)、`system_prompt_preview`（带"..."尾巴，旁边一句话"完整内容由部署方在服务端配置")
- 顶部一行提示："以下为部署方维护，修改请编辑 .env 并重启 BlindVault 服务。"

### 区块 3：系统健康（新增）
四个小卡片横排：
- ⏱️ **运行时间**：把 uptime_seconds 格式化成"3 天 4 小时"
- 🔴 **Redis**：✓ 绿色 + 延迟；✗ 红色 + error
- 🌐 **LiteLLM 网关**：✓ 绿色 + 延迟 + 当前模型；✗ 红色
- 🔐 **活跃凭证**：数字 + 链接跳到凭证金库页

每个卡片右上角放一个小刷新按钮（也可以共享一个全局「刷新」按钮）。**进入页面时拉一次,不做轮询**——用户想看最新就手动点刷新。

### i18n
所有新文案走 i18n.tsx 的 zh/en 键，跟 #32 D 段一致。

---

## 验收

1. 改 `default_model` + `max_iterations` 保存 → 提示"下一次新会话生效" → **重启或新会话**后实际生效
2. 试图通过 curl PUT `system_prompt` → 返回 422（forbid 字段）
3. 试图 PUT `max_iterations: 9999` → 422
4. 健康面板：手动停掉 Redis → 此卡变红展示错误；恢复 → 30 秒内变绿
5. `system_prompt_preview` 只显示截断版（看不到完整 prompt）；`litellm_api_key` 任何接口都查不到
6. 中英文切换无残留中文

---

## 🔴 红线（违反 = 任务作废）

1. `litellm_api_key` 全文绝不出现在任何响应/前端
2. `system_prompt` 只返回截断预览；PUT 模型 `extra="forbid"`，禁止改
3. `max_iterations` 服务端必须有 5-30 范围校验（防滥用）
4. PUT 端点写操作要打**审计日志**（谁、何时、改了什么、旧值/新值）

## 归属
- 后端 1/2 🔴（防漏写 system_prompt / 防 key 泄露）
- 后端 3 🟢（健康面板）
- 前端 🟢

D 段那种"一次扔大块"做法，本任务保持一致。完成后我亲手 grep：① PUT 端点路径里有无 `system_prompt` / `litellm_api_key` 字样（应为零）；② GET 响应模型字段；③ 健康面板有无返回 key。
