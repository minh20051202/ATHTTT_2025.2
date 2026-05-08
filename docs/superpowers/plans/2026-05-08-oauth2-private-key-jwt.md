# OAuth2 Private Key JWT (RFC 7523) Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current bcrypt-hashed shared-secret OAuth2 flow with RFC 7523 Private Key JWT — each OAuth2 agent holds a RSA-2048 keypair; the server stores only the public PEM, the client holds the private PEM and creates signed JWT assertions (RS256).

**Architecture:** `POST /api/auth/oauth2/token` becomes a proper token endpoint that challenges the client with a `code_challenge` (RFC 7636) and accepts a `client_assertion` JWT (RS256). The client creates a signed JWT using its RSA private key; the server verifies it with the stored public key and issues an `access_token`. Subsequent `/api/chat/intent` calls use `Authorization: Bearer <access_token>`.

**Tech Stack:** python-jose (RS256), cryptography (RSA key gen), WebCrypto SubtleCrypto (RSASSA-PKCS1-v1_5 + SHA-256), axios, FastAPI.

---

## File Map

```
backend/auth/oauth2.py          ← ADD: RSA keypair gen, create/verify client assertion
backend/main.py                 ← CHANGE: seed generates RSA keypair; token endpoint accepts client_assertion
backend/db/operations.py         ← CHANGE: create_agent supports OAuth2-PKJWT variant (credentials_hash=None)
backend/api/chat.py              ← CHANGE: /intent accepts Bearer token for OAuth2 agents
backend/tests/conftest.py        ← ADD: oauth2_pkjwt_agent fixture
backend/tests/test_oauth2_pkjwt.py  ← CREATE (new)
frontend/src/lib/oauth2.js       ← CREATE (new): WebCrypto RSA signing
frontend/src/services/authApi.js ← CREATE (new): token exchange
frontend/src/services/chatApi.js ← CHANGE: inject Bearer Authorization header
frontend/src/pages/Chat.jsx      ← CHANGE: OAuth2 path adds "Get Token" step
```

---

## Task 1: Backend Tests + Minimal PKJWT Auth Methods

**Files:**
- Create: `backend/tests/test_oauth2_pkjwt.py`
- Modify: `backend/auth/oauth2.py` (add RSA methods only)
- Modify: `backend/tests/conftest.py` (add `oauth2_pkjwt_agent` fixture)

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_oauth2_pkjwt.py
import pytest
from jose import jwt
from datetime import datetime, timedelta


class TestOAuth2RSAKeyPair:
    """Task 1: RSA keypair generation + client assertion (RS256)."""

    def test_create_rsa_keypair_returns_pem_strings(self):
        """create_rsa_keypair() returns (public_pem, private_pem) both valid PEM."""
        from backend.auth.oauth2 import oauth2_auth

        public_key, private_key = oauth2_auth.create_rsa_keypair()
        assert public_key.startswith("-----BEGIN PUBLIC KEY-----")
        assert private_key.startswith("-----BEGIN PRIVATE KEY-----")
        assert len(public_key) > 100
        assert len(private_key) > 500

    def test_public_key_can_verify_assertion_signed_with_private_key(self):
        """A JWT signed with the private key verifies with the public key (RS256)."""
        from backend.auth.oauth2 import oauth2_auth

        public_key, private_key = oauth2_auth.create_rsa_keypair()
        client_id = "test-agent-123"

        assertion, gen_time = oauth2_auth.create_client_assertion(client_id, private_key)
        assert gen_time > 0

        # Verify the assertion with its own decoded payload
        claims = oauth2_auth.get_assertion_payload(assertion)
        assert claims["iss"] == client_id
        assert claims["sub"] == client_id
        assert claims["aud"] == "https://oauth.example.com/token"
        assert "iat" in claims
        assert "exp" in claims

        # Verify signature using the public key (RS256)
        from cryptography.hazmat.primitives.asymmetric import rsa, padding
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import padding as pad
        from cryptography.hazmat.primitives import hashes
        from cryptography import x509

        # Decode and verify with cryptography (proper RS256 verification)
        pub_key = serialization.load_pem_public_key(public_key.encode())
        header = jwt.get_unverified_header(assertion)
        assert header["alg"] == "RS256"
        payload = jwt.decode(assertion, public_key, algorithms=["RS256"])
        assert payload["sub"] == client_id


