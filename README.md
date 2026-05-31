# BlindVault — LLM Agent Secret Reference System

> 让 secret 永远不进入 LLM prompt

## 概述

BlindVault 是一个面向 LLM Agent 的 **Secret Reference System（密钥引用系统）**。

**核心原则**：真实密码、API key、token、数据库密码等 secret **永远不能进入 LLM prompt**。模型只能看到 `secret_ref`（如 `{{secret:sec_live_xxx}}`）；只有后端 Tool Executor 可以在严格权限校验后解析 secret_ref，并把真实 secret 临时用于工具执行。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 / 用户                            │
│  1. 创建 secret → 获得 sec_live_xxx                          │
│  2. 发送消息: "用 {{secret:sec_live_xxx}} 登录 example.com"   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 后端                               │
│                                                              │
│  ┌──────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ Secret   │    │ LangGraph Agent  │    │ 日志脱敏      │  │
│  │ Store API│    │                  │    │ 中间件        │  │
│  │          │    │ chatbot ──→ LLM  │    │               │  │
│  │ 加密存储 │    │   ↓        (只看  │    │ • 字段脱敏    │  │
│  │ Redis    │    │   ↓     secret_ref) │  │ • ref 脱敏    │  │
│  └──────────┘    │   ▼               │    │ • 请求体过滤  │  │
│                  │ SecureToolNode    │    └───────────────┘  │
│                  │   ├─ denylist 检查 │                       │
│                  │   ├─ policy 校验   │                       │
│                  │   ├─ resolve_secret│                       │
│                  │   └─ 执行 + 脱敏   │                       │
│                  └──────────────────┘                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     Redis                                    │
│  • 加密存储 secret (AES-256-GCM)                             │
│  • 原子递增 read_count                                       │
│  • TTL 自动过期                                              │
└─────────────────────────────────────────────────────────────┘
```

## 技术栈

| 组件 | 选型 |
|------|------|
| 后端框架 | FastAPI |
| Agent 框架 | LangGraph（模型无关，支持任意 LLM） |
| 存储 | Redis（异步 redis-py） |
| 加密 | AES-256-GCM（cryptography 库） |
| 测试 | pytest + pytest-asyncio + fakeredis |

## 快速开始

### 1. 环境准备

```bash
# 克隆项目
cd BlindVault

# 创建虚拟环境
python -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，生成加密密钥：
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

### 2. 启动 Redis

```bash
# Docker 方式
docker run -d --name blindvault-redis -p 6379:6379 redis:7-alpine

# 或本地 Redis
redis-server
```

### 3. 启动后端

```bash
uvicorn backend.main:app --reload --port 8000
```

访问 Swagger UI：http://localhost:8000/docs

### 4. 运行测试

```bash
pytest backend/tests/ -v
```

## API 文档

### Secret 管理

#### `POST /api/secrets` — 创建 Secret

**Headers:**
| Header | 必需 | 说明 |
|--------|------|------|
| X-User-Id | ✅ | 用户 ID |
| X-Session-Id | ✅ | 会话 ID |
| X-Tenant-Id | ❌ | 租户 ID（默认 "default"） |

**请求体：**
```json
{
  "secret_type": "password",
  "label": "GitHub Token",
  "value": "ghp_xxxxxxxxxxxx",
  "allowed_tools": ["browser_login_mock"],
  "allowed_destinations": ["https://github.com"],
  "ttl_seconds": 3600,
  "max_reads": 1
}
```

**响应（201）：**
```json
{
  "secret_ref": "sec_live_aBcDeFgH12345678",
  "placeholder": "{{secret:sec_live_aBcDeFgH12345678}}",
  "label": "GitHub Token",
  "secret_type": "password",
  "allowed_tools": ["browser_login_mock"],
  "allowed_destinations": ["https://github.com"],
  "expires_at": "2026-05-30T01:00:00Z",
  "reads_left": 1,
  "status": "active"
}
```

> ⚠️ **注意**：响应中**永远不包含**真实 value

#### `GET /api/secrets` — 列出 Secret 元数据

返回当前用户/会话的所有 secret 元数据（不含 value）。

#### `POST /api/secrets/{secret_ref}/revoke` — 撤销 Secret

将 secret 标记为 `revoked`，之后不能被 resolve。

---

### Agent

#### `POST /api/agent/run` — 运行 Agent

