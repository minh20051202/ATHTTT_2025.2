# Agentic Commerce — Authentication Demo for AI Agents

## What This Project Is

An educational FastAPI + React demo comparing **OAuth2** vs **Zero-Knowledge Proof (ZKP)** authentication for AI commerce agents. Built to answer: *how does an AI agent authenticate to a server without ever transmitting its secret credential?*

Two competing visions are implemented side-by-side:
- **OAuth2 (RFC 7523 Private Key JWT)** — the upcoming IETF standard for client-authenticated JWT assertions, replacing shared secrets
- **ZKP (Schnorr Identification Protocol)** — a cryptographic proof-of-knowledge where the password never leaves the client

Target audience: developerslearning about agent auth, CTOs evaluating ZKP for their AI infra.

---

## Architecture

```
Frontend (React + Vite)          Backend (FastAPI)
────────────────────────         ──────────────────────
src/pages/                        backend/
  Landing.jsx     ← marketing       main.py          ← FastAPI app
  Chat.jsx        ← live demo      api/chat.py      ← /intent, /zkp-challenge
  Compare.jsx     ← side-by-side   auth/oauth2.py   ← JWT, bcrypt (→ PKJWT)
  Attacks.jsx     ← threat model   auth/zkp.py       ← Schnorr ZKP
src/components/                    db/models.py      ← SQLAlchemy models
  ZKPFlow.jsx     ← 5-step viz      db/operations.py
  GhostResults.jsx                  agents/intent.py
  IntentCard.jsx                   attacks/simulations.py
  AuthInfoPanel.jsx
  ProofAccordion.jsx
  TimingBreakdown.jsx              tests/
src/lib/                           test_zkp.py       ← 15/15 passing
  zkp.js         ← WebCrypto Schnorr
  (oauth2.js     ← TODO: WebCrypto RSA, RS256)
src/services/
  chatApi.js
  (authApi.js   ← TODO: token exchange)
```

### Auth flow comparison

```
OAuth2 (current — bcrypt shared secret):
  Client → POST /api/chat/intent { message, agent_id }
  Server creates + verifies JWT in same request (HS256, shared secret)
  → Server sees the secret; only appropriate for controlled demo

OAuth2 PKJWT (planned — RFC 7523):
  1. Client has RSA-2048 keypair (public stored in DB, private held by instructor)
  2. Client creates signed JWT assertion (RS256) with its private key
  3. Client POSTs assertion to /api/auth/oauth2/token → receives access_token
  4. Client uses access_token as Authorization: Bearer header
  → Server never sees the private key; only the public key in the DB

ZKP (Schnorr — implemented):
  1. Client (browser) GETs /api/chat/zkp-challenge/{agent_id} → gets a single-use UUID token
  2. Client computes proof locally:  t = g^r,  c = H(t‖token),  s = r + c·x  (mod q)
     Password is hashed to get x = H(password). Password never sent to server.
  3. Client POSTs /api/chat/intent { message, agent_id, zkp_token, zkp_proof }
  4. Server verifies: g^s ≡ t·y^c  (mod p). Token consumed (single-use).
  → Server stores only public key y; can verify proof but never learns password
```

---

## Key Technologies

| Layer | Choice | Notes |
|-------|--------|-------|
| Backend framework | FastAPI | async, Pydantic, lifespan events |
| Auth | python-jose | JWT encode/decode (HS256 + RS256) |
| Password hashing | bcrypt | current OAuth2 stored hash |
| ZKP math | Pure Python | 257-bit safe prime, matching frontend JS |
| Frontend crypto | WebCrypto SubtleCrypto | RSA-PSS, SHA-256 for PKJWT (planned) |
| Frontend styling | Plain CSS, no framework | CSS variables, 4px spacing scale |
| Database | SQLite + SQLAlchemy | `agentic_commerce.db` |
| State | React Context | AgentsContext, ChatHistoryContext |
| Build | Vite | ES modules, fast HMR |

---

## Authentication Schema

```
Agent {
  id: Integer PK
  user_id: Integer FK
  name: String
  auth_type: String  ← "oauth2" or "zkp"
  credentials_hash: String?  ← bcrypt hash (OAuth2), NULL (ZKP)
  public_key: Text?          ← ZKSignature JSON (ZKP) or RSA PEM (planned PKJWT)
  created_at: DateTime

  user → User
  transactions → Transaction[]
}
```

**Design invariant:** ZKP agents have `credentials_hash=NULL` and `public_key` set. OAuth2 agents have `credentials_hash` set and `public_key=NULL`.

---

## Implemented Features

### Backend
- `POST /api/demo/seed` — creates demo user, OAuth2 agent, ZKP agent, 4 sample products
- `GET /api/chat/zkp-challenge/{agent_id}` — issues single-use UUID challenge token (60s TTL)
- `POST /api/chat/intent` — intent extraction → auth → tool execution → response
- `POST /api/auth/oauth2/token` — stub token endpoint (currently checks shared secret, not PKJWT)
- `POST /api/auth/zkp/register` — registers new ZKP agent (server derives public key from password)
- ZKP proof verification (Schnorr JSON branch + legacy noknow fallback)
- Timing breakdown: `intent_extraction`, `authentication`, `execution`, `total`

