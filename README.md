<div align="center">

# 🔐 BlindVault

**AI Sees Nothing. Ops Lose Nothing.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org)

**English** | [中文](README_CN.md)

</div>

---

## What is BlindVault?

BlindVault is an **AI-powered ops security platform** that lets DevOps teams use LLM agents for infrastructure tasks — database queries, SSH, API calls — while ensuring **passwords and secrets are NEVER exposed to the AI model**.

```
You type:   postgresql://admin:MyPassword@db.prod/app — show me all tables
AI sees:    postgresql://admin:{{secret:sec_***}}@db.prod/app — show me all tables
```

The AI executes the command. The password stays in the vault. Always.

## Architecture

```
User Input ──→ [Auto Sanitizer] ──→ LLM (only sees {{secret:sec_xxx}})
                    ↓                              ↓
              [AES-256 Vault]  ←←←  [SecureToolNode: decrypt & inject]
                (Redis + PG)                       ↓
                                         [Execute: psql/ssh/curl]
                                                   ↓
                                             Result → User
```

**Zero-Knowledge Guarantee**: Secrets never enter the AI context window. Not in the prompt, not in the history, not in the logs.

## Features

### Community Edition (Free & Open Source)

| Feature | Description |
|---------|-------------|
| 🔍 **Auto Sanitization** | Regex-based detection of passwords, tokens, API keys, connection strings |
| 🔐 **AES-256-GCM Encryption** | All secrets encrypted at rest with configurable key |
| 🛡️ **Sandbox Isolation** | Diagnostic commands (e.g., `secure_shell`) run inside an isolated Docker sandbox. The backend service stays clean, eliminating host privilege escalation risks. Supports bi-directional output sanitization |
| 💾 **PG Metadata Archiver** | Dual-write design. Metadata is archived to PostgreSQL (excluding secrets plaintext). Expired secrets remain persistent on the dashboard even after Redis TTL eviction for auditing |
| ⏱️ **Smooth Ticker Countdown** | Frontend uses a 1s local interval. Countdown and progress bar slide smoothly. On zero, the card auto-disables and stats adjust in real-time without API overhead |
| 📋 **One-Click Reference Copy** | Interactive copy button for `{{secret:sec_xxx}}` placeholder on the credential card with feedback checkmark to prevent typing mistakes |
| 📝 **History Sanitization** | Conversation history uses sanitized text — no password leaks in multi-turn |
| 🌐 **i18n** | Full English/Chinese support with one-click toggle |
| 🤖 **Any LLM** | OpenAI-compatible API (GPT, Claude, Qwen, DeepSeek, local models via LiteLLM) |
| 📊 **Execution Trace** | Visual audit trail of every tool call and secret access |
| 💾 **Persistent Config** | PostgreSQL-backed LLM configuration, survives restarts |
| 🔒 **Log Redaction** | Middleware sanitizes all request/response logs automatically |

### Enterprise Edition

| Feature | Description |
|---------|-------------|
| 🧠 **Local Model Gateway** | Double-layer protection: local LLM sanitizes before cloud LLM processes |
| 👥 **SSO / LDAP / OIDC** | Enterprise identity integration |
| 📋 **Audit Log & Compliance** | Every secret access logged, SOC2/ISO27001 exportable |
| 🔀 **Multi-Model Routing** | Route tasks to different models with policy rules |
| 🛡️ **Policy Engine** | Fine-grained access control beyond TTL/read-count |
| 📦 **Hardware Appliance** | Pre-configured box, air-gap ready |
| 🏢 **Multi-tenant & RBAC** | Team-based access control |

> 📧 Enterprise inquiries: [Contact Sales](mailto:enterprise@blindvault.dev)

## Quick Start

### One-Line Install (Docker)

```bash
curl -fsSL https://raw.githubusercontent.com/fcatat/BlindVault/main/install.sh | bash
```

> Only requires Docker & Git. The installer will guide you through port configuration and optional LLM setup.

