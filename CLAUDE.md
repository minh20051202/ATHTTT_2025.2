# athttt_2025.2 — Agentic Commerce Auth Demo

> Educational demo: OAuth2 PKJWT vs ZKP (Schnorr) authentication for AI agents.
> Two side-by-side implementations answering: how does an AI agent authenticate without transmitting its secret?

## Project

- **Stack:** FastAPI backend · React/Vite frontend · SQLite + SQLAlchemy
- **Entry:** `backend/main.py` (FastAPI app) · `frontend/src/App.jsx` (React root)
- **Seed:** `POST /api/demo/seed` creates demo user, OAuth2 agent, ZKP agent, 4 products
- **Run backend:** `.make backend`
- **Test backend:** `curl http://localhost:8000/health`
- **Run frontend:** `cd frontend && npm install && npm run dev`
- **DB:** `backend/utils/config.py` sets `database_url: str = "sqlite:///./agentic_commerce.db"` — resolve relative to backend CWD (run from `backend/` or project root, not a different directory)
- **Test:** `cd backend && pytest -v`

---

## Architecture

```
frontend/src/           backend/
  pages/
    Chat.jsx            main.py              ← FastAPI entry
    Landing.jsx         api/chat.py           ← /intent, /zkp-challenge
    Compare.jsx         auth/oauth2.py         ← OAuth2Auth class
  components/           auth/zkp.py            ← ZKP token lifecycle
    ZKPFlow.jsx         db/models.py           ← Agent, Product, Transaction
    AuthInfoPanel.jsx   db/operations.py       ← DatabaseOperations
    ProofAccordion.jsx agents/intent.py        ← intent + tool_caller
  services/
    chatApi.js         attacks/simulations.py  ← red-team attack sims
    authApi.js
```

## Auth: Two Independent Systems

**No shared auth abstraction.** Each `agent.auth_type` routes directly.

### OAuth2 PKJWT (per-agent RS256)

- Agent stores `oauth2_private_key` (PKCS8) + `public_key` (SPKI) in DB
- Token endpoint signs access tokens with agent's own `oauth2_private_key` (RS256)
- `/api/chat/intent` verifies with `agent.public_key` (asymmetric — compromised key in one agent ≠ others)
- Frontend: `authApi.js` caches access tokens at 80% TTL, `clearAccessTokenCache()` for error recovery
- `_agentConfig` in `chatApi.js` is null until `setAgentConfig()` runs — guard OAuth2 sends with `oauth2TokenAcquired` state

### ZKP Schnorr (server never sees secret)

- Server stores only public key, never the password
- Challenge token: UUID v4, 60s TTL, single-use (deleted after verification)
- Client computes proof locally; server verifies with stored public key only
- `backend/auth/zkp.py` + `frontend/src/lib/zkp.js` implement the protocol

### Agent Model Invariant

```
ZKP agent:  public_key=set,  oauth2_private_key=NULL
OAuth2 agent: oauth2_private_key=set, public_key=set
```

## Key Conventions

- **Imports:** prefer local (`from ..auth.zkp import zkp_auth`) over package paths
- **DB sessions:** always pass `db: Session = Depends(get_db)` — don't cache sessions
- **Error handling:** raise `AppError(error_code=..., message=..., status_code=...)` — caught by global handler
- **OAuth2 debug:** `getTokenState()` in `authApi.js` — `{hasToken, expired}` for diagnostics
- **ZKP challenge TTL:** server-side `_CHALLENGE_TTL_SECONDS = 60`; clean up via `_cleanup_expired_challenges()`
- **Token replay (OAuth2):** tokens are reusable by design — this is a demo limitation, not a bug

## ZKP Math Reference

```
p = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff  (257-bit safe prime)
q = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff  (order)
g = 4
Secret:  x = H(password) mod q
Public:  y = g^x mod p
Proof:   r = random(0,q), t = g^r mod p, c = H(t ‖ token) mod q, s = r + c·x mod q
Verify:  g^s ≡ t · y^c (mod p)
```

## gstack Skills

Use `/browse` from gstack for all web browsing, never `mcp__claude-in-chrome__*` tools.

Available: `/office-hours` · `/plan-ceo-review` · `/plan-eng-review` · `/plan-design-review` · `/design-consultation` · `/design-shotgun` · `/design-html` · `/review` · `/ship` · `/land-and-deploy` · `/canary` · `/benchmark` · `/browse` · `/qa` · `/qa-only` · `/design-review` · `/investigate` · `/codex` · `/autoplan` · `/devex-review` · `/careful` · `/freeze` · `/guard` · `/unfreeze` · `/gstack-upgrade` · `/learn`

## Agentmemory

`/remember` · `/recall` · `/forget` · `/session-history`

MCP server: agentmemory (auto-wired via `.claude/skills/agentmemory/.mcp.json`)