### Frontend
- **Landing.jsx** — hero section, dual-auth explanation with animated data-flow arrows
- **Chat.jsx** — tabbed OAuth2/ZKP agent selection; ZKP shows 5-step flow diagram + password input only when ZKP selected; two-step ZKP: challenge fetch → proof compute → intent POST; results render with AuthInfoPanel, ProofAccordion, TimingBreakdown
- **Compare.jsx** — side-by-side table of OAuth2 vs ZKP: trust model, secret transmission, replay protection, server-side state
- **Attacks.jsx** — animated attack simulations: credential disclosure (OAuth2), replay attack (ZKP caught by single-use token), man-in-the-browser, server breach
- **ZKPFlow.jsx** — 5-step animated flow (Challenge Fetch, Proof Computation, Server Verification, Token Consume, Response)
- **ProofAccordion.jsx** — expandable c/m/response values; DF1 (byte grouping) still open
- **IntentCard** / **AuthInfoPanel** / **TimingBreakdown** — per-response display components

### Styling system
- CSS variables: `--space-*` (4px–96px), `--color-*` (surface, border, text, primary, CTA), `--font-mono`
- `--font-sans`: Nunito (body), `--font-mono`: JetBrains Mono
- Color palette: cyan primary, dark text on light surface, red error states
- No Tailwind, no component library

---

## Test Status

```
backend/tests/test_zkp.py  — 15/15 PASSING
```

Test coverage:
- `test_create_client_public_key`
- `test_sign_data_produces_valid_proof`
- `test_token_is_single_use`
- `test_wrong_password_fails_verification`
- `test_zkp_challenge_returns_token`
- `test_zkp_challenge_rejects_oauth2_agent`
- `test_zkp_challenge_rejects_unknown_agent`
- `test_zlp_requires_token_and_proof`
- `test_zkp_chat_full_flow`
- `test_zkp_wrong_proof_fails`
- `test_zkp_token_expired`
- `test_zkp_proof_replay_rejected`
- `test_zkp_timing_metrics`
- `test_zkp_agent_has_public_key_not_password`
- `test_server_never_receives_password`

---

## Pending Work

### High priority
1. **OAuth2 PKJWT refactor** (`docs/superpowers/plans/2026-05-08-oauth2-private-key-jwt.md`)
   - Task 1: `backend/tests/test_oauth2_pkjwt.py` — RSA keypair generation, RS256 assertion signing/verification, token endpoint with Bearer challenge, seed endpoint returning one-time `private_key`
   - Task 2: `frontend/src/lib/oauth2.js` (WebCrypto SubtleCrypto RSA-PSS + SHA-256), `frontend/src/services/authApi.js` (token exchange), wire Bearer into `chatApi.js`, Chat.jsx two-step flow for OAuth2 too
   - Task 3: Update `create_agent()` to support OAuth2 PKJWT variant (no credentials_hash, stores RSA public_key), seed generates RSA keypair, `private_key` returned one-time, stored in `window._demoPrivateKey`
   - Task 4: Remove bcrypt-hashed client_secret stub from `main.py` token endpoint

### Design deferred (DF1–DF4)
- **DF1**: ProofAccordion hex dump format — byte grouping (4 vs 8), ASCII sidebar, upper/lower case
- **DF2**: Visual security rating component
- **DF3**: Landing page headline copy
- **DF4**: Arrow rendering style in data-flow diagrams (SVG paths vs CSS)

Design plan maturity: **9/10** (see `frontend/DESIGN_PLAN.md`)

### Medium priority
- Frontend CSS implementation of 4 deferred design decisions
- Attacks page animation polish (per-design-plan timing tables)
- Complete Compare page with full data-flow diagrams

---

## Configuration

Key settings in `backend/utils/config.py`:
- `jwt_secret_key`, `jwt_algorithm`, `jwt_expiration_minutes`
- `cors_origins`
- `oauth2_client_id`, `oauth2_client_secret`

Environment: `.python-version` (pyenv), `uv.lock` (uv package manager), `package-lock.json` (npm)

Dependencies cleaned: `litellm[proxy]` removed from `pyproject.toml` (unused, forced Rust toolchain build).

---

## ZKP Math Reference

Domain parameters (257-bit safe prime, shared client + server):
```
p = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff
q = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b78612769242e4cff
g = 4
```

Schnorr key generation:
```
x = H(password)  mod q        ← secret (never transmitted)
y = g^x  mod p                ← public key (stored on server)
```

Schnorr identification:
```
r = random(0, q)
t = g^r mod p                 ← commitment
c = H(t ‖ token)  mod q       ← challenge (binds to server token)
s = r + c·x  mod q            ← response
```

Server verification:
```
g^s ≡ t · y^c  (mod p)
```

---

## Running the Project

```bash
# Backend
cd backend
uv sync  # or: pip install -e .
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Seed the demo:
```bash
curl -X POST http://localhost:8000/api/demo/seed
```

Try it out:
```bash
# OAuth2 (single request, server sees no password)
curl -X POST http://localhost:8000/api/chat/intent \
  -H "Content-Type: application/json" \
  -d '{"message": "search for Laptop", "agent_id": 1}'

# ZKP step-by-step
TOKEN=$(curl -s http://localhost:8000/api/chat/zkp-challenge/2 | jq -r .zkp_token)
echo "Token: $TOKEN"
# (compute proof locally — see frontend/src/lib/zkp.js)
curl -X POST http://localhost:8000/api/chat/intent \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"search for Laptop\", \"agent_id\": 2, \"zkp_token\": \"$TOKEN\", \"zkp_proof\": \"...\"}"
```