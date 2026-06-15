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
                        │       PIIBackstopMiddleware          (block)   │
                        │   ▸ Interception B — execution                 │
                        │       HITL approval (high-risk pause/resume)   │
                        │       secure_shell (resolve secret at exec)    │
                        └─────────────────┬──────────────────────────────┘
                                          │ OpenAI /v1/chat/completions
                                          ▼
                              LiteLLM Gateway  (holds your model keys)
                                          ▼
                              GPT · Claude · any routed model

   Vault: Redis + AES-256-GCM  ◀── decrypted only at execution, never in context
```

**Two rules cover the whole design:**

- **Interception A** — everything flowing *to* the model must be secret-free. Secrets are detected, encrypted into the vault, and replaced with `{{secret:sec_xxx}}` *before* the request leaves the agent (and before it is ever checkpointed).
- **Interception B** — at execution time the placeholder is resolved back to the real secret inside `secure_shell`; high-risk commands pause for human approval first.

**Zero-Knowledge Guarantee**: secrets never enter the AI context window — not in the prompt, not in the history, not in the logs, not in the durable checkpoint.

## Features

| Feature | Description |
|---------|-------------|
| 🔒 **Zero-knowledge secret protection** | Passwords / tokens / connection strings auto-detected, AES-256-GCM encrypted into the vault, replaced with reversible `{{secret:sec_xxx}}` placeholders. The model only ever sees placeholders. |
| 🛡️ **Defense-in-depth sanitization** | Primary reversible sanitizer (vault-backed) + a non-reversible **PII backstop** that *blocks* the request if any credential slips through. |
| ✋ **Human-in-the-loop approval** | High-risk commands (`DROP`, `rm -rf`, `TRUNCATE`, …) pause the run for explicit human approve/reject. Durable pause/resume via the Redis checkpointer — survives restarts. |
| 🧠 **Judgment delegated to you** | The model is told *not* to refuse high-risk ops on its own; it routes them to the approval layer, where a human decides. |
| 📋 **Task planning** | Multi-step tasks are broken into a step checklist (`record_plan`) before execution, ticked off as it runs. |
| 🔁 **Self-healing retry** | On failure the agent reads enriched diagnostics, fixes the command, retries, and gives up gracefully after repeated failures. |
| 🧼 **Output redaction** | Real secrets in command output are replaced with `[REDACTED]` before results re-enter context. |
| 🤖 **Model-agnostic** | Runs against GPT, Claude, or any model via your **LiteLLM gateway** — users need no LLM account; the gateway holds the keys. |
| 🔐 **9-step resolve policy** | Every secret resolution passes a strict permission chain (see below). |
| 🌐 **Web UI** | React frontend with a live execution timeline: plan checklist, tool calls, retries, approval cards, redacted output. |

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

- Python 3.11+
- Node.js 18+
- **Redis Stack** (with RedisJSON + RediSearch — required by the LangGraph Redis checkpointer)
- A **LiteLLM gateway** you control, exposing `/v1/chat/completions` with at least one model alias

### 1. Clone & install

```bash
git clone https://github.com/fcatat/BlindVault.git
cd BlindVault

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cd frontend && npm install && cd ..
```

### 2. Configure

```bash
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
BLINDVAULT_REDIS_URL=redis://localhost:6379/0
```

### 3. Start

```bash
# Redis Stack (provides RedisJSON + RediSearch)
docker run -d --name blindvault-redis -p 6379:6379 redis/redis-stack-server:latest

# Agent + web API (port 8000)
uvicorn blindvault_agent.web:app --port 8000

# Frontend (port 3000)
cd frontend && npm run dev
```

Open the frontend and try:

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
| Security | Custom `AgentMiddleware` (reversible sanitize + PII backstop) + HITL middleware |
| Model access | Your LiteLLM gateway (`/v1/chat/completions`), any model |
| Encryption | AES-256-GCM (`cryptography`) |
| Vault / state | Redis Stack (secrets vault + LangGraph checkpointer) |
| API / Web | FastAPI (SSE streaming) + React 18 + TypeScript + Vite |

## Project Structure

```
blindvault_agent/            # the security agent (current)
├── agent.py                 # create_blindvault_agent() + BlindVaultAgent wrapper (entry sanitize + injection)
├── web.py                   # FastAPI: /api/chat/stream (SSE), /api/approve
├── cli.py                   # terminal entry + local executor
├── config.py                # AgentSettings (gateway, model, redis, system prompt)
├── middleware/
│   ├── reversible_sanitize.py   # Interception A — primary (vault-backed)
│   ├── pii_backstop.py          # Interception A — backstop (block mode, Shannon entropy)
│   ├── hitl.py                  # Interception B — high-risk approval
│   └── msg_utils.py             # scan str/list/tool_call content
├── tools/
│   ├── secure_shell.py          # Interception B — resolve & inject at execution
│   └── planning.py              # record_plan (task breakdown)
├── security/                # reused, unchanged core
│   ├── crypto.py                # AES-256-GCM
│   ├── policy.py                # resolve_secret — 9-step policy chain
│   ├── redis_store.py           # secret vault
│   └── models.py
└── tests/                   # policy / sanitize / PII / shell / HITL / e2e

frontend/                    # React UI (Chat adapted to the agent; older tabs marked legacy)
├── src/agentApi.ts          # SSE client for /api/chat/stream
└── src/components/Chat.tsx   # execution timeline: plan / tools / retry / approval / [REDACTED]

backend/                     # legacy (pre-pivot self-built agent) — kept for reference
```

> **Note:** `backend/` is the pre-pivot implementation, kept for reference. The current product lives in `blindvault_agent/`. Some older frontend tabs (Dashboard / RulesConfig / …) are marked *(legacy)* and not wired to the new agent.

## Roadmap

- LiteLLM gateway-level guardrail as an independent network backstop (defense in depth beyond the in-app middleware).
- SSO / RBAC / audit export / multi-model routing policy.

## License

Licensed under [AGPL-3.0](LICENSE).

---

<div align="center">
  <sub>Built with 🔐 — AI Sees Nothing. Ops Lose Nothing.</sub>
</div>
