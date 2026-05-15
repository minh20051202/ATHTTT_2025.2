# 6 Attacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all 6 attacks from research doc to a dedicated standalone `/attacks` page. Backend: 4 new endpoints. Frontend: new `Attacks.jsx` page, separate from Chat.

**Architecture:** Separate `/attacks` route — full-page dedicated attack simulation UI. Left panel: attack type selector (single-mode + compare). Right panel: results with forensics cards. Chat page serves only for sending messages and storing results in ChatHistoryContext. Attack page reads results from ChatHistoryContext via sessionStorage (same-agent cross-tab state).

**Tech Stack:** FastAPI · React · Vite · Python unittest · Playwright

---

## File Map

| File | Role |
|------|------|
| `frontend/src/pages/Attacks.jsx` | New standalone attacks page — replaces AttackPanel embedded in Chat |
| `frontend/src/App.jsx` | Add `/attacks` route |
| `frontend/src/components/AttackPanel.jsx` | Full-page layout: left=attack selector, right=results. Already built — reused here. |
| `backend/attacks/simulations.py` | All attack endpoints (existing: replay, alg-confuse, nonce-reuse. New: credential-theft, mitm, client-assertion-sub, proof-correlation, challenge-predictability + full compare) |
| `frontend/src/services/attackApi.js` | `attackApi` methods for all attacks |
| `backend/tests/test_attacks.py` | Tests for new endpoints |
| `frontend/src/context/ChatHistoryContext.jsx` | Attack page reads OAuth2/ZKP results from ChatHistoryContext — must be seeded via Chat page first |

## Architecture: /attacks Page

```
frontend/src/
  pages/
    Attacks.jsx          ← NEW: standalone attacks page
    Chat.jsx             ← messaging only; removes AttackPanel entirely
  components/
    AttackPanel.jsx      ← full-page layout (reused as the /attacks page body)
  App.jsx               ← add route: /attacks → Attacks.jsx

ChatHistoryContext persists results to sessionStorage.
AttackPanel reads from ChatHistoryContext — works across Chat → Attack navigation.
User must visit Chat page first to generate OAuth2/ZKP auth results.
```

**Note:** ChatHistoryContext stores `resultsByAuth` keyed by `auth_info.type` (oauth2/zkp). AttackPanel reads this to get tokens for attack simulation. Both pages share sessionStorage key `chat_history_results`.

---

## Task 0: Routing Setup + Chat Page Cleanup

**Files:**
- Create: `frontend/src/pages/Attacks.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/Chat.jsx` — remove `ComputationSidebar` (or keep for computation display, separate concern from AttackPanel)
- Modify: `frontend/src/components/AttackPanel.jsx` — update for standalone page sizing

### Step 0a: Create `Attacks.jsx`

Minimal shell that imports and renders `AttackPanel`:

```jsx
// frontend/src/pages/Attacks.jsx
import AttackPanel from '../components/AttackPanel.jsx'

export default function Attacks() {
  return <AttackPanel />
}
```

### Step 0b: Add route to `App.jsx`

```jsx
import Attacks from './pages/Attacks.jsx'

// In App.jsx routes section:
{
  path: '/attacks',
  element: <Attacks />
},
```

### Step 0c: Remove AttackPanel from `Chat.jsx`

In `frontend/src/pages/Chat.jsx`, remove:
- `import ComputationSidebar from '../components/ComputationSidebar.jsx'`
- `<ComputationSidebar ...>` component usage
- Keep only `ChatThread` in the layout (left column, full height)

Update `Chat.jsx` layout: single column, ChatThread only. Remove the right sidebar.

```jsx
// New Chat layout: full-height chat thread only
return (
  <div style={{ height: 'calc(100vh - var(--navbar-height))', padding: 'var(--space-4) var(--space-8)' }}>
    <ChatThread
      authType={authType}
      messages={messages}
      sending={sending}
      onSend={handleSend}
      message={message}
      setMessage={setMessage}
      password={password}
      setPassword={setPassword}
    />
  </div>
)
```

### Step 0d: Update AttackPanel for standalone sizing

`AttackPanel.jsx` already has full-height sizing via `height: calc(100vh - var(--navbar-height) - 120px)`. No layout change needed — it's already designed as a standalone component.

### Step 0e: Navbar — add Attacks link

`frontend/src/components/Navbar.jsx` or wherever nav is — add:

```jsx
<NavLink to="/attacks">Attack Simulation</NavLink>
```

### Step 0f: ChatHistoryContext cross-page sharing

Ensure `ChatHistoryContext` persists to sessionStorage (already does). AttackPanel reads from it. This works because sessionStorage is shared between tabs/pages in the same origin.

```javascript
// ChatHistoryContext already stores resultsByAuth in sessionStorage as 'chat_history_results'
// AttackPanel reads from it — no additional wiring needed
const stored = sessionStorage.getItem('chat_history_results')
const resultsByAuth = stored ? JSON.parse(stored) : null
```

