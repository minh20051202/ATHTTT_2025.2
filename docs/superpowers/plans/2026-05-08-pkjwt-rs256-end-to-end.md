# RFC 7523 PKJWT — Wired End-to-End

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the OAuth2 auth flow so the server verifies client JWTs using each agent's stored RSA public key (asymmetric RS256), not a shared symmetric secret. Make `verification_time` reflect the actual cryptographic verification cost. Fix the ZKP challenge store memory leak.

**Architecture:** The current flow has two phases: (1) Client → Token Endpoint: client assertion signed RS256, verified against stored public key → server mints a short-lived access token. (2) Client → Chat API: presents the access token. Currently phase 2 uses symmetric HS256 verification with a shared secret. The fix makes phase 2 also use per-agent public keys by storing the access token's signing key in the agent record, and fixes phase 1's `create_private_key_jwt` which incorrectly uses `self.algorithm` (HS256) instead of always using RS256.

**Key files that already work correctly and should NOT be changed:**
- `frontend/src/lib/oauth2.js` — already signs client assertions with RS256 via WebCrypto
- `main.py` token endpoint — already verifies client assertions with the agent's stored public key (RS256)
- `Agent.public_key` — already stores RSA PEM for PKJWT agents
- `create_client_assertion` and `verify_client_assertion` in `oauth2.py` — correct RS256 implementation

**Key files that need changes:**
- `backend/auth/oauth2.py` — `create_private_key_jwt` uses HS256 (should use RS256), and `verify_token` uses shared secret (should use per-agent public key)
- `backend/api/chat.py` — verify access tokens using the calling agent's public key, not shared secret
- `backend/db/models.py` — `Agent` model already has `public_key` for RSA (used by ZKP), but for PKJWT we also need the *access token signing key* stored per agent
- `main.py` — token endpoint mints access tokens with the shared `jwt_secret_key`, needs to sign with the agent's private key instead
- `backend/db/operations.py` — `create_agent` for PKJWT agents needs to store the access token signing key
- `backend/api/chat.py` — `_challenge_store` TTL cleanup is only on challenge endpoint; add background cleanup
- `frontend/src/services/authApi.js` or `frontend/src/lib/oauth2.js` — the frontend's `createClientAssertion` creates a client assertion (for token endpoint auth); after token exchange, the access token is a symmetric JWT — this is correct as the access token is server-issued. But for BenchmarkCard to show the asymmetric cost difference accurately, `verify_token` needs to measure RS256 verification time

---

### Task 1: Fix `create_private_key_jwt` to always use RS256

**Files:**
- Modify: `backend/auth/oauth2.py:123-145`
- Test: `backend/tests/test_oauth2.py` (new test for create_private_key_jwt)

The `create_private_key_jwt` method currently passes `self.algorithm` (HS256 from config) to `jwt.encode`. RFC 7523 requires RS256. Even though this method is not called in the main flow (frontend uses its own RS256 signing via WebCrypto), it should be correct for correctness and testing.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth2.py — add after existing tests
def test_create_private_key_jwt_uses_rs256():
    """create_private_key_jwt must sign with RS256, not self.algorithm (HS256)."""
    auth = OAuth2Auth()
    public_pem, private_pem = auth.create_rsa_keypair()
    client_id = "agent:42"

    jwt_token, gen_time = auth.create_private_key_jwt(client_id, private_pem)

    # Verify it was signed with RS256
    header = jwt.get_unverified_header(jwt_token)
    assert header["alg"] == "RS256", f"Expected RS256, got {header['alg']}"

    # Verify the signature with the public key
    payload = auth.verify_client_assertion(jwt_token, public_pem)
    assert payload["iss"] == client_id
    assert payload["sub"] == client_id
    assert gen_time > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/0xKaBG/Projects/athttt_2025.2 && python -m pytest backend/tests/test_oauth2.py::test_create_private_key_jwt_uses_rs256 -v`
Expected: FAIL — `assert header["alg"] == "RS256"` gets HS256

- [ ] **Step 3: Fix `create_private_key_jwt`**

Change `backend/auth/oauth2.py:142` from:
```python
encoded_jwt = jwt.encode(payload, private_key, algorithm=self.algorithm)
```
to:
```python
encoded_jwt = jwt.encode(payload, private_key, algorithm="RS256")
```
Also fix the datetime handling — `now` must be timezone-aware (`datetime.utcnow()` → `datetime.now(timezone.utc)`) to match how `jwt` library computes `exp`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_oauth2.py::test_create_private_key_jwt_uses_rs256 -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/auth/oauth2.py backend/tests/test_oauth2.py
git commit -m "fix(oauth2): create_private_key_jwt signs with RS256 per RFC 7523"
```