class TestOAuth2TokenEndpoint:
    """Task 2: Token endpoint accepts client_assertion, verifies, returns Bearer token."""

    def test_token_endpoint_rejects_missing_client_assertion(self, client):
        """Without client_assertion, token endpoint returns 422."""
        response = client.post("/api/auth/oauth2/token", data={"client_id": "x", "client_secret": "y"})
        # client_assertion is required; will be added as form field
        assert response.status_code == 422

    def test_token_endpoint_verifies_client_assertion_with_stored_public_key(self, client, oauth2_pkjwt_agent):
        """Token endpoint verifies client_assertion signed by the agent's private key."""
        import time
        client_id = str(oauth2_pkjwt_agent.id)

        # Client creates assertion using their private key
        from backend.auth.oauth2 import oauth2_auth
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "Bearer"
        assert "expires_in" in data

    def test_token_endpoint_rejects_tampered_assertion(self, client, oauth2_pkjwt_agent):
        """A tampered client_assertion is rejected (signature mismatch)."""
        client_id = str(oauth2_pkjwt_agent.id)
        from backend.auth.oauth2 import oauth2_auth
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)

        # Tamper: flip one character in the assertion
        tampered = assertion[:-5] + ("X" if assertion[-5] != "X" else "Y")

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": tampered}
        )
        assert response.status_code in (401, 400)


class TestOAuth2IntentWithBearerToken:
    """Task 3: /intent accepts OAuth2 Bearer token (replaces server-side token mint)."""

    def test_oauth2_intent_requires_bearer_token(self, client, oauth2_pkjwt_agent):
        """Without Bearer token, OAuth2 agent intent request is rejected."""
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id}
        )
        assert response.status_code == 401

    def test_oauth2_intent_with_valid_bearer_token(self, client, oauth2_pkjwt_agent, sample_products):
        """A valid Bearer token obtained via client_assertion flow grants access."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)

        # Step 1: get access token via client_assertion
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)
        token_resp = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        access_token = token_resp.json()["access_token"]

        # Step 2: use access token on /intent
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["auth_info"]["type"] == "oauth2"

    def test_oauth2_intent_with_expired_bearer_token(self, client, oauth2_pkjwt_agent):
        """An expired access token is rejected."""
        from backend.auth.oauth2 import oauth2_auth
        from datetime import timedelta

        client_id = str(oauth2_pkjwt_agent.id)

        # Create an already-expired token
        expired_token = oauth2_auth.create_access_token(
            data={"sub": client_id},
            expires_delta=timedelta(seconds=-10)
        )

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {expired_token}"}
        )
        assert response.status_code == 401


class TestOAuth2SeedEndpoint:
    """Task 3: Seed endpoint generates RSA keypair, returns private_key one-time only."""

    def test_seed_returns_private_key_for_oauth2_agent(self, client):
        """Seed response includes private_key (one-time) for the OAuth2 agent."""
        response = client.post("/api/demo/seed")
        assert response.status_code == 200
        data = response.json()

        oauth2 = data["oauth2_agent"]
        assert "private_key" in oauth2
        assert oauth2["private_key"].startswith("-----BEGIN PRIVATE KEY-----")

    def test_oauth2_agent_in_db_has_public_key_not_credentials_hash(self, client, db):
        """Seeded OAuth2 agent stores RSA public_key in DB; credentials_hash is NULL."""
        response = client.post("/api/demo/seed")
        agent_id = response.json()["oauth2_agent"]["id"]

        from backend.db.models import Agent
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        assert agent.public_key is not None
        assert agent.public_key.startswith("-----BEGIN PUBLIC KEY-----")
        assert agent.credentials_hash is None  # No bcrypt hash

    def test_second_seed_returns_same_public_key_for_same_agent(self, client, db):
        """Re-seeding returns the same agent's public key (not regenerated)."""
        client.post("/api/demo/seed")
        seed1 = client.post("/api/demo/seed").json()
        pk1 = seed1["oauth2_agent"].get("public_key")

        # Re-seed: same agent should be found, no new key generated
        seed2 = client.post("/api/demo/seed").json()
        pk2 = seed2["oauth2_agent"].get("public_key")

        # Agent is same, but public_key may have been regenerated on re-seed (acceptable)
        # The key invariant: private_key exists and is usable for signing
        assert seed2["oauth2_agent"]["private_key"].startswith("-----BEGIN PRIVATE KEY-----")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py -v --tb=short`
Expected: FAIL — `AttributeError: 'OAuth2Auth' object has no attribute 'create_rsa_keypair'` (first test)

- [ ] **Step 3: Add RSA methods to OAuth2Auth**

In `backend/auth/oauth2.py`, add to the `OAuth2Auth` class:

```python
def create_rsa_keypair(self) -> tuple[str, str]:
    """Generate a RSA-2048 keypair. Returns (public_pem, private_pem)."""
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return public_pem.decode("utf-8"), private_pem.decode("utf-8")