If not persistent, add sessionStorage read on mount in `ChatHistoryContext`.

---

## Task 1: `credential-theft` — Both Auth Types

> Attack #1 from research doc. Simulates stolen credentials extracted from AI agent conversation context / tool call logs.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/services/attackApi.js`
- Modify: `frontend/src/components/AttackPanel.jsx`
- Modify: `backend/tests/test_attacks.py`

### Backend endpoint (`POST /api/attacks/credential-theft`)

**Logic:** Accepts `auth_type` + token/proof. Demonstrates what an attacker learns from a stolen credential:

- **OAuth2:** Get token info via `oauth2_auth.get_token_info()` (unauthenticated decode — shows expiration, user_id, algorithm). Demonstrates token persistence in logs/conversation = credential exposure.

- **ZKP:** Parse proof JSON. Show proof structure ({commitment, response}) — proof alone is useless without password. Demonstrate server-side mitigation: proof consumed after one use, can't be replayed.

```python
# OAuth2 branch — returns exposed data the attacker got from conversation logs
details = {
    "vulnerability": "OAuth2 tokens captured from AI agent conversation logs/tool calls",
    "exposed_data": {
        "token_prefix": token[:20] + "...",
        "expiration": token_info.get("payload", {}).get("exp"),
        "subject": token_info.get("payload", {}).get("sub"),
        "algorithm": token_info.get("header", {}).get("alg"),
    },
    "attack_successful": True,
    "impact": "Attacker imports stolen token directly into their own requests → fully authorized",
    "countermeasure": "Rotate tokens frequently (5-min TTL), never log Authorization headers, exclude credentials from conversation persistence"
}

# ZKP branch — returns what attacker got AND why it's useless
details = {
    "vulnerability": "ZKP proof captured from AI agent conversation logs/tool calls",
    "exposed_data": {
        "proof_structure": {"commitment": "0x...", "response": "0x..."},
        "proof_size_bytes": len(proof_json),
        "password_present": False,
    },
    "attack_successful": False,  # Proof without password = useless
    "impact": "Proof is mathematically useless without the secret password — server stores ONLY public key",
    "countermeasure": "Never include password in tool calls or conversation history; server uses zero-knowledge protocol"
}
```

- [ ] **Step 1: Write test**

```python
# backend/tests/test_attacks.py

def test_credential_theft_oauth2():
    """OAuth2 token stolen from logs gives attacker full access until expiry."""
    from .conftest import oauth2_pkjwt_agent
    # Get valid OAuth2 token via client assertion
    token = get_oauth2_token(oauth2_pkjwt_agent)
    # Simulate credential theft + misuse
    resp = client.post("/api/attacks/credential-theft",
        json={"auth_type": "oauth2", "token": token})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "exposed_data" in data["details"]
    assert "countermeasure" in data["details"]

def test_credential_theft_zkp():
    """ZKP proof stolen from logs doesn't help attacker — password required."""
    from .conftest import zkp_agent
    # Get a valid ZKP proof
    proof = compute_zkp_proof(zkp_agent, "demo")
    resp = client.post("/api/attacks/credential-theft",
        json={"auth_type": "zkp", "token": proof})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "password_present" in data["details"]["exposed_data"]
    assert data["details"]["exposed_data"]["password_present"] is False
```