---

### Task 2: Add per-agent access token signing key storage

The token endpoint issues access tokens using the shared `jwt_secret_key`. For asymmetric PKJWT, each agent should have its own access token signing key pair, and `verify_token` should use the agent's public key.

**Files:**
- Create: `migrations/versions/2026-05-08_add_oauth2_signing_key.py` (Alembic migration, or SQL for SQLite)
- Modify: `backend/db/models.py:30-42` — add `oauth2_private_key` column
- Modify: `backend/db/operations.py:27-65` — `create_agent` handles PKJWT key generation
- Test: `backend/tests/test_oauth2.py` (new test)

**Migration SQL (SQLite-compatible):**
```sql
-- Add oauth2_private_key for PKJWT agents (stores per-agent access token signing key)
ALTER TABLE agents ADD COLUMN oauth2_private_key TEXT;
```

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth2.py
def test_create_agent_stores_oauth2_signing_key():
    """create_agent for auth_type=oauth2 must store an RSA private key for access token signing."""
    from backend.db.models import Agent, init_db, engine
    from backend.db.operations import create_agent
    import os
    os.environ["DATABASE_URL"] = "sqlite:///test_pkjwt.db"

    # Create fresh test DB
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    test_engine = create_engine("sqlite:///test_pkjwt.db", connect_args={"check_same_thread": False})
    from backend.db.models import Base
    Base.metadata.create_all(bind=test_engine)
    TestSession = sessionmaker(bind=test_engine)
    db = TestSession()

    try:
        from backend.db.operations import create_user
        user = create_user(db=db, username="test", email="test@test.com", password="pw")

        agent = create_agent(db=db, user_id=user.id, name="Test PKJWT", auth_type="oauth2")

        assert agent.oauth2_private_key is not None, "oauth2_private_key must be stored"
        assert "-----BEGIN PRIVATE KEY-----" in agent.oauth2_private_key, "Must be PKCS8 PEM"

        # Verify we can sign and verify with the stored key
        public_key_pem = agent.public_key  # RSA public key (already stored)
        private_key_pem = agent.oauth2_private_key
        token, _ = oauth2_auth.create_access_token_with_key(
            {"sub": str(agent.id)}, private_key_pem
        )
        # Verify with the public key
        payload = oauth2_auth.verify_token_with_public_key(token, public_key_pem)
        assert payload["sub"] == str(agent.id)
    finally:
        db.close()
        os.remove("test_pkjwt.db")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_oauth2.py::test_create_agent_stores_oauth2_signing_key -v`
Expected: FAIL — AttributeError: 'Agent' object has no attribute 'oauth2_private_key'

- [ ] **Step 3: Add `oauth2_private_key` column to Agent model**

In `backend/db/models.py`, add to the `Agent.__init__` after the existing columns:
```python
oauth2_private_key = Column(Text, nullable=True)  # Per-agent PKCS8 RSA private key for signing access tokens
```

- [ ] **Step 4: Add `create_access_token_with_key` and `verify_token_with_public_key` to OAuth2Auth**

In `backend/auth/oauth2.py`, add to the `OAuth2Auth` class:

```python
def create_access_token_with_key(
    self,
    data: Dict[str, Any],
    private_key_pem: str,
    expires_delta: Optional[timedelta] = None
) -> tuple[str, float]:
    """Create a JWT access token signed with an RSA private key (RS256)."""
    start_time = time.time()
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=self.expiration_minutes)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, private_key_pem, algorithm="RS256")
    return encoded_jwt, time.time() - start_time