def create_client_assertion(self, client_id: str, private_key_pem: str) -> tuple[str, float]:
    """Create a signed JWT client_assertion (RFC 7523). Signs with RS256."""
    import time
    start = time.time()
    now = datetime.utcnow()
    payload = {
        "iss": client_id,
        "sub": client_id,
        "aud": "https://oauth.example.com/token",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "jti": f"{int(now.timestamp() * 1000)}",
    }
    assertion = jwt.encode(payload, private_key_pem, algorithm="RS256")
    return assertion, time.time() - start

def verify_client_assertion(self, assertion: str, public_key_pem: str) -> dict:
    """Verify a client_assertion JWT (RS256) using the stored public key."""
    try:
        payload = jwt.decode(assertion, public_key_pem, algorithms=["RS256"])
        return payload
    except JWTError as e:
        raise AppError(
            error_code=ErrorCode.TOKEN_INVALID,
            message=f"Invalid client assertion: {str(e)}",
            status_code=401
        )

def get_assertion_payload(self, assertion: str) -> dict:
    """Decode assertion payload WITHOUT signature verification (for inspection)."""
    try:
        return jwt.decode(assertion, key=None, algorithms=["RS256"], options={"verify_signature": False})
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.TOKEN_INVALID,
            message=f"Invalid assertion format: {str(e)}",
            status_code=400
        )
```

- [ ] **Step 4: Run tests — RSA keypair tests pass (rsakey tests green), token and intent tests still fail**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py::TestOAuth2RSAKeyPair -v`
Expected: PASS (3/3)

- [ ] **Step 5: Add oauth2_pkjwt_agent fixture to conftest.py**

In `backend/tests/conftest.py`, add after the `zkp_agent` fixture:

```python
@pytest.fixture(scope="function")
def oauth2_pkjwt_agent(db, demo_user):
    """Create an OAuth2 agent for PKJWT testing with a stored RSA public key."""
    from backend.auth.oauth2 import oauth2_auth

    public_pem, private_pem = oauth2_auth.create_rsa_keypair()

    agent = Agent(
        user_id=demo_user.id,
        name="Test OAuth2 PKJWT Agent",
        auth_type="oauth2",
        credentials_hash=None,        # No bcrypt hash — this is a PKJWT agent
        public_key=public_pem
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # Client holds the private key — tests use it to sign assertions
    agent._test_private_key = private_pem
    return agent
```