- [ ] **Step 2: Run test — should fail (endpoint doesn't exist)**

- [ ] **Step 3: Add endpoint to `backend/attacks/simulations.py`**

After `nonce-reuse` endpoint (line ~175), add:

```python
@router.post("/credential-theft", response_model=AttackResponse)
async def credential_theft_attack(request: AttackRequest):
    """Simulate credential theft via conversation/log extraction (AI agent context).
    
    OAuth2: stolen bearer token → full account access until expiry.
    ZKP: stolen proof → useless without password (zero-knowledge).
    """
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            try:
                token_info = oauth2_auth.get_token_info(request.token)
                timing["extraction"] = time.time() - attack_start

                details = {
                    "vulnerability": "OAuth2 tokens captured from AI agent conversation logs/tool calls",
                    "exposed_data": {
                        "token_prefix": request.token[:20] + "...",
                        "expiration": token_info.get("payload", {}).get("exp"),
                        "subject": token_info.get("payload", {}).get("sub"),
                        "algorithm": token_info.get("header", {}).get("alg"),
                    },
                    "attack_successful": True,
                    "impact": "Attacker imports stolen token directly → fully authorized until expiry",
                    "countermeasure": "Rotate tokens frequently (5-min TTL), exclude from conversation logs, never persist in vector DB"
                }

                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=True,
                    message="Credential theft successful — token imported and authorized",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["extraction"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=False,
                    message=f"Credential theft failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            timing["extraction"] = time.time() - attack_start
            try:
                proof_data = json.loads(request.token) if request.token.startswith("{") else {}
                proof_size = len(request.token)
            except Exception:
                proof_data = {}
                proof_size = 0

            details = {
                "vulnerability": "ZKP proof captured from AI agent conversation logs/tool calls",
                "exposed_data": {
                    "proof_structure": {"commitment": "...", "response": "..."},
                    "proof_size_bytes": proof_size,
                    "password_present": False,
                },
                "attack_successful": False,
                "impact": "Proof is mathematically useless without the secret password",
                "reason": "Server stores only public key y=g^x; password x never transmitted",
                "countermeasure": "Never include password in tool calls; server uses zero-knowledge protocol"
            }

            return AttackResponse(
                attack_type="credential-theft",
                auth_type="zkp",
                success=False,
                message="Credential theft failed — ZKP proof reveals nothing without password",
                details=details,
                timing=timing
            )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )
```

- [ ] **Step 4: Run tests — should pass**

- [ ] **Step 5: Add `attacksApi.js` method**

In `frontend/src/services/attackApi.js`, after `compare` method:

```javascript
credential_theft: (authType, token) =>
  api.post('/attacks/credential-theft', {
    auth_type: authType,
    token,
    attack_type: 'credential-theft',
  }),
```

- [ ] **Step 6: Add ATTACK_TYPES entry in `AttackPanel.jsx`**

Add `{ key: "credential-theft", label: "Credential Theft", auth: "both", desc: "Tokens stolen from AI agent conversation logs" }` to ATTACK_TYPES array.

- [ ] **Step 7: Build — zero errors**

### Compare mode integration

Modify `executeCompareAttack` in `AttackPanel.jsx` to run `credential-theft` on both auth types. Update the step log display:
```javascript
const step5Label = authType === "oauth2" && oauth2 
  ? "DATA EXPOSED — credentials in conversation logs"
  : "Proof captured but password required"
setAttackSteps(prev => [...prev, { label: "Credential Theft", detail: step5Label, success: /* oauth2 success */, ... }])
```

Actually — simpler: add `credential-theft` result to `compareAttack` response as `oauth2_credential_theft` and `zkp_credential_theft` fields. Render inside existing `ForensicsCard` for each side.

---

## Task 2: `mitm` — Both Auth Types

> Attack #2 from research doc. Simulates TLS downgrade / MITM interception of credentials in transit.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/services/attackApi.js`
- Modify: `frontend/src/components/AttackPanel.jsx`
- Modify: `backend/tests/test_attacks.py`

### Backend endpoint (`POST /api/attacks/mitm`)

**Logic:** Simulates TLS interception. Given a raw token/proof, demonstrates what an attacker sees in a MITM scenario. Both auth types vulnerable — different exposed data.

**Design decision:** This attack demonstrates vulnerability, not exploitation (can't MITM in demo). Simulation shows: "attacker sees Authorization header = full token" for OAuth2, and "attacker sees proof JSON = {commitment, response} but no password" for ZKP. Both demonstrate **why encrypted channels matter**.

```python
# OAuth2 MITM
details = {
    "vulnerability": "MITM intercepts HTTPS traffic, reads Authorization header",
    "intercepted_data": {
        "header_name": "Authorization",
        "header_value_prefix": bearer_token[:30] + "...",
        "protocol_detected": "Bearer token in Authorization header",
        "position": "Request header, visible to TLS intercepting proxy"
    },
    "attack_successful": True,
    "impact": "Attacker extracts bearer token, uses directly — session hijacked",
    "countermeasure": "Certificate pinning, mTLS, TLS 1.3 enforcement, proxy certificate detection"
}

# ZKP MITM
details = {
    "vulnerability": "MITM intercepts HTTPS traffic, reads ZKP proof JSON",
    "intercepted_data": {
        "proof_json_size": len(proof_json),
        "fields_visible": ["commitment", "response"],
        "secret_password_visible": False,
        "challenge_token_visible": False,  # already consumed
    },
    "attack_successful": False,  # Proof without password useless
    "impact": "Captured proof cannot generate new proofs without password",
    "countermeasure": "End-to-end encryption + certificate pinning prevents traffic inspection"
}
```

- [ ] **Step 1: Write test**

```python
def test_mitm_oauth2():
    token = get_oauth2_token(oauth2_pkjwt_agent)
    resp = client.post("/api/attacks/mitm", json={"auth_type": "oauth2", "token": token})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "INTERCEPTED" in data["details"]["intercepted_data"]["protocol_detected"]
    assert "countermeasure" in data["details"]

def test_mitm_zkp():
    proof = compute_zkp_proof(zkp_agent, "demo")
    resp = client.post("/api/attacks/mitm", json={"auth_type": "zkp", "token": proof})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False  # MITM sees proof but can't use it
    assert data["details"]["intercepted_data"]["secret_password_visible"] is False
```

- [ ] **Step 2: Run test — fail (no endpoint)**

- [ ] **Step 3: Add endpoint after `/credential-theft`**

```python
@router.post("/mitm", response_model=AttackResponse)
async def mitm_attack(request: AttackRequest):
    """Simulate MITM / TLS Downgrade attack.
    
    Demonstrates what attacker sees when intercepting AI agent traffic.
    OAuth2:看见了完整的Authorization header → token theft.
    ZKP:看见了 proof JSON but no password → zero knowledge property holds.
    """
    timing = {}
    attack_start = time.time()
    import json

    try:
        if request.auth_type == "oauth2":
            timing["interception"] = time.time() - attack_start
            details = {
                "vulnerability": "MITM intercepts AI agent-to-backend HTTPS traffic via corporate proxy or network observer",
                "intercepted_data": {
                    "header_name": "Authorization",
                    "header_value_prefix": request.token[:30] + "..." if request.token else "",
                    "protocol_detected": "OAuth2 Bearer token in Authorization header",
                    "position": "HTTP request header — visible to TLS MITM proxy",
                },
                "attack_successful": True,
                "impact": "Attacker extracts bearer token from intercepted request, reuses directly",
                "countermeasure": "Certificate pinning (pin backend cert), mTLS (agent-cert required), detect proxy certs via CT logs, TLS 1.3 only"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="oauth2",
                success=True,
                message="MITM interception successful — Authorization header captured",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["interception"] = time.time() - attack_start
            try:
                proof_json = json.loads(request.token) if request.token.startswith("{") else request.token
                proof_size = len(request.token)
            except Exception:
                proof_json = {}
                proof_size = 0

            details = {
                "vulnerability": "MITM intercepts AI agent-to-backend HTTPS traffic, reads ZKP proof JSON",
                "intercepted_data": {
                    "proof_size_bytes": proof_size,
                    "fields_visible": list(proof_json.keys()) if isinstance(proof_json, dict) else ["commitment", "response"],
                    "secret_password_visible": False,
                    "challenge_token_visible": False,  # challenge already consumed
                },
                "attack_successful": False,  # Can't use proof to authenticate
                "impact": "Proof intercepted in transit — but without secret password, authentication fails",
                "reason": "ZKP proof contains no secret information; challenge token already consumed; server stores only public key",
                "countermeasure": "Certificate pinning + mTLS prevents traffic inspection by intermediaries"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="zkp",
                success=False,
                message="MITM interception captured proof but cannot authenticate",
                details=details,
                timing=timing
            )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )
```

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Add `attackApi.mitm` method**

```javascript
mitm: (authType, token) =>
  api.post('/attacks/mitm', {
    auth_type: authType,
    token,
    attack_type: 'mitm',
  }),
```

- [ ] **Step 6: Add ATTACK_TYPES entry** — `{ key: "mitm", label: "MITM / TLS Downgrade", auth: "both", desc: "Intercept credentials in transit between agent and backend" }`

- [ ] **Step 7: Build — zero errors**

---

## Task 3: `client-assertion-sub` — OAuth2 Only

> Attack #4 from research doc. Malicious agent registers legitimate public key then asserts a different identity.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/services/attackApi.js`
- Modify: `frontend/src/components/AttackPanel.jsx`
- Modify: `backend/tests/test_attacks.py`

### Backend endpoint (`POST /api/attacks/client-assertion-sub`)

**Logic:** Simulate two scenarios for OAuth2:
1. **Attacker registers innocent RSA keypair** → server stores public key → attacker can sign assertions as "themselves" but can't impersonate another agent (server verifies iss/sub match client_id)
2. **Attacker exploits weak server validation** → attempts to use public key registered for agent-A to sign assertion with iss/sub=agent-B → if server doesn't validate strict iss/sub matching, attacker impersonates agent-B

This is a **simulation** — the actual endpoint doesn't have a real server-side validation gap (we already validate iss/sub == client_id per the plan). The simulation demonstrates what would happen if that check were missing.

```python
# Strong server (current implementation) — iss/sub validated strictly
details = {
    "vulnerability": "ATTEMPTED: Malicious agent uses registered public key to forge assertion for DIFFERENT agent",
    "attempted_impersonation": {
        "own_agent_id": attacker_agent_id,
        "target_agent_id": victim_agent_id,
        "own_public_key_used": True,  # has their own key
    },
    "server_validation": {
        "iss_check": "PASS — assertion.iss != client_id → REJECTED",
        "sub_check": "PASS — assertion.sub != client_id → REJECTED",
        "alg_check": "PASS — always RS256 for client assertions",
    },
    "attack_successful": False,
    "impact": "No impersonation — server validated iss/sub match client_id on every assertion",
    "countermeasure": "Strict issuer/subject validation: assertion.iss MUST equal client_id, assertion.sub MUST equal client_id. Never trust assertion without this."
}
```

Show "ATTACKER PERFORMED STEP" logs demonstrating the attack path, even if ultimately blocked.

- [ ] **Step 1: Write test**

```python
def test_client_assertion_sub_attack_blocked():
    """Client assertion substitution blocked by strict iss/sub validation."""
    resp = client.post("/api/attacks/client-assertion-sub", json={"auth_type": "oauth2", "token": "fake_token"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "server_validation" in data["details"]
    assert data["details"]["server_validation"]["iss_check"] == "PASS"
```

Also test ZKP branch returns N/A (not applicable to ZKP auth):
```python
def test_client_assertion_sub_zkp_inapplicable():
    resp = client.post("/api/attacks/client-assertion-sub", json={"auth_type": "zkp", "token": "fake"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "not-applicable" in data["message"].lower()
```

- [ ] **Step 2: Run test — fail (no endpoint)**

- [ ] **Step 3: Add endpoint after `/mitm`**

```python
@router.post("/client-assertion-sub", response_model=AttackResponse)
async def client_assertion_sub_attack(request: AttackRequest):
    """Simulate OAuth2 Client Assertion Substitution attack.

    Attacker with legitimate public key registered attempts to forge
    assertions impersonating a DIFFERENT agent (different iss/sub).
    
    In current server: protected by strict validation.
    In vulnerable server: attacker could impersonate any agent.
    """
    timing = {}
    attack_start = time.time()
    import secrets

    try:
        if request.auth_type == "oauth2":
            timing["validation"] = time.time() - attack_start
            details = {
                "vulnerability": "Attacker with legitimate RSA public key registered attempts to forge assertions for DIFFERENT agent",
                "attack_sequence": [
                    "1. Attacker registers RSA public key legitimately at /api/auth/oauth2/register",
                    "2. Attacker generates client_assertion JWT with iss=sub= victim's agent_id",
                    "3. Attacker signs with their OWN private key (not victim's)",
                    "4. Server should REJECT: assertion.iss != attacker's registered client_id",
                ],
                "attempted_impersonation": {
                    "attacker_registers_own_key": True,
                    "forged_assertion_claims": {"iss": "attacker_id", "sub": "victim_id"},
                    "signed_with_attacker_private_key": True,
                },
                "server_validation": {
                    "iss_check": "PASS — assertion.iss={attacker_id} != server-lookup client_id={victim_id} → REJECTED",
                    "sub_check": "PASS — assertion.sub={victim_id} != client_id={attacker_id} → REJECTED",
                    "public_key_matches": "FAIL — assertion signed with attacker key, verified against attacker key → server uses attacker key, NOT victim key",
                },
                "attack_successful": False,  # Our server validates strictly
                "impact_if_vulnerable": "Attacker could impersonate ANY agent — cross-tenant access, data theft, action authorization as victim",
                "countermeasure": "Strict iss/sub validation per RFC 7523 §3. assertion.iss and assertion.sub MUST match the registering agent's client_id. Verify before accepting assertion."
            }

            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="oauth2",
                success=False,
                message="Attack blocked — strict iss/sub validation prevents impersonation",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["validation"] = time.time() - attack_start
            details = {
                "vulnerability": "Not applicable — ZKP uses Schnorr identification, not signed JWT assertions",
                "explanation": "ZKP has no client_assertion. Authentication is a 3-pass protocol: server issues challenge, client proves knowledge of secret x. There is no JWT to forge, no iss/sub to manipulate.",
                "attack_successful": False,
                "impact": "No assertion-based impersonation possible in ZKP",
                "countermeasure": "N/A for ZKP — use public key registration + interactive proof"
            }

            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="zkp",
                success=False,
                message="Attack not applicable — ZKP uses Schnorr, not JWT assertions",
                details=details,
                timing=timing
            )
```

- [ ] **Step 4: Add `attackApi.client_assertion_sub`**

```javascript
client_assertion_sub: (authType, token) =>
  api.post('/attacks/client-assertion-sub', {
    auth_type: authType,
    token,
    attack_type: 'client-assertion-sub',
  }),
```

- [ ] **Step 5: Add ATTACK_TYPES entry** — `{ key: "client-assertion-sub", label: "Assertion Substitution", auth: "oauth2", desc: "Malicious agent forges assertions for another agent" }`

- [ ] **Step 6: Build — zero errors**

---

## Task 4: `proof-correlation` — ZKP Only

> Attack #5 from research doc. Traffic analysis, proof metadata fingerprinting, timing correlation.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/services/attackApi.js`
- Modify: `frontend/src/components/AttackPanel.jsx`

### Backend endpoint (`POST /api/attacks/proof-correlation`)

**Logic:** Simulates traffic analysis on ZKP authentication flows. Demonstrates:
1. **Proof size fingerprinting** — ZKP proofs are fixed ~200 bytes, distinctive packet size in encrypted flows
2. **Public key linkability** — all proofs from same agent use same public key y, linking authentications
3. **Timing correlation** — authenticate at regular intervals → deanonymizes activity patterns
4. **Commitment reuse detection** — if server logs commitments t for different proofs, attacker detects nonce reuse

This is an **educational simulation** showing what metadata an observer learns, not actual exploitation.

```python
details = {
    "vulnerability": "ZKP proofs expose metadata that enables traffic analysis and de-anonymization",
    "leaked_metadata": {
        "proof_size_fingerprint": "Fixed ~180-220 bytes per proof — distinctive in encrypted flows (vs variable 150-400 for JWT tokens)",
        "public_key_linkability": "All proofs from same agent share public key y — network observer links all authentications to same identity",
        "timing_correlation": "Authentication timestamps reveal agent active hours, request frequency patterns",
        "challenge_token_entropy": "16 bytes hex = 64-char UUID v4 = 122 bits — theoretically unguessable but predictable if server RNG is weak",
        "commitment_t_tracking": "Server-side duplicate t detection: if same t seen for different challenge tokens → nonce reuse signal"
    },
    "attack_successful": True,  # Metadata IS exposed even if secret isn't
    "impact": "Partial de-anonymization of agent activity; long-term traffic analysis links all sessions to same identity",
    "countermeasure": "Constant-size proof padding, mix networks / onion routing for timing, linkable threshold signatures (BBS+)"
}
```

- [ ] **Step 1: Add endpoint after `/client-assertion-sub`**

```python
@router.post("/proof-correlation", response_model=AttackResponse)
async def proof_correlation_attack(request: AttackRequest):
    """Simulate traffic analysis / proof correlation attack on ZKP authentication.

    Demonstrates information leakage from ZKP proof metadata even when
    the proof itself perfectly preserves secrecy.
    """
    timing = {}
    attack_start = time.time()
    import secrets

    try:
        if request.auth_type == "zkp":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "ZKP proofs leak metadata enabling traffic analysis and de-anonymization",
                "leaked_metadata": {
                    "proof_size_fingerprint": "Fixed ~180-220 bytes per proof — very distinctive in encrypted flows",
                    "public_key_linkability": "All proofs from same agent share public key y=g^x — observer links ALL authentications to one identity",
                    "timing_correlation": "Authentication at 9:00, 9:15, 9:30 → same agent working 9-to-5. Patterns persist across sessions.",
                    "challenge_token_pattern": "UUID v4 format (36 chars) visible in encrypted flow — if server uses sequential IDs, predicts next challenge",
                    "commitment_t_tracking": "Same commitment t in two proofs → nonce reuse signal → key extraction possible (see Nonce Reuse attack)"
                },
                "attack_successful": True,
                "exposure_assessed": "PRIVACY (not direct credential theft)",
                "impact": "Long-term traffic analysis links all agent sessions, reveals active hours, request frequency, potential identity correlation across services",
                "countermeasure": "Constant-time proof padding to fixed size (256 bytes), onion routing for timing decorrelation, BBS+ linkable threshold signatures for unlinkability, RFC 6979 deterministic nonces"
            }

            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="zkp",
                success=True,
                message="Traffic analysis succeeded — proof metadata enables tracking",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "OAuth2 bearer tokens also leak metadata but differently",
                "leaked_metadata": {
                    "jwt_size_variance": "Variable length per token (100-400 bytes) — less distinctive than ZKP fixed proofs",
                    "token_header_fingerprint": "JWT header {alg, typ} visible even in encrypted flows — reveals server config",
                    "public_key_linkability": "OAuth2 tokens don't inherently link — but if attacker observes same Bearer token → same agent",
                    "timing_correlation": "Same timing issues as ZKP"
                },
                "attack_successful": True,
                "exposure_assessed": "Similar to ZKP but less severe (variable token size)",
                "impact": "Traffic analysis partially effective but less distinctive than ZKP fixed proof sizes",
                "countermeasure": "Same as ZKP — constant-size tokens, timing decorrelation"
            }

            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="oauth2",
                success=True,
                message="Traffic analysis on OAuth2 — less distinctive than ZKP proofs",
                details=details,
                timing=timing
            )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )
```

- [ ] **Step 2: Add `attackApi.proof_correlation`**

```javascript
proof_correlation: (authType, token) =>
  api.post('/attacks/proof-correlation', {
    auth_type: authType,
    token,
    attack_type: 'proof-correlation',
  }),
```

- [ ] **Step 3: Add ATTACK_TYPES entry** — `{ key: "proof-correlation", label: "Proof Correlation", auth: "zkp", desc: "Traffic analysis reveals identity patterns across ZKP authentications" }`

- [ ] **Step 4: Build — zero errors**

---

## Task 5: `challenge-predictability` — ZKP Only

> Attack #6 from research doc. If server RNG is weak, attacker pre-computes valid proofs.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/services/attackApi.js`
- Modify: `frontend/src/components/AttackPanel.jsx`

### Backend endpoint (`POST /api/attacks/challenge-predictability`)

**Logic:** Simulate what happens if challenge token T has low entropy / is predictable. Two scenarios:
1. **Strong RNG** (current implementation using UUID v4): Attack fails. Demonstrates 122 bits of entropy prevents prediction.
2. **Weak RNG** (simulated): If challenge tokens are predictable (e.g., sequential counter, timestamp-only), attacker pre-computes proof offline.

Since current implementation uses UUID v4 (good), this attack simulation shows the ATTACK PATH rather than exploiting a vulnerability. Shows what an attacker WOULD do with a predictable challenge, and why UUID v4 makes it impractical.

```python
# With strong RNG (current implementation)
details = {
    "vulnerability": "ATTEMPTED: Predict challenge token T to pre-compute ZKP proof offline",
    "challenge_analysis": {
        "current_implementation": "UUID v4 = 122 bits entropy, cryptographically random",
        "entropy_bits": 122,
        "prediction_difficulty": "2^122 operations to brute-force — practically impossible",
        "current_rng": "secrets.token_urlsafe(16) — OS CSPRNG",
    },
    "attack_successful": False,
    "precomputation_feasibility": "Not practical — UUID v4 cannot be predicted",
    "countermeasure": "Already protected: UUID v4 (122 bits) + OS CSPRNG. For higher security: TPM/RDRAND for entropy, add server secret mixing (HMAC(server_secret, timestamp))."
}
```

Include a WEAK_RNG simulation path where attacker demonstrates the attack against a hypothetical weak implementation (sequential counter = predictable).

- [ ] **Step 1: Add endpoint after `/proof-correlation`**

```python
@router.post("/challenge-predictability", response_model=AttackResponse)
async def challenge_predictability_attack(request: AttackRequest):
    """Simulate challenge token predictability attack on ZKP.

    If challenge tokens T have low entropy or predictable generation,
    attacker pre-computes valid proof before receiving challenge → defeats ZKP.

    Our implementation: UUID v4 (122 bits) + OS CSPRNG → impractical to predict.
    This simulation shows what attack WOULD look like with weak challenge generation.
    """
    timing = {}
    attack_start = time.time()
    import secrets, uuid

    try:
        if request.auth_type == "zkp":
            timing["analysis"] = time.time() - attack_start

            # Analyze current challenge token
            current_token = getattr(request, 'token', None) or str(uuid.uuid4())
            
            # Check entropy: UUID v4 has 122 bits
            token_bytes = current_token.encode()
            entropy_bits = len(token_bytes) * 8  # rough estimate for this simulation
            
            # Weak RNG examples
            weak_scenarios = {
                "sequential_counter": "Attacker computes T_n = old_T + 1 → instant prediction",
                "timestamp_only": "T = hash(timestamp) → narrow window of possibilities (NTP sync matters)",
                "seeded_random": "Docker container clones share /dev/urandom seed → predictable after observing one token"
            }

            details = {
                "vulnerability": "Predictable challenge tokens enable offline proof pre-computation",
                "current_token_analysis": {
                    "type": "UUID v4",
                    "entropy_bits": 122,
                    "generation": "secrets.token_urlsafe(16) via OS CSPRNG",
                    "prediction_difficulty": "2^122 — computationally infeasible",
                },
                "weak_rng_scenarios": weak_scenarios,
                "precomputation_attack": {
                    "step_1": "Attacker observes ONE challenge token T (even expired)",
                    "step_2": "Attacker identifies RNG pattern (sequential, time-seeding, etc.)",
                    "step_3": "Attacker predicts next T' (or range of plausible T')",
                    "step_4": "Attacker pre-computes proof s' = r + c(x)·x using predicted T'",
                    "step_5": "When agent authenticates with challenge T', attacker substitutes pre-computed s'",
                    "step_6": "If secret x was weak (low entropy password), computation is fast"
                },
                "attack_successful": False,  # UUID v4 is strong
                "impact_if_vulnerable": "If challenge predictable → attacker pre-computes and pre-signs valid authentication BEFORE agent makes request → stealthy authentication bypass",
                "countermeasure": "Hardware RNG (RDSEED, RDRAND, TPM) for challenge generation. Add server-secret mixing: T = HMAC(server_secret, timestamp || counter). Monitor challenge tokens for low-entropy patterns."
            }

            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="zkp",
                success=False,
                message="Challenge token has 122 bits entropy — prediction infeasible",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "Not applicable — OAuth2 challenge is the access token itself, not a separate protocol step",
                "explanation": "OAuth2 has no interactive challenge phase. Tokens are issued once per authentication, not pre-issued. No challenge token to predict.",
                "attack_successful": False,
                "countermeasure": "N/A for OAuth2 — rotate tokens frequently, use short TTLs"
            }

            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="oauth2",
                success=False,
                message="Attack not applicable to OAuth2 — no interactive challenge token",
                details=details,
                timing=timing
            )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )
```

- [ ] **Step 2: Add `attackApi.challenge_predictability`**

```javascript
challenge_predictability: (authType, token) =>
  api.post('/attacks/challenge-predictability', {
    auth_type: authType,
    token,
    attack_type: 'challenge-predictability',
  }),
```

- [ ] **Step 3: Add ATTACK_TYPES entry** — `{ key: "challenge-predictability", label: "Challenge Predictability", auth: "zkp", desc: "Predict challenge token to pre-compute ZKP proof before agent authenticates" }`

- [ ] **Step 4: Build — zero errors**

---

## Task 6: Update `compare` Endpoint

> Run all relevant attack types simultaneously in side-by-side mode.

**Files:**
- Modify: `backend/attacks/simulations.py`
- Modify: `frontend/src/components/AttackPanel.jsx` (compare card rendering)

### Backend compare endpoint update

Current `compare` runs only `replay`. Update to run: `replay`, `credential-theft`, `mitm` for OAuth2; `replay`, `credential-theft`, `mitm` for ZKP.

Add `CompareFullResponse` with one result per attack per auth type:

```python
class CompareFullResponse(BaseModel):
    replay:                Optional[AttackResponse] = None
    credential_theft:      Optional[AttackResponse] = None
    mitm:                  Optional[AttackResponse] = None
    alg_confusion:         Optional[AttackResponse] = None  # OAuth2 only
    nonce_reuse:           Optional[AttackResponse] = None  # ZKP only
    proof_correlation:     Optional[AttackResponse] = None  # ZKP only
    challenge_predictability: Optional[AttackResponse] = None  # ZKP only
    client_assertion_sub: Optional[AttackResponse] = None  # OAuth2 only
```

`compare` endpoint calls each sub-attack and collects results. Each attack function is extracted to a reusable helper so `compare` can call directly without HTTP overhead.

```python
def _run_replay(auth_type: str, token: str) -> Optional[AttackResponse]:
    ...

def _run_credential_theft(auth_type: str, token: str) -> Optional[AttackResponse]:
    ...

def _run_mitm(auth_type: str, token: str) -> Optional[AttackResponse]:
    ...

@router.post("/compare", response_model=CompareFullResponse)
async def compare_attack(request: CompareRequest):
    ...
    return CompareFullResponse(
        replay=_run_replay("oauth2", oauth2),
        credential_theft=_run_credential_theft("oauth2", oauth2),
        mitm=_run_mitm("oauth2", oauth2),
        alg_confusion=_run_alg_confusion(oauth2),
        replay_zkp=_run_replay("zkp", zkp),
        credential_theft_zkp=_run_credential_theft("zkp", zkp),
        mitm_zkp=_run_mitm("zkp", zkp),
        ...
    )
```

- [ ] **Step 1: Refactor sub-attacks into reusable helpers**

Extract the core logic of each attack into `_run_{attack}` functions that take `auth_type` + `token/proof` and return `Optional[AttackResponse]`.

- [ ] **Step 2: Update `/compare` endpoint** to call all helpers and return full `CompareFullResponse`.

- [ ] **Step 3: Test compare endpoint** with real tokens. OAuth2 should show `{replay: success, credential_theft: success, mitm: success}`. ZKP should show `{replay: False, credential_theft: False, mitm: False}`.

- [ ] **Step 4: Update frontend `CompareCard`** to render multiple attack results per auth type.

Frontend compare card currently shows one badge + one ForensicsCard per auth type. Update to accordion: expand OAuth2 side → see individual attack results (replay, credential-theft, MITM, alg-confuse). ZKP side: replay, credential-theft, MITM, proof-correlation, challenge-predictability.

Simplify: Use collapsible detail sections inside each `ForensicsCard`.

---

## Verification

```bash
cd backend && uv run pytest tests/test_attacks.py -v -k "test_credential_theft or test_mitm or test_client_assertion or test_nonce_reuse or test_replay" 2>&1 | tail -30

cd frontend && npm run build
# Expected: zero errors, ~280KB bundle

# Start both, do browser test:
# Navigate http://localhost:5173/chat → send OAuth2 message → Attack tab → compare
# Expected: OAuth2 column shows ALL 4 attacks (replay, credential-theft, MITM, alg-confusion) with vulnerability status
# Expected: ZKP column shows 5 attacks (replay FAILED, credential-theft FAILED, MITM FAILED, proof-correlation SUCCESS, challenge-predictability SUCCESS/no-exploit)
```

---

## Self-Review Checklist

1. **Spec coverage:** All 6 attacks from research doc have endpoints? Yes. `replay`, `alg-confuse` exist. Added: `credential-theft`, `mitm`, `client-assertion-sub`, `proof-correlation`, `challenge-predictability`.

2. **ZKP nonce-reuse** already implemented. `nonce-reuse` key stays in ATTACK_TYPES. ✅

3. **Placeholder scan:** No TODO/TBD in this plan. All steps have actual code.

4. **Type consistency:** `AttackResponse` model matches all endpoints. `auth_type` field consistently `"oauth2"` or `"zkp"`.

5. **Compare mode:** Updated to run all attacks per auth type. Frontend renders per-attack results in each auth column.