def verify_token_with_public_key(self, token: str, public_key_pem: str) -> Dict[str, Any]:
    """Verify and decode a JWT access token using a stored RSA public key (asymmetric RS256)."""
    start_time = time.time()
    try:
        payload = jwt.decode(token, public_key_pem, algorithms=["RS256"])
        verification_time = time.time() - start_time
        payload["verification_time"] = verification_time
        return payload
    except JWTError as e:
        raise AppError(
            error_code=ErrorCode.TOKEN_INVALID,
            message=f"Invalid token: {str(e)}",
            status_code=401
        )
```

- [ ] **Step 5: Update `create_agent` in operations.py**

Update `backend/db/operations.py` so that when `auth_type == "oauth2"`, it generates a per-agent signing keypair and stores both keys:

```python
if auth_type == "oauth2":
    # PKJWT: generate a signing keypair per agent
    oauth2_public_key, oauth2_private_key = oauth2_auth.create_rsa_keypair()
    agent = Agent(
        user_id=user_id,
        name=name,
        auth_type=auth_type,
        credentials_hash=None,
        public_key=oauth2_public_key,
        oauth2_private_key=oauth2_private_key,  # store per-agent signing key
    )
```

- [ ] **Step 6: Add migration script**

Create `backend/db/migrations/add_oauth2_signing_key.sql`:
```sql
-- Migration: add oauth2_private_key column for per-agent PKJWT signing key
-- Run manually: sqlite3 agentic_commerce.db < backend/db/migrations/add_oauth2_signing_key.sql
ALTER TABLE agents ADD COLUMN oauth2_private_key TEXT;
```

For new databases, the model creates the column automatically via SQLAlchemy. For existing DBs, run the SQL.

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest backend/tests/test_oauth2.py::test_create_agent_stores_oauth2_signing_key -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/db/models.py backend/db/operations.py backend/auth/oauth2.py backend/db/migrations/add_oauth2_signing_key.sql backend/tests/test_oauth2.py
git commit -m "feat(oauth2): per-agent RSA signing key stored in Agent.oauth2_private_key"
```

---

### Task 3: Token endpoint signs access tokens with per-agent key

**Files:**
- Modify: `main.py` — token endpoint issues RS256-signed access tokens using the agent's per-agent `oauth2_private_key`

- [ ] **Step 1: Write the failing test**

First read `backend/tests/test_oauth2.py` to understand the existing token endpoint test pattern.

```python
# backend/tests/test_oauth2_pkjwt.py — add
def test_token_endpoint_signs_with_agent_private_key():
    """The token endpoint must sign access tokens with the agent's oauth2_private_key (RS256),
    not with the shared jwt_secret_key (HS256)."""
    # Seed creates an agent + returns private key
    resp = client.post("/api/demo/seed")
    seed_data = resp.json()
    oauth2_agent = seed_data["data"]["oauth2_agent"]
    agent_id = oauth2_agent["id"]

    # Get access token
    assertion, _ = oauth2_auth.create_client_assertion(str(agent_id), oauth2_agent["private_key"])
    token_resp = client.post("/api/auth/oauth2/token", data={
        "client_id": str(agent_id),
        "client_assertion": assertion,
    })
    access_token = token_resp.json()["access_token"]

    # Access token header must use RS256, not HS256
    header = jwt.get_unverified_header(access_token)
    assert header["alg"] == "RS256", f"Access token signed with {header['alg']}, expected RS256"

    # Verify the access token with the agent's PUBLIC key (not shared secret)
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    payload = oauth2_auth.verify_token_with_public_key(access_token, agent.public_key)
    assert payload["sub"] == str(agent_id)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_oauth2_pkjwt.py::test_token_endpoint_signs_with_agent_private_key -v`
Expected: FAIL — header["alg"] == "HS256"

- [ ] **Step 3: Fix token endpoint in main.py**