**请求体：**
```json
{
  "user_message": "请用 {{secret:sec_live_xxx}} 登录 https://example.com，用户名 admin",
  "session_id": "session_123"
}
```

**响应：**
```json
{
  "reply": "工具执行完毕。结果：{\"login_result\": \"success\", \"url\": \"https://example.com\", \"username\": \"admin\"}",
  "tool_calls": [
    {
      "tool": "browser_login_mock",
      "args": {
        "username": "admin",
        "password_ref": "[REDACTED]",
        "url": "https://example.com"
      }
    }
  ],
  "secret_refs_used": ["sec_live_xxx"]
}
```

---

## 安全模型

### 1. Secret 生命周期

```
创建 (active) → 使用 (reads_left-1) → 耗尽 (exhausted)
                                     → 过期 (expired)
                                     → 撤销 (revoked)
```

### 2. 权限校验链（resolve_secret）

每次工具执行解析 secret 时，按顺序检查：
1. Secret 存在
2. Status == active
3. user_id 匹配
4. session_id 匹配
5. tenant_id 匹配
6. tool_name 在 allowed_tools 中
7. destination 在 allowed_destinations 中
8. 未过期
9. read_count < max_reads

**任何一项失败都返回统一的 `"Secret resolution denied"`，不暴露具体原因。**

### 3. Denylist 工具

以下"外发型"工具禁止接受 secret_ref：
- `send_email`
- `write_file`
- `web_search`
- `ask_llm`
- `generic_http_request`

### 4. 日志脱敏

- 字段名包含 `value|password|secret|token|api_key|authorization|cookie` → `[REDACTED]`
- secret_ref → `sec_live_abcd****`
- `POST /api/secrets` 请求体完全不记录
- 异常日志不 dump 完整请求体

---

## 测试指南

### 测试完整工作流

```bash
# 1. 创建 secret
curl -X POST http://localhost:8000/api/secrets \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user1" \
  -H "X-Session-Id: sess1" \
  -d '{
    "secret_type": "password",
    "label": "Test Login",
    "value": "my_password_123",
    "allowed_tools": ["browser_login_mock"],
    "allowed_destinations": ["https://example.com"],
    "max_reads": 1
  }'

# 记下返回的 secret_ref，例如 sec_live_aBcDeFgH

# 2. 使用 agent 执行登录
curl -X POST http://localhost:8000/api/agent/run \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user1" \
  -H "X-Session-Id: sess1" \
  -d '{
    "user_message": "请用 {{secret:sec_live_aBcDeFgH}} 登录 https://example.com，用户名 admin",
    "session_id": "sess1"
  }'

# 3. 验证 secret 已耗尽
curl -X GET http://localhost:8000/api/secrets \
  -H "X-User-Id: user1" \
  -H "X-Session-Id: sess1"
# reads_left 应该为 0，status 为 "exhausted"
```

### 安全验证清单

- [ ] 创建 secret 返回中无 value
- [ ] Redis 存储的是密文
- [ ] 错误 user/session 不能 resolve
- [ ] 错误 tool 不能 resolve
- [ ] 错误 destination 不能 resolve
- [ ] 过期 secret 不能 resolve
- [ ] max_reads 耗尽后不能 resolve
- [ ] 撤销后不能 resolve
- [ ] browser_login_mock 结果不含密码
- [ ] 日志中无明文 secret
- [ ] LLM 只看到 secret_ref
- [ ] 错误信息统一为 generic
- [ ] Denylist 工具参数不含 secret_ref

## 项目结构

```
backend/
├── main.py              # FastAPI 入口
├── config.py            # 环境变量配置
├── crypto.py            # AES-256-GCM 加解密
├── models.py            # 数据模型
├── redis_store.py       # Redis 存储
├── policy.py            # 权限校验引擎
├── redaction.py         # 日志脱敏
├── api/
│   ├── secrets.py       # Secret CRUD API
│   └── agent.py         # Agent 运行 API
├── agent/
│   └── graph.py         # LangGraph Agent
├── tools/
│   ├── registry.py      # 工具注册表 + denylist
│   ├── executor.py      # SecureToolNode
│   └── browser_login_mock.py  # Demo 工具
└── tests/
    ├── conftest.py      # 测试 fixtures
    ├── test_secrets_api.py
    ├── test_policy.py
    ├── test_tools.py
    └── test_redaction.py
```

## License

MIT