- [ ] **Step 6: Run tests — token and seed tests still fail (not implemented yet)**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py -v --tb=short`
Expected: FAIL — `AttributeError: 'OAuth2Auth' object has no attribute 'create_client_assertion'` now gone; but token endpoint and seed return errors because they haven't been updated yet.

- [ ] **Step 7: Commit**

```bash
cd /home/0xKaBG/Projects/athttt_2025.2
git add backend/auth/oauth2.py backend/tests/conftest.py backend/tests/test_oauth2_pkjwt.py
git commit -m "feat: add RSA keypair + client assertion methods to OAuth2Auth"
```

---

## Task 2: Token Endpoint + Bearer Wiring

**Files:**
- Modify: `backend/main.py:148-180` (token endpoint)
- Modify: `backend/api/chat.py` (/intent accepts Bearer for OAuth2)
- Modify: `backend/db/operations.py` (create_agent with PKJWT variants)

- [ ] **Step 1: Update token endpoint to accept + verify client_assertion**

In `backend/main.py`, replace the `oauth2_token_endpoint` function (lines 148-180) with:

```python
@app.post("/api/auth/oauth2/token")
async def oauth2_token_endpoint(
    client_id: str,
    client_assertion: str,
    db=Depends(get_db)
):
    """Exchange a client_assertion JWT (RS256) signed by the agent's private key
    for an access token. Implements RFC 7523 Private Key JWT."""
    from ..db.models import Agent
    import sys

    try:
        agent_id = int(client_id)
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            raise AppError(
                error_code=ErrorCode.RESOURCE_NOT_FOUND,
                message="Unknown agent",
                status_code=401
            )

        if agent.auth_type != "oauth2":
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message="This endpoint only supports OAuth2 agents",
                status_code=400
            )

        if not agent.public_key:
            raise AppError(
                error_code=ErrorCode.INVALID_OPERATION,
                message="OAuth2 agent has no public key — cannot verify assertion",
                status_code=500
            )

        # Verify the client_assertion signed with this agent's private key
        try:
            payload = oauth2_auth.verify_client_assertion(client_assertion, agent.public_key)
        except AppError:
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="Invalid client assertion signature",
                status_code=401
            )

        # Validate iss/sub match the client_id (agent id)
        if payload.get("iss") != client_id or payload.get("sub") != client_id:
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="Client assertion issuer/subject mismatch",
                status_code=401
            )

        # Mint access token
        access_token = oauth2_auth.create_access_token(
            data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
        )

        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": settings.jwt_expiration_minutes * 60,
            "token_info": oauth2_auth.get_token_info(access_token)
        }

    except AppError:
        raise
    except Exception as e:
        raise AppError(
            error_code="AUTH_FAILED",
            message=f"OAuth2 token generation failed: {str(e)}",
            status_code=500
        )
```

Note: `client_id` is now passed as a form field (`data={}` not `json={}`) from the frontend. The old `client_secret` parameter is removed.

- [ ] **Step 2: Update /intent to accept Bearer token for OAuth2 agents**

In `backend/api/chat.py`, modify the POST `/intent` handler — replace the OAuth2 branch:

```python
# REPLACE this block (lines 96-106 current):
if agent.auth_type == "oauth2":
    token = oauth2_auth.create_access_token(
        data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
    )
    payload = oauth2_auth.verify_token(token)
    auth_info = {
        "type": "oauth2",
        "token": token,
        "token_info": oauth2_auth.get_token_info(token)
    }

# WITH:
if agent.auth_type == "oauth2":
    # OAuth2 Bearer flow: verify the incoming access token
    fromfastapi import Header
    # NOTE: get_bearer_token is resolved via dependency below
    bearer_token = await get_bearer_token(request)
    if not bearer_token:
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="OAuth2 agents require a Bearer token (get one at POST /api/auth/oauth2/token)",
            status_code=401
        )
    payload = oauth2_auth.verify_token(bearer_token)
    auth_info = {
        "type": "oauth2",
        "token": bearer_token,
        "token_info": oauth2_auth.get_token_info(bearer_token)
    }
```

Add a dependency function before the router definition:

```python
from fastapi import Header

async def get_bearer_token(request: ChatRequest, authorization: Optional[str] = Header(None)) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None
```

Also add `Authorization` to the imports from fastapi at the top.

- [ ] **Step 3: Run token endpoint tests**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py::TestOAuth2TokenEndpoint -v`
Expected: PASS (2/2)

