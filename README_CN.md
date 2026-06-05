<div align="center">

# 🔐 BlindVault

**AI 看不见密码，运维不丢效率。**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org)

[English](README.md) | **中文**

</div>

---

## 这是什么？

BlindVault 是一个 **AI 运维安全平台**，让运维团队使用 LLM Agent 执行数据库查询、SSH 远程命令、API 调用等日常操作，同时确保 **密码和密钥永远不会暴露给 AI 模型**。

```
你输入：    postgresql://admin:MyPassword@db.prod/app 帮我查下有几张表
AI 看到：   postgresql://admin:{{secret:sec_***}}@db.prod/app 帮我查下有几张表
```

AI 执行命令，密码留在保险箱里。始终如此。

## 架构

```
用户输入 ──→ [自动脱敏器] ──→ LLM（只看到 {{secret:sec_xxx}}）
                 ↓                              ↓
           [AES-256 保险箱]  ←←←  [安全工具节点：解密 & 注入]
             (Redis + PG)                       ↓
                                      [执行：psql/ssh/curl]
                                                ↓
                                          结果 → 用户
```

**零知识保证**：密码永远不进入 AI 上下文窗口——不在 prompt 里、不在对话历史里、不在日志里。

## 功能特性

### 社区版（免费开源）

| 功能 | 说明 |
|------|------|
| 🔍 **自动脱敏** | 正则检测密码、Token、API Key、数据库连接串并自动替换 |
| 🔐 **AES-256-GCM 加密** | 所有密钥静态加密存储，密钥可配置 |
| 🛡️ **隔离诊断沙箱** | 诊断命令（如 `secure_shell`）移至独立的隔离容器沙箱中执行，主业务容器重归纯净，避免进程逃逸和提权风险，提供双向结果脱敏 |
| 💾 **双写归档留底** | 凭证元数据双写 PostgreSQL 归档表，不含密钥密文。即使 Redis 缓存中 TTL 过期删除，历史凭证元数据在前端仍持久可见，便于审计 |
| ⏱️ **实时平滑倒计时** | 前端采用 1s 本地定时器，倒计时和进度条平滑递减；归零瞬间卡片自动置灰，顶部统计卡片（Active/Consumed）数字实时同步扣减 |
| 📋 **一键复制引用** | 凭证卡片提供一键复制安全引用 `{{secret:sec_xxx}}` 的快捷按钮，并带“已复制”绿色勾选提示，避免打字出错 |
| 📝 **历史脱敏** | 对话历史使用脱敏文本，多轮对话不泄露密码 |
| 🌐 **国际化** | 完整中英文支持，一键切换 |
| 🤖 **任意 LLM** | 兼容 OpenAI 接口（GPT、Claude、Qwen、DeepSeek、LiteLLM 本地模型） |
| 📊 **执行追踪** | 每次工具调用和密钥访问的可视化审计轨迹 |
| 💾 **持久化配置** | PostgreSQL 存储 LLM 配置，重启不丢失 |
| 🔒 **日志脱敏** | 中间件自动脱敏所有请求/响应日志 |

### 企业版

| 功能 | 说明 |
|------|------|
| 🧠 **本地模型网关** | 双层保护：敏感内容先过本地 LLM 脱敏，再交给云端 LLM 处理 |
| 👥 **SSO / LDAP / OIDC** | 企业身份认证集成 |
| 📋 **审计日志 & 合规** | 所有密钥访问记录，可导出 SOC2/ISO27001 报告 |
| 🔀 **多模型编排** | 按策略将不同任务路由到不同模型 |
| 🛡️ **策略引擎** | 超越 TTL/读取计数的细粒度访问控制 |
| 📦 **硬件一体机** | 预配置硬件盒子，支持离线部署（空气隔离） |
| 🏢 **多租户 & RBAC** | 基于团队的权限控制 |

> 📧 企业版咨询：[联系销售](mailto:enterprise@blindvault.dev)

## 快速开始

### 一键安装（Docker）

```bash
curl -fsSL https://raw.githubusercontent.com/fcatat/BlindVault/main/install.sh | bash
```

> 仅需 Docker 和 Git。安装脚本会引导你配置端口和 LLM（可跳过，稍后在 Web 界面配置）。

### 手动安装

### 环境要求