### Manual Install

### Prerequisites

- Python 3.11+
- Node.js 18+
- Redis 7+
- PostgreSQL 14+

### 1. Clone & Install

```bash
git clone https://github.com/fcatat/BlindVault.git
cd BlindVault

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — generate encryption key:
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

### 3. Start Services

```bash
# Redis & PostgreSQL (Docker)
docker run -d --name blindvault-redis -p 6379:6379 redis:7-alpine
docker run -d --name blindvault-pg -p 5432:5432 -e POSTGRES_DB=blindvault -e POSTGRES_PASSWORD=postgres postgres:16-alpine

# Backend (port 8000)
uvicorn backend.main:app --reload --port 8000

# Frontend (port 3000)
cd frontend && npm run dev
```

Open http://localhost:3000 and start chatting!

## How It Works

1. **You talk naturally** — Type credentials in plain language, just like talking to a colleague
2. **BlindVault intercepts** — Passwords auto-detected, encrypted with AES-256-GCM, stored with TTL
3. **AI executes blindly** — LLM sees only `{{secret:sec_xxx}}` references. Real credentials injected at the secure execution layer

### Security Model

```
Secret Lifecycle:  Created (active) → Used (reads-1) → Exhausted / Expired / Revoked

Policy Chain (every resolve):
  ✓ Secret exists        ✓ Status == active     ✓ user_id match
  ✓ session_id match     ✓ tenant_id match      ✓ tool in allowed_tools
  ✓ destination match    ✓ Not expired           ✓ read_count < max_reads
  → Any failure: generic "Secret resolution denied" (no info leak)
```

### Log Redaction

- Fields matching `value|password|secret|token|api_key|authorization|cookie` → `[REDACTED]`
- Secret refs → `sec_live_abcd****`
- `POST /api/secrets` body never logged
- Exception traces never dump request bodies

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + LangGraph + asyncpg + redis-py |
| Frontend | React 18 + TypeScript + Vite |
| Encryption | AES-256-GCM (cryptography) |
| Storage | Redis (secrets) + PostgreSQL (config) |
| LLM | Any OpenAI-compatible API |

## Project Structure

```
backend/
├── main.py                # FastAPI entry point
├── config.py              # Environment configuration
├── crypto.py              # AES-256-GCM encrypt/decrypt
├── models.py              # Pydantic data models
├── sanitizer.py           # Auto-detect & replace secrets in messages
├── redis_store.py         # Redis secret storage
├── policy.py              # Permission validation engine
├── redaction.py           # Log redaction middleware
├── db.py                  # PostgreSQL persistence
├── api/
│   ├── secrets.py         # Secret CRUD API
│   ├── agent.py           # Agent run API
│   └── config.py          # LLM config API
├── agent/
│   └── graph.py           # LangGraph agent (mock + OpenAI)
├── tools/
│   ├── registry.py        # Tool registry + denylist
│   ├── executor.py        # SecureToolNode
│   ├── secure_shell.py    # Universal secure shell tool
│   └── browser_login_mock.py
└── tests/

frontend/
├── src/
│   ├── App.tsx             # Main app with session management
│   ├── api.ts              # Backend API client
│   ├── i18n.tsx            # Internationalization (en/zh)
│   └── components/
│       ├── Chat.tsx        # AI chat with sanitized history
│       ├── Dashboard.tsx   # Credential vault overview
│       ├── Sidebar.tsx     # Navigation + Enterprise features
│       ├── Header.tsx      # Language toggle + user menu
│       ├── AgentConfig.tsx # LLM configuration
│       ├── ExecutionTrace.tsx
│       └── AddCredentialModal.tsx
```

## License

**Community Edition** is licensed under [AGPL-3.0](LICENSE).

**Enterprise Edition** is available under a commercial license. [Contact us](mailto:enterprise@blindvault.dev) for details.

---

<div align="center">
  <sub>Built with 🔐 by the BlindVault Team</sub>
</div>
