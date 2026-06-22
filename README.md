<div align="center">

# 🔐 BlindVault

**AI Sees Nothing. Ops Lose Nothing.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangChain-create__agent-1C3C3C.svg)](https://langchain.com)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org)

**English** | [中文](README_CN.md)

</div>

---

## What is BlindVault?

BlindVault is a **security layer for AI ops agents**. It lets teams use an LLM agent for infrastructure tasks — database queries, SSH, API calls — while guaranteeing that **passwords and secrets are NEVER exposed to the AI model**, and that **high-risk operations require a human to approve them**.

```
You type:   postgresql://admin:MyPassword@db.prod/app — show me all tables
AI sees:    postgresql://admin:{{secret:sec_***}}@db.prod/app — show me all tables
```

The AI builds the command using a placeholder. The real password is injected only at execution time, inside the secure tool. It never enters the prompt, the history, the logs, or the checkpoint.

BlindVault is built on top of a mature agent framework (**LangChain `create_agent` / LangGraph**) and brokers all model access through **your own LiteLLM gateway** — so **end users don't need any LLM account of their own**, and the same agent runs against **GPT, Claude, or any model** your gateway routes to.

## Architecture — two interception points

```
   User                ┌──────────────────────────────────────────────┐
 (no LLM account ──────▶│        BlindVault Agent                        │
  needed)               │   LangChain create_agent · LangGraph runtime   │
                        │                                                │
                        │   ▸ Interception A — outbound sanitize         │
                        │       ReversibleSanitizeMiddleware  (→ vault)  │
                        │         · regex rules (configurable, Redis)    │
                        │         · local-model semantic pass (EE)       │
                        │   ▸ Interception B — execution                 │
                        │       HITL approval (high-risk pause/resume)   │
                        │       secure_shell → sandbox (resolve at exec) │
                        └─────────────────┬──────────────────────────────┘
                                          │ OpenAI /v1/chat/completions
                                          ▼
                              LiteLLM Gateway  (holds your model keys)
                                          ▼
                              GPT · Claude · any routed model

   Vault: Redis + AES-256-GCM  ◀── decrypted only at execution, never in context
   Archive: PostgreSQL (metadata only, no ciphertext)  ·  Audit: append-only log
```

**Two rules cover the whole design:**

- **Interception A** — everything flowing *to* the model must be secret-free. Secrets are detected (configurable regex rules + an optional EE local-model semantic pass), encrypted into the vault, and replaced with `{{secret:sec_xxx}}` *before* the request leaves the agent (and before it is ever checkpointed).
- **Interception B** — at execution time the placeholder is resolved back to the real secret inside `secure_shell` and run in an isolated **sandbox**; high-risk commands pause for human approval first.

**Single-layer defense in the app, gateway backstop on the roadmap.** BlindVault deliberately runs a **single reversible sanitizer** in-app (the irreversible PII backstop was removed — it mostly caused false positives that hurt usability). The non-reversible "block if anything slips through" backstop belongs at the outermost **LiteLLM gateway layer** (an independent process); that is on the roadmap, and the legacy in-app `pii_backstop.py` is kept *deprecated* for reference only.

**Zero-Knowledge Guarantee**: secrets never enter the AI context window — not in the prompt, not in the history, not in the logs, not in the durable checkpoint.

## Features

| Feature | Description |
|---------|-------------|
| 🔒 **Zero-knowledge secret protection** | Passwords / tokens / connection strings auto-detected, AES-256-GCM encrypted into the vault, replaced with reversible `{{secret:sec_xxx}}` placeholders. The model only ever sees placeholders. |
| ⚙️ **Configurable detection rules** | The reversible sanitizer's regex rules live in Redis (seeded with sensible defaults). Manage them via the UI — create / edit / delete / restore-defaults, with an AI-assisted rule generator and a live match tester. |
| 🧬 **Local-model semantic sanitization (EE)** | Beyond regex, an optional **on-prem local model** does a semantic pass to catch credentials that patterns miss — and the secret value never leaves your network. Gated behind an enterprise license. |
| ✋ **Human-in-the-loop approval** | High-risk commands (`DROP`, `rm -rf`, `TRUNCATE`, `docker rm`, …) pause the run for explicit human approve/reject. The high-risk list is configurable. Durable pause/resume via the Redis checkpointer — survives restarts. |
| 🏝️ **Sandboxed execution** | Commands run in an isolated sandbox service over HTTP, never on the host. **Fail-closed**: if no sandbox is configured, execution is refused. |
| 🧠 **Judgment delegated to you** | The model is told *not* to refuse high-risk ops on its own; it routes them to the approval layer, where a human decides. |
| 📋 **Task planning** | Multi-step tasks are broken into a step checklist (`record_plan`) before execution, ticked off as it runs. |
| 🔁 **Self-healing retry** | On failure the agent reads enriched diagnostics, fixes the command, retries, and gives up gracefully after repeated failures. |
| 🧼 **Output redaction** | Real secrets in command output are replaced with `[REDACTED]` before results re-enter context. |
| 🗄️ **Vault management + PostgreSQL archive** | Live credential vault UI (countdown TTL, manual revoke). Expired/used secret *metadata* (never ciphertext or plaintext) is archived to PostgreSQL for history. |
| 📜 **Append-only audit log** | Secret create/read/revoke, rule changes, config updates, agent runs and HITL approve/reject are recorded. No delete/update endpoints — the log is immutable by design. |
| 🤖 **Model-agnostic** | Runs against GPT, Claude, or any model via your **LiteLLM gateway** — users need no LLM account; the gateway holds the keys. |
| 🔐 **9-step resolve policy** | Every secret resolution passes a strict permission chain (see below). |
| 🌐 **Web UI** | React frontend with a live execution timeline (plan checklist, tool calls, retries, approval cards, redacted output) plus Credential Vault, Sanitization Rules, Agent Config and Audit Log views. |

## How it works

1. **You talk naturally** — type credentials in plain language, like talking to a colleague.
2. **BlindVault intercepts at the entrance** — passwords are detected, AES-256-GCM encrypted, stored with TTL, and replaced with placeholders *before* the agent runs.
3. **The AI plans and acts blindly** — it only sees `{{secret:sec_xxx}}`. Real credentials are injected at the secure execution layer, and high-risk steps pause for your approval.

### Security model

```
Secret lifecycle:  Created (active) → Used (reads-1) → Exhausted / Expired / Revoked

Policy chain (every resolve):
  ✓ Secret exists        ✓ Status == active     ✓ user_id match
  ✓ session_id match     ✓ tenant_id match      ✓ tool in allowed_tools
  ✓ destination match    ✓ Not expired          ✓ read_count < max_reads
  → Any failure: generic "Secret resolution denied" (no info leak)
```

Secrets are **never** placed in the agent state or the serializable `RunContextWrapper.context` — only in the vault, resolved transiently at the moment of execution.

## Quick Start

### Prerequisites

- A **LiteLLM gateway** you control, exposing `/v1/chat/completions` with at least one model alias
- **Docker + Docker Compose** (recommended path), or for manual dev: Python 3.11+, Node.js 18+, **Redis Stack** (RedisJSON + RediSearch, required by the LangGraph Redis checkpointer) and optionally PostgreSQL

### 1. Clone & configure

```bash
git clone https://github.com/fcatat/BlindVault.git
cd BlindVault

cp .env.example .env
# generate an encryption key:
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

Set in `.env`:

```ini
BLINDVAULT_ENCRYPTION_KEY=<base64 32-byte key>
BLINDVAULT_LITELLM_BASE_URL=https://<your-litellm-gateway>/v1
BLINDVAULT_LITELLM_API_KEY=<your virtual key>
BLINDVAULT_DEFAULT_MODEL=<a model alias on your gateway>   # e.g. gpt-4o / claude-sonnet
# Optional:
# BLINDVAULT_EE_LICENSE=<license>          # unlock EE local-model gateway
```

> **Security rule:** the LiteLLM API key is maintained **only** in `.env` by the operator. It is never exposed or editable through any API/UI — to change it, edit `.env` and restart.

### 2. Start with Docker Compose (recommended)

```bash
docker compose up -d --build
```

This brings up the full stack: **redis** (Stack), **postgres** (archive), **sandbox** (isolated executor), **backend** (FastAPI, port `8000`) and **frontend** (React, port `3000`). Redis/PostgreSQL/sandbox URLs are wired automatically.

### Alternative: manual dev

```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..

# Redis Stack (provides RedisJSON + RediSearch)
docker run -d --name blindvault-redis -p 6379:6379 redis/redis-stack-server:latest

# Agent + web API (port 8000)  — set BLINDVAULT_REDIS_URL=redis://localhost:6379/0 in .env
uvicorn blindvault_agent.web:app --port 8000

# Frontend (port 3000)
cd frontend && npm run dev
```

Open the frontend (`http://localhost:3000`) and try:

```
连接 postgresql://admin:MyPass123@db.prod/app，列出所有表
帮我部署 nginx：安装、启动、验证 80 端口在监听
把 staging 库删了：psql ... -c 'DROP DATABASE staging'    # → pauses for approval
```

> **CLI**: `python -m blindvault_agent.cli` runs the same agent in a terminal.

## Tech Stack

| Layer | Tech |
|-------|------|
| Agent runtime | LangChain `create_agent` + LangGraph (durable checkpointer) |
| Security | Custom `AgentMiddleware` (reversible sanitize, configurable rules, optional EE local-model pass) + HITL middleware |
| Model access | Your LiteLLM gateway (`/v1/chat/completions`), any model |
| Encryption | AES-256-GCM (`cryptography`) |
| Vault / state | Redis Stack (secrets vault + LangGraph checkpointer) |
| Archive / audit | PostgreSQL (secret-metadata archive + append-only audit log) |
| Execution | Isolated sandbox service (Docker), called over HTTP, fail-closed |
| API / Web | FastAPI (SSE streaming) + React 18 + TypeScript + Vite |

## Project Structure

```
blindvault_agent/            # the security agent (current)
├── agent.py                 # create_blindvault_agent() + BlindVaultAgent wrapper (entry sanitize + injection)
├── web.py                   # FastAPI: chat/stream (SSE), approve, secrets, sanitize-rules, agent-config, audit-log, local-model (EE)
├── cli.py                   # terminal entry
├── config.py                # AgentSettings (gateway, model, redis, sandbox, database, system prompt)
├── middleware/
│   ├── reversible_sanitize.py   # Interception A — primary (vault-backed; + EE local-model semantic pass)
│   ├── pii_backstop.py          # DEPRECATED — not mounted (gateway-layer backstop is the roadmap)
│   ├── hitl.py                  # Interception B — high-risk approval (configurable high-risk list)
│   └── msg_utils.py             # scan str/list/tool_call content
├── tools/
│   ├── secure_shell.py          # Interception B — resolve & inject at execution
│   ├── sandbox_executor.py      # remote sandbox executor (fail-closed)
│   └── planning.py              # record_plan (task breakdown)
├── security/                # reused / extended core
│   ├── crypto.py                # AES-256-GCM
│   ├── policy.py                # resolve_secret — 9-step policy chain
│   ├── redis_store.py           # secret vault (+ archive/audit hooks)
│   ├── rules_store.py           # configurable sanitize rules (Redis, seeded)
│   ├── pg_archive.py            # PostgreSQL secret-metadata archive
│   ├── audit.py                 # append-only audit log
│   └── models.py
├── ee/                      # Enterprise edition (license-gated)
│   ├── __init__.py              # is_ee() license gate
│   └── local_model/             # on-prem local-model semantic secret extraction
└── tests/                   # policy / sanitize / PII / shell / HITL / EE / e2e

frontend/                    # React UI
├── src/agentApi.ts          # SSE client for /api/chat/stream + API helpers
└── src/components/           # Chat (execution timeline), Sidebar, AuditLog,
                             #   RulesConfig, AgentConfig, LocalModelConfig (EE) …

backend/                     # legacy (pre-pivot self-built agent) — kept for reference
Dockerfile.sandbox           # the isolated sandbox executor image
docker-compose.yml           # redis + postgres + sandbox + backend + frontend
```

> **Note:** `backend/` is the pre-pivot implementation, kept for reference. The current product lives in `blindvault_agent/`. The frontend's core tabs (Credential Vault, Sanitization Rules, Agent Config, Audit Log) are wired to the new agent; the **Enterprise (PRO)** section gates licensed features — **Local Model Gateway** is functional under an EE license, while SSO / Multi-model / Policy Engine / Hardware Appliance are placeholders on the roadmap.

## Roadmap

- LiteLLM gateway-level guardrail as an independent network backstop (the non-reversible PII block, moved out of the app — defense in depth beyond the in-app sanitizer).
- Enterprise: SSO / RBAC, multi-model routing policy, audit export, hardware appliance.

## License

Licensed under [AGPL-3.0](LICENSE).

---

<div align="center">
  <sub>Built with 🔐 — AI Sees Nothing. Ops Lose Nothing.</sub>
</div>
