# 排错任务：端口混乱 + 旧/新后端混用 + 前端两个 bug

> 给 Antigravity 执行。背景：用户访问 `127.0.0.1:3000` 测试，出现①切窗口对话丢失 ②熔断后底部一直转圈 ③看到"安全熔断"旧文案。
> 根因怀疑：跑了多个进程，前端可能连到**旧 backend** 而非新 `blindvault_agent.web`。
> 目标：只保留新架构（端口 8005 = `blindvault_agent.web`），前端正确指过去，并修两个前端 bug。

---

## 背景事实（已勘查）

- 前端 Vite 默认端口 **3000**，通过 `vite.config.ts` 把 `/api` 代理到 `VITE_API_BASE`（默认 `http://localhost:8000`）。
- `frontend/src/api.ts` 调的是**旧接口**：`/api/agent/run`、`/api/agent/stream`、`/api/secrets`、`/api/config` —— 这些属于旧 `backend.main:app`。
- `frontend/src/agentApi.ts` + `Chat.tsx` 调的是**新接口**：`/api/chat/stream`、`/api/approve` —— 属于新 `blindvault_agent.web:app`。
- "安全熔断：已达到最大尝试上限" 这句文案**只存在于旧 `backend/agent/graph.py` 的 `_breaker_node`**，新 `blindvault_agent` 里没有。→ 用户看到它，说明请求打到了旧 backend。

---

## 步骤 1：摸清当前进程与端口

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|8000|8005|6379)'
```
记录每个端口对应的 PID 和命令（uvicorn 跑的是 `backend.main` 还是 `blindvault_agent.web`）。

## 步骤 2：只保留新后端（8005）+ Redis，关掉旧进程

```bash
# 关掉旧后端（8000，通常是 backend.main:app）和可能重复的前端
lsof -nP -tiTCP:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
lsof -nP -tiTCP:3000 -sTCP:LISTEN | xargs kill 2>/dev/null
# 不要动 6379(Redis Stack) 和 8005(新后端)
```

## 步骤 3：确认 8005 跑的是新后端

```bash
# 若 8005 没在跑，启动它：
uvicorn blindvault_agent.web:app --host 0.0.0.0 --port 8005

# 验证新接口存在（应返回 SSE data: 事件，不是 404）：
curl -sN "http://localhost:8005/api/chat/stream?message=hi&thread_id=t1" | head -c 200
```
能看到 `data: {...}` = 新后端正常；404 = 端口/服务不对。

## 步骤 4：让前端指向 8005（二选一）

**方案 A（推荐，改代理目标）**：启动前端时指定 API base 到 8005：
```bash
cd frontend && VITE_API_BASE=http://localhost:8005 npm run dev
```
然后访问 `127.0.0.1:3000`，其 `/api` 会代理到 8005 新后端。

**方案 B**：若新 `web.py` 已自带前端页面，直接访问 `http://localhost:8005`，不用 Vite。
（确认 web.py 是否 serve 前端：检查有无 StaticFiles mount 或 `@app.get("/")`。当前 web.py 只有 API，无前端，所以**优先用方案 A**。）

> ⚠️ 关键：确认用户实际用的 Chat 组件走的是 `agentApi.ts`（新 `/api/chat/stream`），不是 `api.ts` 的旧 `/api/agent/stream`。若 Chat 还在用旧接口，需切到 agentApi.ts。

---

## 步骤 5：修前端 Bug ①——切窗口对话丢失

文件 `frontend/src/components/Chat.tsx`，第 164 行那个"切 session 时重载历史"的 useEffect：
- **根因**：依赖里含 `fetchSecretsMetadata`，导致组件重挂载/重渲染时该 effect 重跑，无条件 `setMessages(从 localStorage 读的快照)` 覆盖内存里的最新消息；与第 210 行的写入 effect 存在竞态——切窗口时若最新消息还没落盘就被旧快照覆盖。
- **修复（方案 A）**：用 `useRef` 记住上次已加载的 `sessionId`，effect 开头判断：若 `sessionId` 未变则 `return`，不重新覆盖 messages。secrets 拉取拆成独立 effect 或保留，但绝不能因此覆盖 messages。
- **验收**：问一个问题 → 切走窗口 → 切回，消息还在；切到别的 session 再切回，各自历史正确、不串。

## 步骤 6：修前端 + 后端 Bug ②——熔断/出错后底部一直转圈

- **现象**：顶部已出最终消息（如熔断文案），底部"正在执行…"loading 一直转圈不消失。
- **后端排查** `blindvault_agent/web.py` 的 `/api/chat/stream`：当 `astream_events` 因递归上限（max_iterations）或异常结束时，是否仍发了一个 `done`（或 `error`）终结事件再关闭流？大概率异常/熔断路径直接 break 没发 `done`，前端 loading 收不到结束信号。→ **保证流结束的所有路径（正常/熔断/异常）都发一个终结事件**。
- **前端兜底** `Chat.tsx`：在 SSE 读取结束的 `finally` 里，无论是否收到 `done`，都 `setIsLoading(false)` 并清掉 `type==='loading'` 的占位消息。
- **验收**：发一个会失败/会熔断的命令，结束后 loading 圈一定消失、不卡死。

---

## 步骤 7（次要，待用户确认后再做）：SSH/网络失败不该重试满 10 次

- 现象：连不上的主机（SSH 认证失败 exit_code=5）被自愈重试了 10 次才熔断。
- 若用户确认：在自愈重试规则里，把"连接失败/认证失败/超时"这类**网络类错误**视为"同类错误"，连续 ≤3 次即停，不耗满 max_iterations。
- **此步等用户拍板再做。**

---

## 完成标准

- 只有 8005（新后端）+ 6379（Redis）+ 3000（前端，代理到 8005）在跑；旧 8000 backend 已关。
- 前端确认走新 `/api/chat/stream`。
- Bug ①②修复并验收通过。
- 更新 PROGRESS.md（含：确认了前端此前误连旧 backend、已修正）。
