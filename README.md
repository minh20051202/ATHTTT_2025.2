# Agentic Commerce Auth Demo

Educational demo: **OAuth2 PKJWT** vs **ZKP (Schnorr)** authentication for AI agents. Two side-by-side implementations answering: how does an AI agent authenticate without transmitting its secret?

## Stack

- **Backend:** FastAPI · SQLite + SQLAlchemy · `backend/`
- **Frontend:** React · Vite · `frontend/src/`
- **Database:** `agentic_commerce.db` (SQLite, created on first seed)

---

## Quick Start

### 1. Backend

```bash
./start-backend.sh
```

This kills any existing backend on port 8000, starts a fresh one, waits for it to be ready, and hits `/health`.

**What it does:**
```bash
cd backend
PYTHONPATH=. uv run uvicorn backend.main:app --port 8000 --host 0.0.0.0
```

**Verify:**
```bash
curl http://localhost:8000/health
```

**Seed the demo data** (creates demo user, OAuth2 agent, ZKP agent, 4 products):
```bash
curl -X POST http://localhost:8000/api/demo/seed
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

---

## Project Structure

```
frontend/src/               backend/
  pages/
    Chat.jsx                main.py             ← FastAPI entry
    Landing.jsx             api/chat.py         ← /intent, /zkp-challenge
    Attacks.jsx             auth/oauth2.py      ← OAuth2Auth class (HS256)
  components/
    ActionLog.jsx           auth/zkp.py          ← ZKP token lifecycle
    ChatTrace.jsx          db/models.py         ← Agent, Product, Transaction
    MetricsPanel.jsx        db/operations.py    ← DatabaseOperations
    shared/
      MetricChart.jsx       agents/intent.py    ← intent + tool_caller
    ZKPFlow.jsx             attacks/simulations.py ← red-team attack sims
  services/
    chatApi.js
    authApi.js
```

---

## Auth: Two Independent Systems

**No shared auth abstraction.** Each `agent.auth_type` routes directly.

### OAuth2 PKJWT

- Client generates RSA-2048 keypair via WebCrypto — private key never leaves browser
- Public key registered via `POST /api/auth/oauth2/register`
- Access token issued by server as **HS256** (server symmetric secret)
- Client asserts identity via `client_assertion` (RFC 7523 Private Key JWT) — signed with client-held private key, verified with server-stored public key
- Server never has per-agent RSA private key

### ZKP Schnorr

- Server stores only public key, never the password
- Challenge token: UUID v4, 60s TTL, single-use
- Client computes proof locally; server verifies with stored public key only
- Implementation: `backend/auth/zkp.py` + `frontend/src/lib/zkp.js`

### Agent Model Invariant

```
ZKP agent:      public_key=set,         oauth2_private_key=NULL
OAuth2 agent:  oauth2_private_key=NULL, public_key=set (registered by client)
```

---

## Running Tests

### Backend

```bash
cd backend
pytest -v
```

### Frontend

```bash
cd frontend
npm run build    # production build
npm run dev      # dev server with HMR
```

---

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/demo/seed` | Seed demo agents + products |
| POST | `/api/auth/oauth2/register` | Client registers RSA public key |
| POST | `/api/auth/oauth2/token` | OAuth2 token endpoint (HS256) |
| POST | `/api/chat/intent` | Authenticate + extract intent |
| GET | `/api/chat/zkp-challenge/{agent_id}` | Fetch ZKP challenge token |
| GET | `/health` | Health check |

---

## Demo Flow

1. **Seed** — creates two demo agents (OAuth2 + ZKP) in the database
2. **Navigate to `/chat`** — select OAuth2 or ZKP tab
3. **OAuth2:** Client generates RSA keypair → registers public key → sends message → `client_assertion` signed with private key → server verifies with stored public key → returns HS256 access token → subsequent `/intent` calls use Bearer token
4. **ZKP:** Fetch challenge → compute proof client-side (password never transmitted) → send proof to server → server verifies with stored public key

Watch the **Action Log** (left panel) for step-by-step detail and the **Live Metrics** (right panel) for verify time and payload size comparison.

---

## Ports

| Service | Port |
|---------|------|
| Backend (FastAPI) | 8000 |
| Frontend (Vite) | 5173 |