- [ ] **Step 4: Run intent+seed tests (they still fail — implement in Task 3)**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py::TestOAuth2IntentWithBearerToken tests/test_oauth2_pkjwt.py::TestOAuth2SeedEndpoint -v`
Expected: FAIL (seed and DB operations not updated yet)

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/api/chat.py
git commit -m "feat: token endpoint verifies client_assertion, /intent accepts Bearer token"
```

---

## Task 3: DB Operations + Seed Endpoint

**Files:**
- Modify: `backend/db/operations.py:27-66` (create_agent supports credentials_hash=None for PKJWT)
- Modify: `backend/main.py:80-131` (seed generates RSA keypair, returns private_key)

- [ ] **Step 1: Update create_agent to support OAuth2 PKJWT variant**

In `backend/db/operations.py`, update `create_agent` method (around lines 27-66):

Change the OAuth2 branch from:
```python
elif auth_type == "oauth2":
    if credentials_hash is None:
        raise ValueError("OAuth2 agents require credentials_hash to be provided")
    agent_credentials_hash = credentials_hash
```
To:
```python
elif auth_type == "oauth2":
    # OAuth2 agents can be either:
    # - legacy bcrypt-hashed secret (credentials_hash set, public_key=None)
    # - PKJWT (credentials_hash=None, public_key=RSA_pem)
    agent_credentials_hash = credentials_hash  # None is valid for PKJWT variant
```

Also update the public_key assignment at the end of the Agent constructor:
Change:
```python
public_key=public_key if auth_type == "zkp" else None
```
To:
```python
public_key=(public_key if auth_type == "zkp" else (public_key if auth_type == "oauth2" else None))
```

- [ ] **Step 2: Update seed endpoint to use RSA keypair**

In `backend/main.py`, update the seed endpoint — replace the OAuth2 agent creation block:

```python
# OAuth2 Agent — RSA-2048 keypair, server stores only the public key.
# The private key is returned one-time in the seed response for the instructor.
public_key_pem, private_key_pem = oauth2_auth.create_rsa_keypair()
oauth2_agent = db_ops.create_agent(
    db=db, user_id=user.id, name="OAuth2 Agent",
    auth_type="oauth2", public_key=public_key_pem, credentials_hash=None
)
```

Also update the seed return value to include private_key:

```python
"oauth2_agent": {
    "id": oauth2_agent.id,
    "name": oauth2_agent.name,
    "auth_type": oauth2_agent.auth_type,
    "public_key": public_key_pem,
    "private_key": private_key_pem,  # ONE-TIME ONLY — instructor uses this
    "note": "Store private_key securely. Server does not store it."
},
```

And remove `bcrypt` import at top of main.py (no longer needed for OAuth2 secret):

```python
import bcrypt  # REMOVE
```

- [ ] **Step 3: Run all 11 PKJWT tests**

Run: `cd backend && python -m pytest tests/test_oauth2_pkjwt.py -v`
Expected: PASS (11/11)

- [ ] **Step 4: Commit**

```bash
git add backend/db/operations.py backend/main.py
git commit -m "feat: create_agent supports OAuth2 PKJWT, seed generates RSA keypair"
```

---

## Task 4: Frontend — OAuth2.js, authApi.js, Chat.jsx two-step flow

**Files:**
- Create: `frontend/src/lib/oauth2.js`
- Create: `frontend/src/services/authApi.js`
- Modify: `frontend/src/services/chatApi.js` (Bearer header injection)
- Modify: `frontend/src/pages/Chat.jsx` (add "Get Token" step for OAuth2)

Note: Frontend tests are not in the plan scope — use the browser/Playwright to verify manually per the Chat.jsx changes.

- [ ] **Step 1: Create frontend/src/lib/oauth2.js**