Read `main.py` around the token endpoint (lines ~153-230) and change `create_access_token` to `create_access_token_with_key`:

Change:
```python
from ..auth.oauth2 import oauth2_auth
# ...
access_token = oauth2_auth.create_access_token(
    data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
)
```

To:
```python
from ..auth.oauth2 import oauth2_auth
# ...
if not agent.oauth2_private_key:
    raise AppError(error_code=ErrorCode.INVALID_OPERATION,
                   message="OAuth2 agent has no signing key", status_code=500)
access_token, sign_time = oauth2_auth.create_access_token_with_key(
    data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"},
    private_key_pem=agent.oauth2_private_key,
)
```

Also add `sign_time` to the response so the frontend can see it for benchmarking:
```python
return {
    "access_token": access_token,
    "token_type": "Bearer",
    "expires_in": settings.jwt_expiration_minutes * 60,
    "token_sign_time_ms": round(sign_time * 1000, 3),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_oauth2_pkjwt.py::test_token_endpoint_signs_with_agent_private_key -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add main.py backend/tests/test_oauth2_pkjwt.py
git commit -m "feat(oauth2): token endpoint signs access tokens with per-agent RS256 key"
```

---

### Task 4: chat.py verifies access tokens with per-agent public key (asymmetric RS256)

**Files:**
- Modify: `backend/api/chat.py:92-110`
- Test: `backend/tests/test_chat.py` (update existing OAuth2 tests)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_chat.py — add
def test_chat_oauth2_verifies_with_agent_public_key():
    """OAuth2 /intent must verify the access token using the agent's stored public key,
    not the shared jwt_secret_key. Token signed with RS256 per-agent key."""
    # Seed and get agent
    seed_resp = client.post("/api/demo/seed")
    seed_data = seed_resp.json()["data"]
    oauth2_agent = seed_data["oauth2_agent"]
    agent_id = oauth2_agent["id"]

    # Login to get access token (signed with per-agent RS256 key)
    assertion, _ = oauth2_auth.create_client_assertion(str(agent_id), oauth2_agent["private_key"])
    token_resp = client.post("/api/auth/oauth2/token", data={
        "client_id": str(agent_id),
        "client_assertion": assertion,
    })
    access_token = token_resp.json()["access_token"]

    # Call /intent with the access token
    resp = client.post("/api/chat/intent",
        json={"message": "what is the price of Laptop", "agent_id": agent_id},
        headers={"Authorization": f"Bearer {access_token}"}
    )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()

    # Verify auth_info contains verification_time from RS256 verification
    assert "auth_info" in data
    assert data["auth_info"]["type"] == "oauth2"
    assert "verification_time" in data["auth_info"]
    assert data["auth_info"]["verification_time"] > 0  # RS256 verification takes measurable time
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_chat.py::test_chat_oauth2_verifies_with_agent_public_key -v`
Expected: FAIL — JWTError (signature verification failed) because verify_token uses shared secret

- [ ] **Step 3: Fix chat.py OAuth2 branch — verify with per-agent public key**

In `backend/api/chat.py`, lines 92-110, change the OAuth2 branch from:
```python
payload = oauth2_auth.verify_token(bearer_token)
token_info = oauth2_auth.get_token_info(bearer_token)
auth_info = {
    "type": "oauth2",
    "token": bearer_token[:20] + "...",
    "token_info": token_info,
    "verification_time": payload.get("verification_time", 0),
    "token_size": token_info.get("token_size", 0),
}
```

To:
```python
# Verify access token using the agent's stored public key (asymmetric RS256)
if not agent.public_key:
    raise AppError(
        error_code=ErrorCode.INVALID_OPERATION,
        message="OAuth2 agent has no public key",
        status_code=500
    )
