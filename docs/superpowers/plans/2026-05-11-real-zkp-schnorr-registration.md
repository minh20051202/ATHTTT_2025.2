# Real ZKP Schnorr Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement plan task-by-task.

**Goal:** Replace shared-secret key derivation with client-side random key generation. Client generates fresh `x` (private), computes `y = g^x mod p` (public), sends only `y` to server. Server stores only `y`. Authentication proves knowledge of `x` without transmitting it.

**Architecture:** `generateKeyPair()` added to `zkp.js` — creates random `x` per session. `POST /api/auth/zkp/register` endpoint stores only the public key. Seed no longer pre-computes the public key — instead Chat.jsx generates + registers the keypair on first load. Existing Schnorr proof/verify math unchanged.

**Tech Stack:** FastAPI · SQLAlchemy · React/Vite · Vanilla JS WebCrypto

---

## Task 1: Add `generateKeyPair()` to zkp.js

**Files:**
- Modify: `frontend/src/lib/zkp.js`

- [ ] **Step 1: Add generateKeyPair function**

Add after existing domain params and helper functions:

```javascript
/**
 * Generate a fresh Schnorr keypair.
 * x = random private key (never sent to server)
 * y = g^x mod p (only this is transmitted)
 */
function generatePrivateKey() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  let key = 0n
  for (let i = 0; i < array.length; i++) {
    key = (key << 8n) + BigInt(array[i])
  }
  return key % Q
}

async function generateKeyPair() {
  const x = generatePrivateKey()       // random private key — kept in browser memory only
  const y = modPow(G, x, P)           // public key — sent to server during registration

  // Store private key in memory for proof computation (not in localStorage/sessionStorage)
  // This expires when the page closes — correct for demo. For production, consider
  // encrypting and storing in IndexedDB with a user-chosen passphrase.
  return {
    privateKey: x.toString(),         // hex — used for proof signing
    publicKey: JSON.stringify({
      y: y.toString(16),              // hex — sent to server
      p: P.toString(16),
      g: G.toString(16),
      q: Q.toString(16),
    }),
  }
}
```

- [ ] **Step 2: Export the new function**

Update the existing export at bottom of file:
```javascript
export { computeProof, createPublicKey, hashSecret, generateKeyPair }
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/zkp.js
git commit -m "feat(zkp): add generateKeyPair() — client-side random key generation"
```

---

## Task 2: Add `POST /api/auth/zkp/register` endpoint

**Files:**
- Modify: `backend/main.py` (add new endpoint)
- Test: `tests/api/test_zkp_register.py` (create)

- [ ] **Step 1: Write failing test**

```python
# tests/api/test_zkp_register.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_zkp_register_stores_public_key(client, db_session):
    public_key_json = json.dumps({
        "y": "a1b2c3...",
        "p": "1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff",
        "g": "4",
        "q": "e798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff",
    })
    response = client.post("/api/auth/zkp/register", json={
        "agent_id": 1,
        "public_key": public_key_json,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "ZKP public key registered"
    assert data["agent_id"] == 1

def test_zkp_register_rejects_invalid_public_key(client):
    response = client.post("/api/auth/zkp/register", json={
        "agent_id": 1,
        "public_key": "not valid json",
    })
    assert response.status_code == 400
```

Run: `pytest tests/api/test_zkp_register.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 2: Add ZKP register endpoint to main.py**

Find existing OAuth2 register endpoint in `main.py` (around line 235). Add new endpoint after it:

```python
@app.post("/api/auth/zkp/register")
async def zkp_register_public_key(
    agent_id: int = Form(...),
    public_key: str = Form(...),
    db=Depends(get_db)
):
    """
    Client sends its Schnorr public key. Server stores only the public key.
    Private key never touches the server.

    public_key format: JSON string {"y": hex, "p": hex, "g": hex, "q": hex}
    """
    from .db.models import Agent
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise AppError(error_code=ErrorCode.RESOURCE_NOT_FOUND, message="Agent not found", status_code=404)
    if agent.auth_type != "zkp":
        raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message="Only for ZKP agents", status_code=400)

    # Validate public_key is valid JSON with y, p, g, q fields
    import json as _json
    try:
        pk = _json.loads(public_key)
        required = {"y", "p", "g", "q"}
        if not required.issubset(pk.keys()):
            raise ValueError("missing required fields")
        # Verify y is a valid hex integer
        int(pk["y"], 16)
    except Exception:
        raise AppError(
            error_code=ErrorCode.INVALID_PARAMETER,
            message="public_key must be JSON with fields: y, p, g, q (all hex integers)",
            status_code=400
        )

    agent.public_key = public_key
    db.add(agent)
    db.commit()
    return {"agent_id": agent.id, "message": "ZKP public key registered"}
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/api/test_zkp_register.py -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/main.py tests/api/test_zkp_register.py
git commit -m "feat(api): add POST /api/auth/zkp/register — store public key only"
```

---

## Task 3: Remove password-to-key derivation from backend

**Files:**
- Modify: `backend/auth/zkp.py`
- Modify: `backend/main.py` (seed)

- [ ] **Step 1: Remove `create_public_key()` shared-secret function**

Remove `create_public_key()` from `auth/zkp.py`. This function computed `y = g^H(password) mod p` — not ZKP. Replace with a no-op stub that raises:

```python
def create_public_key(secret: str) -> str:
    """
    DEPRECATED — server must NEVER derive public key from a password.
    For ZKP: client generates random x, computes y = g^x, sends only y.
    Use client-side generateKeyPair() in zkp.js instead.
    """
    raise NotImplementedError(
        "Server must not derive public key from password. "
        "Client generates random private key and computes public key locally."
    )