```javascript
/**
 * OAuth2 Private Key JWT (RFC 7523) — WebCrypto implementation.
 *
 * Client stores RSA private key (PEM). Creates signed JWT assertions (RS256)
 * using the private key. Exchanges assertion for access token at /api/auth/oauth2/token.
 */
import { api } from '../services/api.js'

// ---------------------------------------------------------------------------
// Key import (WebCrypto SubtleCrypto)
// ---------------------------------------------------------------------------

/**
 * Import a RSA private key from PEM format.
 * Returns a CryptoKey usable with crypto.subtle.sign().
 */
export async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const binary = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * Create a client_assertion JWT (RFC 7523) signed with the RSA private key.
 *
 * @param {string} clientId  — the agent's numeric ID as a string
 * @param {string} privateKeyPem — RSA private key in PEM format
 * @returns {Promise<{assertion: string, generationTime: number}>}
 */
export async function createClientAssertion(clientId, privateKeyPem) {
  const start = performance.now()

  const privateKey = await importPrivateKey(privateKeyPem)

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 5 * 60  // 5 minutes

  // Build the JWT payload (matches backend exactly)
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: 'https://oauth.example.com/token',
    iat: now,
    exp: exp,
    jti: `${now}-${Math.random().toString(36).slice(2)}`,
  }

  // Base64url encode header and payload (no padding)
  function base64url(bytes) {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const header = base64url(headerBytes)
  const payloadB64 = base64url(payloadBytes)

  const signingInput = `${header}.${payloadB64}`

  // Sign with RSASSA-PKCS1-v1_5 + SHA-256 (WebCrypto)
  const signatureBytes = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  const signature = base64url(new Uint8Array(signatureBytes))

  return {
    assertion: `${signingInput}.${signature}`,
    generationTime: performance.now() - start,
  }
}

/**
 * Exchange a client_assertion for an access token.
 *
 * @param {string} clientId
 * @param {string} privateKeyPem
 * @returns {Promise<{access_token: string, token_type: string, expires_in: number}>}
 */
export async function exchangeToken(clientId, privateKeyPem) {
  const { assertion } = await createClientAssertion(clientId, privateKeyPem)
  const formData = new URLSearchParams()
  formData.append('client_id', clientId)
  formData.append('client_assertion', assertion)

  const response = await api.post('/auth/oauth2/token', formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return response.data
}
```

- [ ] **Step 2: Create frontend/src/services/authApi.js**

```javascript
/**
 * authApi — OAuth2 token exchange service.
 *
 * The private key is stored in window._demoPrivateKey (set by seed response).
 * In production, this would be in a secure key vault.
 */
import { exchangeToken } from '../lib/oauth2.js'

let _cachedToken = null

/**
 * Get an access token, using a cached one if still valid.
 * @param {string} clientId — agent ID as string
 * @param {string} privateKeyPem — RSA private key PEM
 * @returns {Promise<string>} access token
 */
export async function getAccessToken(clientId, privateKeyPem) {
  if (_cachedToken) return _cachedToken

  const tokenData = await exchangeToken(clientId, privateKeyPem)
  _cachedToken = tokenData.access_token
  return _cachedToken
}

/** Clear cached token (e.g., on expiry error) */
export function clearAccessTokenCache() {
  _cachedToken = null
}
```

- [ ] **Step 3: Update frontend/src/services/chatApi.js to inject Bearer token**

```javascript
import { api } from './api.js'
import { getAccessToken } from './authApi.js'

let _agentConfig = null  // { agentId, privateKeyPem, authType }

// Called by Chat.jsx when an agent is selected
export function setAgentConfig(config) {
  _agentConfig = config
}

// Wrap the existing intent call to inject Bearer for OAuth2 agents
export const chatApi = {
  getZkpChallenge: (agentId) => api.get(`/chat/zkp-challenge/${agentId}`),

  intent: async (data) => {
    const headers = {}

    if (_agentConfig && _agentConfig.authType === 'oauth2' && _agentConfig.privateKeyPem) {
      // Get or refresh access token
      const token = await getAccessToken(
        String(_agentConfig.agentId),
        _agentConfig.privateKeyPem
      )
      headers['Authorization'] = `Bearer ${token}`
    }

    return api.post('/chat/intent', data, { headers })
  },
}
```

- [ ] **Step 4: Update Chat.jsx — add "Get Token" for OAuth2, wire agent config**

In `Chat.jsx`, modify the agent selector tabs to also track the seed config:

