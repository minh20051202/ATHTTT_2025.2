# Knowledge Graph Report — athttt_2025.2

**Graph:** 464 nodes · 577 edges · 31 communities (Louvain)
**AST extraction:** 473 nodes · 720 edges
**Derived via:** `graphify.build.build_from_json()` (structural + semantic merge)

---

## Top Hubs

| Node | Type | Role |
|------|------|------|
| `backend_main_py` | code | App entry — FastAPI router assembly, on_startup key generation |
| `schnorrzkp_core_py` | code | ZKP core: `N`, `g`, `hash_secret`, `generate_token`, `verify_proof` |
| `utils_errors_apperror` | code | `AppError` — single error class used everywhere |
| `auth_oauth2_oauth2auth` | code | `OAuth2Auth` class — token minting, RS256 signing, verification |
| `backend_auth_zkp_py` | code | ZKP auth router: token lifecycle, `verify_proof` dispatch |
| `db_operations_databaseoperations` | code | `DatabaseOperations` — all persistent operations |
| `backend_api_chat_py` | code+docs | `/api/chat/intent` endpoint — auth dispatch, timing metrics |
| `backend_attacks_simulations_py` | code | Attack simulation router — SSLE, replay, token injection |

Top betweenness (architectural connectors):

| Node | Betweenness | Why it bridges |
|------|-------------|----------------|
| `backend_auth_zkp_py` | 0.298 | ZKP token lifecycle is shared across auth, chat, and tests |
| `backend_main_py` | 0.179 | All routers assembled here; tight coupling to lifespan |
| `schnorrzkp_core_zk` | 0.147 | Called by every ZKP flow |
| `auth_zkp_verify_noknow_legacy` | 0.146 | Legacy verify path still invoked |
| `db_models_agent` | 0.105 | Every agent-related op touches this model |
| `api_chat_extract_and_execute` | 0.103 | Auth → intent → tool call chain passes through here |

---