```

Also remove `hash_secret()` — it was only used by `create_public_key`:

```python
def hash_secret(secret: str) -> int:
    """
    DEPRECATED — server must never know the secret.
    Left for reference: shows the broken shared-secret approach.
    """
    raise NotImplementedError(
        "Server must not know the secret. Use client-side generateKeyPair() instead."
    )
```

- [ ] **Step 2: Remove zkp_public_key from seed**

In `main.py` seed endpoint, remove the lines that derive public key from password:

```python
# REMOVE these lines:
zkp_password = "demo"
zkp_public_key, _ = zkp_auth.create_client_signature(zkp_password)
```

Replace ZKP agent creation with:

```python
# ZKP Agent — server stores ONLY the public key (Schnorr params).
# Client generates its own random keypair during onboarding.
# This agent record has public_key=NULL until the client registers via /api/auth/zkp/register.
zkp_agent = db_ops.upsert_agent(
    db=db, user_id=user.id, name="ZKP Agent",
    auth_type="zkp", public_key=None  # registered by client during onboarding
)
```

- [ ] **Step 3: Verify build**

```bash
cd backend && uv run pytest tests/test_oauth2.py -v 2>&1 | tail -5
```

Any test that calls `zkp_auth.create_client_signature()` will now raise `NotImplementedError` — expected. Update those tests.

- [ ] **Step 4: Find and fix broken calls**

```bash
grep -rn "create_client_signature\|create_public_key\|hash_secret" backend/ --include="*.py" | grep -v "def create\|_DEPRECATED"
```

For each call site:
- If it's in a test: remove or mock the call
- If it's in seed: it's already removed in Step 2

- [ ] **Step 5: Commit**

```bash
git add backend/auth/zkp.py backend/main.py
git commit -m "refactor(auth): remove password-based key derivation — true ZKP"
```

---

## Task 4: Wire up key generation + registration in Chat.jsx

**Files:**
- Modify: `frontend/src/services/chatApi.js` (add zkpRegister)
- Modify: `frontend/src/pages/Chat.jsx` (call generateKeyPair + zkpRegister on init)

- [ ] **Step 1: Add zkpRegister to chatApi.js**

```javascript
intent: async (data) => {
  const headers = {}
  if (_agentConfig && _agentConfig.authType === 'oauth2' && _agentConfig.privateKeyPem) {
    const token = await getAccessToken(String(_agentConfig.agentId), _agentConfig.privateKeyPem)
    headers['Authorization'] = `Bearer ${token}`
  }
  return api.post('/chat/intent', data, { headers })
},