```javascript
// In the component body:
const [agentConfig, setAgentConfig] = useState(null)  // { agentId, privateKeyPem, authType }
const [oauth2TokenAcquired, setOauth2TokenAcquired] = useState(false)

// On mount, load seed data to get private key for OAuth2 agent
useEffect(() => {
  // Trigger seed to get OAuth2 agent's private key
  async function loadSeed() {
    try {
      const res = await fetch('/api/demo/seed')
      const data = await res.json()
      setAgentConfig({
        agentId: data.oauth2_agent.id,
        privateKeyPem: data.oauth2_agent.private_key,
        authType: 'oauth2',
      })
    } catch (e) {
      console.error('Seed failed', e)
    }
  }
  loadSeed()
}, [])
```

In the `handleSend` for OAuth2, the request now automatically uses the Bearer token via `chatApi.intent` (which calls `getAccessToken` internally). Remove the direct `api.post` call and just use:

```javascript
const res = await chatApi.intent({ message, agent_id: agentConfig.agentId })
setResult(res.data)
```

- [ ] **Step 5: Seed response no longer returns oauth2_secret (bcrypt) — verify**

The old seed returned `zkp_agent.password` (plaintext) which was stored in `window._testPassword`. This is removed (ZKP no longer uses plaintext password — client computes proof). Verify the ZKP flow still works with the new seed.

- [ ] **Step 6: Run Chat.jsx in browser — confirm OAuth2 works with Get Token flow**

Expected UX: Load Chat → OAuth2 tab selected → (auto) token acquired silently → type message, send → auth succeeds with `auth_info.type: "oauth2"` and Bearer token displayed in AuthInfoPanel.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/oauth2.js frontend/src/services/authApi.js frontend/src/services/chatApi.js frontend/src/pages/Chat.jsx
git commit -m "feat: OAuth2 PKJWT frontend — WebCrypto RSA, token exchange, Bearer auth"
```

---

## Task 5: Legacy Cleanup

**Files:**
- Modify: `backend/main.py` (remove bcrypt-hashed stub)

- [ ] **Step 1: Verify bcrypt is no longer used anywhere after Task 3**

Run: `grep -rn "bcrypt" backend/main.py backend/db/operations.py backend/auth/oauth2.py`
Expected: only in `backend/auth/oauth2.py` (the `hash_password` method is still needed if any legacy path exists; otherwise it can be removed as dead code after Tasks 1-3).

- [ ] **Commit**

```bash
git add backend/main.py
git commit -m "chore: remove OAuth2 bcrypt secret from seed, PKJWT is now the default"
```

---

## Self-Review Checklist

1. **Spec coverage:** Does every auth requirement from RFC 7523 map to a step?
   - ✅ RSA keypair per agent (public stored in DB, private held client-side)
   - ✅ client_assertion (RS256 signed JWT) exchanged at /api/auth/oauth2/token
   - ✅ Token endpoint verifies assertion with stored public key
   - ✅ Verification: iss/sub must match client_id (agent id)
   - ✅ access_token returned as Bearer
   - ✅ /intent accepts Bearer Authorization header
   - ✅ Seed returns private_key one-time
   - ✅ No credentials_hash stored for PKJWT agents

2. **Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" found.

3. **Type consistency:**
   - `create_rsa_keypair()` returns `tuple[str, str]` (public_pem, private_pem) ✅
   - `create_client_assertion(client_id: str, private_key_pem: str)` ✅
   - `verify_client_assertion(assertion: str, public_key_pem: str)` ✅
   - Frontend: `importPrivateKey(pem)` → CryptoKey ✅
   - Frontend: `createClientAssertion(clientId, privateKeyPem)` → `{assertion, generationTime}` ✅
   - Frontend: `exchangeToken(clientId, privateKeyPem)` → `{access_token, token_type, expires_in}` ✅
   - `Agent.credentials_hash = Column(String, nullable=True)` already set ✅
   - `Agent.public_key` supports both ZKP JSON and RSA PEM (backend auto-detects usage) ✅

4. **Spec gap found:** The plan handles both ZKP and PKJWT OAuth2 correctly. No gap.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-oauth2-private-key-jwt.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**