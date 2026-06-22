<div align="center">

# 🔐 BlindVault

**AI 看不到密码，运维不丢东西。**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangChain-create__agent-1C3C3C.svg)](https://langchain.com)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org)

[English](README.md) | **中文**

</div>

---

## BlindVault 是什么？

BlindVault 是**给 AI 运维 Agent 叠加的一层安全层**。它让团队用 LLM Agent 执行运维任务——数据库查询、SSH、API 调用——同时保证 **密码和密钥永不进入 AI 模型的上下文**，并且 **高危操作必须由人工审批后才执行**。

```
你输入：   postgresql://admin:MyPassword@db.prod/app —— 列出所有表
AI 看到：  postgresql://admin:{{secret:sec_***}}@db.prod/app —— 列出所有表
```

AI 用占位符构造命令，真实密码只在执行的瞬间、在安全工具内部注入，永远不进入提示词、历史、日志，也不进入持久化的 checkpoint。

BlindVault 构建在成熟的 Agent 框架（**LangChain `create_agent` / LangGraph**）之上，所有模型访问统一经由**你自己的 LiteLLM 网关**分发——因此 **终端用户无需任何自己的 LLM 账户**，同一个 Agent 可以跑在网关路由到的 **GPT、Claude 或任意模型**上。

## 架构 —— 两个拦截点

```
   用户                 ┌──────────────────────────────────────────────┐
 （无需 LLM 账户）──────▶│        BlindVault Agent                        │
                        │   LangChain create_agent · LangGraph 运行时     │
                        │                                                │
                        │   ▸ 拦截点 A —— 出站脱敏                         │
                        │       ReversibleSanitizeMiddleware  (→ 金库)   │
                        │         · 正则规则（可配置，存 Redis）           │
                        │         · 本地模型语义识别（EE）                 │
                        │   ▸ 拦截点 B —— 执行                            │
                        │       HITL 审批（高危暂停/恢复）                 │
                        │       secure_shell → 沙箱（执行瞬间解析密钥）     │
                        └─────────────────┬──────────────────────────────┘
                                          │ OpenAI /v1/chat/completions
                                          ▼
                              LiteLLM 网关（持有你的模型密钥）
                                          ▼
                              GPT · Claude · 任意路由模型

   金库：Redis + AES-256-GCM  ◀── 仅在执行瞬间解密，绝不进入上下文
   归档：PostgreSQL（仅元数据，不含密文）  ·  审计：只追加日志
```

**两条规则覆盖整个设计：**

- **拦截点 A** —— 一切流向模型的内容必须无密码。凭证（经可配置的正则规则 + 可选的 EE 本地模型语义识别检出）在请求离开 Agent **之前**（也在被 checkpoint **之前**）就被检测、加密入金库、替换为 `{{secret:sec_xxx}}`。
- **拦截点 B** —— 执行时，占位符在 `secure_shell` 内部解析回真实密钥，并在隔离的**沙箱**中运行；高危命令先暂停等人工审批。

**应用内单层防御，网关兜底在路线图上。** BlindVault 刻意在应用内只跑**一层可逆脱敏**（不可逆的 PII 兜底层已移除——它在生产中主要表现为误报伤可用性）。不可逆的"漏网即阻断"兜底应归属最外围的 **LiteLLM 网关层**（独立进程），这一项在路线图上；应用内遗留的 `pii_backstop.py` 已标记 *DEPRECATED*，仅供参考。

**零知识保证**：密钥永不进入 AI 上下文窗口——不在提示词里，不在历史里，不在日志里，也不在持久化 checkpoint 里。

## 功能

| 功能 | 说明 |
|------|------|
| 🔒 **零知识密钥保护** | 密码 / token / 连接串自动识别，AES-256-GCM 加密入金库，替换为可逆的 `{{secret:sec_xxx}}` 占位符。模型只看得到占位符。 |
| ⚙️ **可配置识别规则** | 可逆脱敏的正则规则存在 Redis 里（首次启动种子化默认规则）。可在 UI 中管理——新建 / 编辑 / 删除 / 恢复默认，带 AI 辅助生成规则与实时匹配测试。 |
| 🧬 **本地模型语义脱敏（EE）** | 在正则之外，可选的**本地私有模型**做一遍语义识别，捕获正则漏掉的凭证——且密钥明文绝不离开你的内网。需企业版 license 解锁。 |
| ✋ **人工审批（HITL）** | 高危命令（`DROP`、`rm -rf`、`TRUNCATE`、`docker rm`…）暂停，等人工显式批准/拒绝。高危清单可配置。基于 Redis checkpointer 的持久化暂停-恢复，重启不丢。 |
| 🏝️ **沙箱执行** | 命令在隔离的沙箱服务里经 HTTP 执行，绝不在宿主机上跑。**fail-closed**：未配置沙箱则拒绝执行。 |
| 🧠 **判断权交给你** | 系统提示词要求模型**不要自己拒绝**高危操作，而是把它交给审批层，由人来定。 |
| 📋 **任务计划拆解** | 多步任务先用 `record_plan` 拆成步骤清单再执行，随执行打勾。 |
| 🔁 **自愈重试** | 失败时读取诊断增强信息、修正命令、重试，多次失败后优雅放弃。 |
| 🧼 **输出脱敏** | 命令输出里的真实密钥在重新进入上下文前替换为 `[REDACTED]`。 |
| 🗄️ **金库管理 + PostgreSQL 归档** | 实时凭证金库 UI（TTL 倒计时、手动撤销）。过期/已用凭证的**元数据**（绝不含密文或明文）归档到 PostgreSQL 供查史。 |
| 📜 **只追加审计日志** | 密钥创建/读取/撤销、规则改动、配置更新、Agent 运行、HITL 批准/拒绝均记录。不提供任何删除/修改端点——日志按设计不可篡改。 |
| 🤖 **模型无关** | 经你的 **LiteLLM 网关** 跑 GPT / Claude / 任意模型；用户无需 LLM 账户，密钥由网关持有。 |
| 🔐 **9 步解析校验** | 每次密钥解析都过一条严格的权限链（见下）。 |
| 🌐 **Web 界面** | React 前端，带实时执行时间线（计划清单、工具调用、重试、审批卡、脱敏回显），以及凭证金库、脱敏规则、Agent 配置、审计日志等页面。 |

## 工作原理

1. **自然表达** —— 像跟同事说话一样直接把凭证写进去。
2. **入口处拦截** —— 密码被识别、AES-256-GCM 加密、带 TTL 存储，并在 Agent 运行**之前**替换为占位符。
3. **AI 盲执行** —— 它只看到 `{{secret:sec_xxx}}`。真实凭证在安全执行层注入，高危步骤暂停等你审批。

### 安全模型

```
密钥生命周期：  创建(active) → 使用(reads-1) → 耗尽 / 过期 / 撤销

解析校验链（每次解析）：
  ✓ 密钥存在        ✓ 状态 == active      ✓ user_id 匹配
  ✓ session_id 匹配 ✓ tenant_id 匹配      ✓ tool 在 allowed_tools 内
  ✓ destination 匹配 ✓ 未过期             ✓ read_count < max_reads
  → 任一失败：统一返回 "Secret resolution denied"（不泄露原因）
```

密钥**绝不**放进 Agent 状态或可序列化的 `RunContextWrapper.context`——只在金库里，执行瞬间临时解析。

## 快速开始

### 前置依赖

- 一个你自己的 **LiteLLM 网关**，暴露 `/v1/chat/completions` 且至少注册一个 model alias
- **Docker + Docker Compose**（推荐路径）；或手动开发：Python 3.11+、Node.js 18+、**Redis Stack**（含 RedisJSON + RediSearch，LangGraph 的 Redis checkpointer 需要），可选 PostgreSQL

### 1. 克隆 & 配置

```bash
git clone https://github.com/fcatat/BlindVault.git
cd BlindVault

cp .env.example .env
# 生成加密密钥：
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

在 `.env` 中设置：

```ini
BLINDVAULT_ENCRYPTION_KEY=<base64 的 32 字节密钥>
BLINDVAULT_LITELLM_BASE_URL=https://<你的 litellm 网关>/v1
BLINDVAULT_LITELLM_API_KEY=<你的 virtual key>
BLINDVAULT_DEFAULT_MODEL=<网关上的 model alias>   # 如 gpt-4o / claude-sonnet
# 可选：
# BLINDVAULT_EE_LICENSE=<license>          # 解锁 EE 本地模型网关
```

> **安全铁律**：LiteLLM API key 只由部署方在 `.env` 中维护，绝不在任何 API/UI 中暴露或允许修改——要改 key 请直接编辑 `.env` 并重启。

### 2. 用 Docker Compose 启动（推荐）

```bash
docker compose up -d --build
```

会拉起完整栈：**redis**（Stack）、**postgres**（归档）、**sandbox**（隔离执行器）、**backend**（FastAPI，端口 `8000`）、**frontend**（React，端口 `3000`）。Redis / PostgreSQL / 沙箱的 URL 已自动接线。

### 备选：手动开发

```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..

# Redis Stack（提供 RedisJSON + RediSearch）
docker run -d --name blindvault-redis -p 6379:6379 redis/redis-stack-server:latest

# Agent + Web API（端口 8000）—— 在 .env 设 BLINDVAULT_REDIS_URL=redis://localhost:6379/0
uvicorn blindvault_agent.web:app --port 8000

# 前端（端口 3000）
cd frontend && npm run dev
```

打开前端（`http://localhost:3000`），试试：

```
连接 postgresql://admin:MyPass123@db.prod/app，列出所有表
帮我部署 nginx：安装、启动、验证 80 端口在监听
把 staging 库删了：psql ... -c 'DROP DATABASE staging'    # → 暂停等审批
```

> **命令行**：`python -m blindvault_agent.cli` 在终端里跑同一个 Agent。

## 技术栈

| 层 | 技术 |
|----|------|
| Agent 运行时 | LangChain `create_agent` + LangGraph（持久化 checkpointer） |
| 安全层 | 自定义 `AgentMiddleware`（可逆脱敏、可配置规则、可选 EE 本地模型识别）+ HITL middleware |
| 模型访问 | 你的 LiteLLM 网关（`/v1/chat/completions`），任意模型 |
| 加密 | AES-256-GCM（`cryptography`） |
| 金库 / 状态 | Redis Stack（密钥金库 + LangGraph checkpointer） |
| 归档 / 审计 | PostgreSQL（密钥元数据归档 + 只追加审计日志） |
| 执行 | 隔离沙箱服务（Docker），经 HTTP 调用，fail-closed |
| API / Web | FastAPI（SSE 流式）+ React 18 + TypeScript + Vite |

## 项目结构

```
blindvault_agent/            # 当前的安全 Agent
├── agent.py                 # create_blindvault_agent() + BlindVaultAgent 包装器（入口脱敏 + 依赖注入）
├── web.py                   # FastAPI：chat/stream(SSE)、approve、secrets、sanitize-rules、agent-config、audit-log、local-model(EE)
├── cli.py                   # 终端入口
├── config.py                # AgentSettings（网关、模型、redis、沙箱、数据库、系统提示词）
├── middleware/
│   ├── reversible_sanitize.py   # 拦截点 A —— 主层（回写金库；+ EE 本地模型语义识别）
│   ├── pii_backstop.py          # DEPRECATED —— 默认不挂载（网关层兜底在路线图上）
│   ├── hitl.py                  # 拦截点 B —— 高危审批（高危清单可配置）
│   └── msg_utils.py             # 扫描 str/list/tool_call 内容
├── tools/
│   ├── secure_shell.py          # 拦截点 B —— 执行瞬间解析注入
│   ├── sandbox_executor.py      # 远程沙箱执行器（fail-closed）
│   └── planning.py              # record_plan（任务拆解）
├── security/                # 复用 / 扩展的核心
│   ├── crypto.py                # AES-256-GCM
│   ├── policy.py                # resolve_secret —— 9 步校验链
│   ├── redis_store.py           # 密钥金库（+ 归档/审计钩子）
│   ├── rules_store.py           # 可配置脱敏规则（Redis，种子化）
│   ├── pg_archive.py            # PostgreSQL 密钥元数据归档
│   ├── audit.py                 # 只追加审计日志
│   └── models.py
├── ee/                      # 企业版（license 门禁）
│   ├── __init__.py              # is_ee() license 门禁
│   └── local_model/             # 本地私有模型语义提取密钥
└── tests/                   # policy / 脱敏 / PII / shell / HITL / EE / e2e

frontend/                    # React 界面
├── src/agentApi.ts          # /api/chat/stream 的 SSE 客户端 + API 封装
└── src/components/           # Chat（执行时间线）、Sidebar、AuditLog、
                             #   RulesConfig、AgentConfig、LocalModelConfig(EE) …

backend/                     # 旧版（改造前自研 Agent）—— 保留供参考
Dockerfile.sandbox           # 隔离沙箱执行器镜像
docker-compose.yml           # redis + postgres + sandbox + backend + frontend
```

> **说明：** `backend/` 是改造前的实现，保留供参考。当前产品在 `blindvault_agent/`。前端核心标签页（凭证金库、脱敏规则、Agent 配置、审计日志）均已接入新 Agent；**企业版（PRO）** 区块对 license 功能做门禁——**本地模型网关** 在 EE license 下可用，而 SSO / 多模型 / 策略引擎 / 硬件设备为路线图上的占位。

## 路线图

- LiteLLM 网关层独立 guardrail，作为应用内脱敏之外的网络层兜底（即从应用内移出的不可逆 PII 阻断，纵深防御）。
- 企业版：SSO / RBAC、多模型路由策略、审计导出、硬件设备。

## 许可

基于 [AGPL-3.0](LICENSE) 开源。

---

<div align="center">
  <sub>用 🔐 构建 —— AI 看不到密码，运维不丢东西。</sub>
</div>