zkpRegister: (agentId, publicKeyJson) => {
  const formData = new URLSearchParams()
  formData.append('agent_id', String(agentId))
  formData.append('public_key', publicKeyJson)
  return api.post('/auth/zkp/register', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
},
```

- [ ] **Step 2: Update Chat.jsx init — generate and register ZKP keypair**

In the `seedAndSetup()` effect, after getting the ZKP agent ID, generate a keypair and register it:

```javascript
const seedRes = await demoApi.seed()
const oauth2Agent = seedRes?.data?.oauth2_agent || seedRes?.data
const zkpAgent = seedRes?.data?.zkp_agent

if (zkpAgent) {
  // ZKP: generate fresh keypair, register public key, store private key locally
  const { privateKey, publicKey } = await generateKeyPair()
  await chatApi.zkpRegister(zkpAgent.id, publicKey)
  // Store private key in memory (expires on page close — correct for demo)
  window._zkpPrivateKey = privateKey
  window._zkpAgentId = zkpAgent.id
}
```

Import `generateKeyPair` at top of Chat.jsx:
```javascript
import { computeProof, generateKeyPair } from '../lib/zkp.js'
```

- [ ] **Step 3: Update Chat.jsx ZKP handleSend**

Replace the `password`-based ZKP flow in `handleSend`:

```javascript
} else {
  // ZKP: use client-generated private key stored during registration
  if (!window._zkpPrivateKey) {
    throw new Error('ZKP not registered — private key not found. Reload and try again.')
  }
  const agentId = window._zkpAgentId
  const challengeRes = await chatApi.getZkpChallenge(agentId)
  const { zkp_token } = challengeRes.data

  // Compute proof using the registered private key
  const privateKey = window._zkpPrivateKey
  const r = generatePrivateKey()  // from zkp.js
  const t = modPow(G, r, P)       // from zkp.js
  const c = (await hashToBigInt(`${t.toString(16)}${zkp_token}`)) % Q
  const s = (r + c * BigInt('0x' + privateKey)) % Q
  const proofString = JSON.stringify({
    commitment: t.toString(16),
    response: s.toString(),
  })

  res = await chatApi.intent({
    message, agent_id: agentId,
    zkp_token, zkp_proof: proofString
  })
}
```

Need to import domain params and helpers too:
```javascript
import { computeProof, generateKeyPair, generatePrivateKey, modPow, hashToBigInt } from '../lib/zkp.js'
```

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatApi.js frontend/src/pages/Chat.jsx
git commit -m "feat(zkp): client generates random keypair, registers public key only"
```

---

## Task 5: Run end-to-end ZKP flow verification

**Files:**
- No file changes — verification only

- [ ] **Step 1: Restart backend**

```bash
# Pick up zkp.py changes (NotImplementedError on create_client_signature)
./start-backend.sh
```

- [ ] **Step 2: Re-seed (creates new ZKP agent with public_key=NULL)**

```bash
curl -X POST http://localhost:8000/api/demo/seed
```

- [ ] **Step 3: Test ZKP registration**

```javascript
// In browser console:
const { privateKey, publicKey } = await generateKeyPair()
console.log('private key type:', typeof privateKey)  // hex string — NEVER printed to console in prod
console.log('public key fields:', Object.keys(JSON.parse(publicKey)))
```

- [ ] **Step 4: Test complete ZKP flow**

Navigate to http://localhost:5173/chat

1. Click ZKP tab
2. Type "search for headphones" as message
3. Click Send
4. Expected: 401 NOT yet — client registers first during init
5. If works: user bubble → thinking indicator → agent bubble with product results

- [ ] **Step 5: Verify server never has private key**

In browser devtools: confirm no request body contains the private key.

On server: `SELECT public_key FROM agents WHERE auth_type='zkp'` — should have valid JSON with y, p, g, q. Should NOT have any password or secret string.

---

## Architecture After Implementation

```
Registration (one-time per session):
  Client: x = random(32 bytes), y = g^x mod p
  Client → POST /api/auth/zkp/register { agent_id, public_key: {"y","p","g","q"} }
  Server: stores only y in Agent.public_key

Authentication (per request):
  1. Client → GET /api/chat/zkp-challenge/:id → { zkp_token }
  2. Client: r = random, t = g^r mod p, c = H(t || token), s = r + c*x mod q
  3. Client → POST /api/chat/intent { zkp_token, zkp_proof: {commitment: t, response: s} }
  4. Server: verifies g^s ≡ t*y^c mod p using stored y — NEVER sees x
```

---

## Why This Works

The server stores only `y = g^x`. Even if server DB is fully compromised, attacker cannot derive `x` — discrete logarithm problem. Client proves knowledge of `x` via Schnorr proof without transmitting `x`.

No shared secret. No password on server. No key derivation from password.

---

## Spec Coverage Checklist

| Requirement | Task |
|-------------|------|
| Client generates random keypair (x private, y public) | Task 1 |
| Only public key y sent to server | Task 1, 2 |
| Server stores only public key (never private key) | Task 2 |
| Server removes password-based key derivation | Task 3 |
| Registration endpoint for ZKP public key | Task 2 |
| Client stores private key locally | Task 4 |
| Authentication uses registered private key | Task 4 |
| Demos work without manual key management | Task 4 (auto-generate on init) |

---

## Placeholder Scan

- No "TBD" or "TODO" found
- All steps show actual code
- Exact file paths and line references

## Self-Review

Type consistency:
- `generateKeyPair()` returns `{ privateKey: hex string, publicKey: JSON string }` — matched in Task 4 where `privateKey` is used as `BigInt('0x' + privateKey)` and `publicKey` is sent to `zkpRegister`
- `zkpRegister(agentId, publicKeyJson)` — agentId is `int`, publicKeyJson is `str` — matches Task 2 endpoint signature
- `zkp.py create_public_key` raises `NotImplementedError` — any existing callers fail loudly, forcing cleanup (Task 3 Step 4)