payload = oauth2_auth.verify_token_with_public_key(bearer_token, agent.public_key)
token_info = oauth2_auth.get_token_info(bearer_token)
auth_info = {
    "type": "oauth2",
    "token": bearer_token[:20] + "...",
    "token_info": token_info,
    "verification_time": payload.get("verification_time", 0),
    "token_size": len(bearer_token),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_chat.py::test_chat_oauth2_verifies_with_agent_public_key -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/chat.py backend/tests/test_chat.py
git commit -m "feat(oauth2): verify access tokens with per-agent RS256 public key"
```

---

### Task 5: Fix ZKP `_challenge_store` TTL cleanup (memory leak)

**Files:**
- Modify: `backend/api/chat.py:16-19` — add periodic cleanup
- Test: `backend/tests/test_chat.py` (add memory leak test)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_chat.py — add
def test_zkp_challenge_store_cleanup():
    """Expired tokens must be removed from _challenge_store to prevent memory leak."""
    import time
    # Directly inject an expired token
    expired_token = "expired_test_token"
    _challenge_store[expired_token] = {
        "agent_id": 1,
        "expires": time.time() - 10  # expired 10s ago
    }

    # Call get_challenge which should clean up the expired token
    resp = client.get("/api/chat/zkp-challenge/1")
    assert resp.status_code == 200

    # Expired token must be gone
    assert expired_token not in _challenge_store, "Expired token was not cleaned up"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_chat.py::test_zkp_challenge_store_cleanup -v`
Expected: FAIL — expired_token still in _challenge_store

- [ ] **Step 3: Fix — add cleanup to get_challenge and standalone call on import**

At the bottom of `backend/api/chat.py`:

```python
def _cleanup_expired_challenges():
    """Remove expired challenge tokens from _challenge_store."""
    now = time.time()
    expired = [k for k, v in _challenge_store.items() if v["expires"] < now]
    for k in expired:
        del _challenge_store[k]

# Clean up expired tokens on startup and after every challenge fetch
_cleanup_expired_challenges()
```

Then in `zkp_get_challenge`, replace the inline cleanup loop:
```python
# Clean up expired tokens
_cleanup_expired_challenges()
```

Also add `atexit` cleanup for graceful shutdown (optional).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_chat.py::test_zkp_challenge_store_cleanup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/chat.py backend/tests/test_chat.py
git commit -m "fix(chat): add _cleanup_expired_challenges() to prevent memory leak"
```

---

### Task 6: Also fix `_token_store` TTL cleanup in zkp.py

The same memory leak issue exists in `backend/auth/zkp.py` lines 83-84.

- [ ] **Step 1: Add cleanup to zkp.py**

At the bottom of `backend/auth/zkp.py`, after the `_token_store` block:

```python
def cleanup_expired_tokens():
    """Remove expired tokens from _token_store. Call periodically or on each operation."""
    now = time.time()
    expired = [k for k, v in _token_store.items() if v["expires"] < now]
    for k in expired:
        del _token_store[k]
```

Call `cleanup_expired_tokens()` at the start of `generate_token` and `consume_token`.

- [ ] **Step 2: Commit**

```bash
git add backend/auth/zkp.py
git commit -m "fix(zkp): add cleanup_expired_tokens() to prevent token store memory leak"
```

---

### File Map Summary

| File | Change |
|------|--------|
| `backend/auth/oauth2.py:142` | `create_private_key_jwt` → always RS256 |
| `backend/auth/oauth2.py` | Add `create_access_token_with_key`, `verify_token_with_public_key` |
| `backend/db/models.py:30-42` | Add `oauth2_private_key` column to `Agent` |
| `backend/db/operations.py:27-65` | `create_agent` → generate per-agent signing keypair for PKJWT |
| `backend/db/migrations/add_oauth2_signing_key.sql` | New migration for existing DBs |
| `main.py` token endpoint | `create_access_token` → `create_access_token_with_key` (RS256 per-agent) |
| `backend/api/chat.py:92-110` | `verify_token` → `verify_token_with_public_key` (asymmetric RS256) |
| `backend/api/chat.py:16-19` | Add `_cleanup_expired_challenges()` called on import + after challenge fetch |
| `backend/auth/zkp.py:83-84` | `cleanup_expired_tokens()` called on token generate/consume |