- Python 3.11+
- Node.js 18+
- Redis 7+
- PostgreSQL 14+

### 1. 克隆 & 安装

```bash
git clone https://github.com/fcatat/BlindVault.git
cd BlindVault

# 后端
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 前端
cd frontend && npm install && cd ..
```

### 2. 配置

```bash
cp .env.example .env
# 编辑 .env，生成加密密钥：
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

### 3. 启动服务

```bash
# Redis & PostgreSQL（Docker 方式）
docker run -d --name blindvault-redis -p 6379:6379 redis:7-alpine
docker run -d --name blindvault-pg -p 5432:5432 \
  -e POSTGRES_DB=blindvault -e POSTGRES_PASSWORD=postgres \
  postgres:16-alpine

# 后端（端口 8000）
uvicorn backend.main:app --reload --port 8000

# 前端（端口 3000）
cd frontend && npm run dev
```

打开 http://localhost:3000 开始使用！

## 工作原理

1. **自然输入** — 像和同事说话一样，直接在消息中包含密码
2. **自动拦截** — 密码被正则检测，AES-256-GCM 加密存储，设置 TTL 自动过期
3. **盲执行** — LLM 只看到 `{{secret:sec_xxx}}` 引用，真实密码在安全执行层注入

### 安全模型

```
密钥生命周期：创建 (active) → 使用 (reads-1) → 耗尽 / 过期 / 撤销

权限校验链（每次解析 secret 时）：
  ✓ 密钥存在           ✓ 状态 == active      ✓ user_id 匹配
  ✓ session_id 匹配    ✓ tenant_id 匹配      ✓ 工具在 allowed_tools 中
  ✓ 目标在 allowed_destinations 中   ✓ 未过期   ✓ read_count < max_reads
  → 任何一项失败：统一返回 "Secret resolution denied"（不泄露具体原因）
```

### 日志脱敏

- 字段名匹配 `value|password|secret|token|api_key|authorization|cookie` → `[REDACTED]`
- Secret 引用 → `sec_live_abcd****`
- `POST /api/secrets` 请求体完全不记录
- 异常日志不输出完整请求体

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + LangGraph + asyncpg + redis-py |
| 前端 | React 18 + TypeScript + Vite |
| 加密 | AES-256-GCM (cryptography) |
| 存储 | Redis（密钥） + PostgreSQL（配置） |
| LLM | 任意 OpenAI 兼容接口 |

## 项目结构

```
backend/
├── main.py                # FastAPI 入口
├── config.py              # 环境变量配置
├── crypto.py              # AES-256-GCM 加解密
├── models.py              # Pydantic 数据模型
├── sanitizer.py           # 消息自动脱敏器
├── redis_store.py         # Redis 密钥存储
├── policy.py              # 权限校验引擎
├── redaction.py           # 日志脱敏中间件
├── db.py                  # PostgreSQL 持久化
├── api/
│   ├── secrets.py         # 密钥 CRUD API
│   ├── agent.py           # Agent 运行 API
│   └── config.py          # LLM 配置 API
├── agent/
│   └── graph.py           # LangGraph Agent（mock + OpenAI）
├── tools/
│   ├── registry.py        # 工具注册表 + 黑名单
│   ├── executor.py        # 安全工具节点 (SecureToolNode)
│   ├── secure_shell.py    # 通用安全 Shell 工具
│   └── browser_login_mock.py
└── tests/

frontend/
├── src/
│   ├── App.tsx             # 主应用 + 会话管理
│   ├── api.ts              # 后端 API 客户端
│   ├── i18n.tsx            # 国际化（中/英）
│   └── components/
│       ├── Chat.tsx        # AI 对话（脱敏历史）
│       ├── Dashboard.tsx   # 凭证库概览
│       ├── Sidebar.tsx     # 导航 + 企业版功能
│       ├── Header.tsx      # 语言切换 + 用户菜单
│       ├── AgentConfig.tsx # LLM 配置
│       ├── ExecutionTrace.tsx
│       └── AddCredentialModal.tsx
```

## 开源协议

**社区版** 采用 [AGPL-3.0](LICENSE) 开源协议。

**企业版** 采用商业授权。[联系我们](mailto:enterprise@blindvault.dev) 了解详情。

---

<div align="center">
  <sub>用 🔐 守护每一个密码 — BlindVault 团队</sub>
</div>