## Architecture: 4 Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend  (React, no backend state)                         │
│  Components: Navbar, BenchmarkCard, AgentSelector, AuthPanel │
│  Services: chatApi, authApi, demoApi                          │
│  Pages: Landing, Compare, Chat                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / REST
┌──────────────────────────▼──────────────────────────────────┐
│  API Layer  (FastAPI)                                        │
│  /api/chat/intent      — auth dispatch, tool call, timing    │
│  /api/auth/oauth2/token — client_assertion → JWT access token │
│  /api/attacks/*        — SSLE, token replay, injection sims │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Auth Layer           — two independent auth systems         │
│                                                              │
│  OAuth2 PKJWT (per-agent RS256)                              │
│    Token endpoint signs with agent's `oauth2_private_key`    │
│    Chat verifies with `agent.public_key`                     │
│    OAuth2Auth: create_client_assertion, verify_token_...     │
│                                                              │
│  ZKP Schnorr (server never sees secret)                      │
│    Challenge token (UUID) → client computes proof locally    │
│    Server verifies with stored public key only               │
│    auth_zkp: generate_token, consume_token, verify_proof     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Persistence Layer  (SQLite, SQLAlchemy ORM)                   │
│  Models: Agent, Product, Transaction, Base                   │
│  DatabaseOperations: create_user, create_agent, get_product  │
└─────────────────────────────────────────────────────────────┘
```

---

## Community Breakdown

### Cluster 0 — App Bootstrap (2)
`athttt_2025_2_main_main`, `main_py`
Application entry point and FastAPI instantiation.

### Cluster 1 — Vite Config (1)
`frontend_vite_config_js`

### Cluster 2 — React Root (1)
`frontend_src_main_jsx`

### Cluster 3 — Compare Page (9)
`compare_jsx`, `compare`, `flowstep`, `protocolside`, `securitychecklist`, `securityrating`, `terminalcontent`, `terminalheader`, `terminalwindow`
Protocol comparison UI with side-by-side terminal animation.

### Cluster 4 — Frontend Infra (55)
`app_jsx`, `agentscontext`, `chathistorycontext`, `benchmarkcard`, plus all component/page wrappers
Largest cluster — React component tree and context providers.

### Cluster 5 — Landing Page (3)
`landing_jsx`, `heroterminal`, `landing`

### Cluster 6 — ZKP Flow Component (2)
`zkpflow` component — interactive ZKP proof walkthrough.

### Cluster 7 — Proof Accordion (3)
`proofaccordion` — expands proof details.

### Cluster 8 — Ghost Results (2)
`ghostresults` component (skeleton loading).

### Cluster 9–12 — UI Primitives (2–4 each)
Navbar, timing breakdown, intent card, auth info panel.

### Cluster 13–14 — API Service Layer (1–2)
`demoapi`, `api` (axios instance).

### Cluster 15 — OAuth2 Frontend (11)
`oauth2_js`, `authapi`, `chatapi` — WebCrypto client_assertion signing, token caching, agent config.

### Cluster 16 — Attacks API (1)
`attacksapi_js`

### Cluster 17 — Backend init (1)
`backend/__init__.py`

### Cluster 18 — Intent / Tool Execution (55)
`intent_extractor`, `tool_caller`, `search_products`, `get_product_details`, `compare_prices`, `execute_purchase`, `rationale` nodes.
All agent reasoning and tool-calling logic.

### Cluster 19 — ZKP Core + Sample (45)
`schnorrzkp_core_py`, `schnorrzkp/utils/convert_py`, `backend_auth_samplezkp_py` — full ZKP protocol implementation.

### Cluster 20 — Crypto Utils (10)
`utils/crypto_py` — `get_prime`, `is_prime`, `prime_gen`, `hash_numeric`.

### Cluster 21 — DB Models + Lifecycle (53)
`db/models_py`, `main/lifespan`, `init_db`, `conftest` — persistence, startup migrations.

### Cluster 22 — Tool Caller (10)
`tool_caller` and its 5 tool methods — distinct from intent extraction.

### Cluster 23 — OAuth2 Auth Backend (27)
`OAuth2Auth` class — everything about token minting, RS256 key management, client_assertion.

### Cluster 24 — ZKP Auth Backend (35)
`auth/zkp_py` — token lifecycle, `verify_with_public_key`, cleanup jobs.

### Cluster 25 — Error Handling (7)
`AppError`, `ErrorResponse`, error factory helpers.

### Cluster 26 — OAuth2 PKJWT Tests (31)
`test_oauth2_pkjwt_py` — tests for token verification with per-agent public key.

### Cluster 27 — ZKP Auth Tests (41)
`test_zkp_py` — challenge, proof, verification test suite.

### Cluster 28 — OAuth2 Tests (31)
`test_oauth2_py` — token endpoint, client_assertion flow tests.

### Cluster 29 — Chat Endpoint Tests (21)
`test_chat_py` — `/api/chat/intent` endpoint tests including OAuth2 and ZKP flows.

### Cluster 30 — Attack Tests (21)
`test_attacks_py` — SSLE, token replay, injection simulation tests.

---

## Key Design Patterns

**Two fully independent auth systems** coexist without shared code. OAuth2 PKJWT uses RSA asymmetric keys; ZKP uses Schnorr discrete-log commitments. No auth abstraction layer bridges them — each agent-type routes directly.

**Per-agent keypairs**: OAuth2 agents store `oauth2_private_key` (PKCS8) and `public_key` (SPKI) in the DB. The token endpoint signs access tokens with the agent's own private key; `/api/chat/intent` verifies with the agent's public key. This means a compromised key in one agent does not affect others.

**Frontend token caching in `authApi.js`**: Access tokens cached with 80% TTL expiration. `clearAccessTokenCache()` exposed for error recovery.

**ZKP single-use challenge tokens**: UUID challenge stored server-side, deleted after verification — prevents replay of the challenge.

**Attack simulation layer**: `backend/attacks/simulations.py` runs SSLE, token replay, and injection attacks against the OAuth2 and ZKP flows for red-team testing.

**Test coverage matches auth structure**: Tests split by auth type (OAuth2 vs ZKP) and by layer (token endpoint vs chat endpoint vs attacks). `test_oauth2_pkjwt_py` tests RS256 asymmetric verification as the security boundary.

---

*Generated by graphify · AST + semantic extraction · Louvain community detection*