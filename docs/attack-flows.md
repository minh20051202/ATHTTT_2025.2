# Attack Flows

Step-by-step breakdown of each attack vector: how it works, the math, what the demo simulates, and the countermeasure.

---

## Attack 1: TLS Interception / MITM

**Auth types:** both

### How it works

An attacker positioned between client and server (evil proxy, TLS-terminating load balancer, compromised CA) captures credentials in transit:

- **OAuth2:** Extracts `Authorization: Bearer {token}` from decrypted traffic
- **ZKP:** Extracts `zkp_proof` from POST body during intent call

### Demo simulation

```
backend/utils/config.py:
  settings.tls_downgrade_active  — True = countermeasure ON (mTLS)
                                  False = vulnerable (proxy can read traffic)

  settings.proxy_buffer  — circular buffer, populated when tls_downgrade_active=False
                          — captures full headers + body of every request

backend/attacks/simulations.py → POST /attacks/mitm:
  1. Check settings.tls_downgrade_active
  2. If False (vulnerable):
     - Search proxy_buffer for Authorization header (OAuth2)
     - Search proxy_buffer for zkp_proof in body (ZKP)
     - If found → success: True
  3. If True (countermeasure on):
     - success: False, "mTLS + TLS 1.3 pinning prevented interception"
```

### Flow through proxy

```
Client  →  [Evil Proxy]  →  Server
          |
          ↓ inspects
     Authorization header
     (decrypted at proxy,
      re-encrypted to server)

Vulnerable config (tls_downgrade_active=False):
  - proxy_buffer captures headers + body
  - Attack: extract Bearer token from header

Countermeasure (tls_downgrade_active=True):
  - mTLS: client presents certificate to proxy, proxy cannot re-encrypt without valid cert
  - TLS 1.3 with pinned certificate: client verifies server cert, proxy cannot MITM
```

### OAuth2 interception

```
1. Attacker runs transparent proxy on network path
2. Client sends: POST /api/chat/intent
   Authorization: Bearer eyJhbGc...
3. Proxy has decrypted traffic, reads token from header
4. Proxy forwards request to real server
5. Token used until expiry → attacker has persistent access
```

### ZKP interception

```
POST /api/chat/intent body:
  {"zkp_token": "...", "zkp_proof": "..."}  ← zkp_proof captured by proxy

Proof is single-use (tied to challenge), but captures proof metadata
enabling fingerprinting and traffic analysis.
```

### Countermeasures

- **mTLS:** Both client and server present X.509 certificates. Proxy cannot terminate TLS without a valid client cert.
- **TLS 1.3 + certificate pinning:** Client pins server certificate. Proxy cannot impersonate server.

---

## Attack 2: Token Replay

**Auth types:** both — implemented very differently

### OAuth2: tokens are reusable by design

OAuth2 bearer tokens are not bound to a channel or device. Anyone who has the token can use it until expiry.

```
backend/attacks/simulations.py → POST /attacks/replay (OAuth2 path):
  1. Parse stolen token → extract agent_id from JWT payload
  2. Build mock HTTP request with "Authorization: Bearer {stolen_token}"
  3. Call /api/chat/intent directly with the stolen token
  4. If intent response returns data → success: True (replay worked)
     ACTUAL endpoint was called with stolen credentials!

Demo result: "ACCESS GRANTED — Stolen bearer token used to successfully
             call the intent endpoint"
```

**Key point:** This genuinely calls the protected `/api/chat/intent` endpoint with the stolen token.

### ZKP: challenge token replay is blocked

ZKP challenge tokens (UUIDs) are stored in server memory and deleted after one use. The attack calls the real endpoint with a consumed token — server rejects it.

```
backend/api/chat.py:
  _challenge_store[token] = {"agent_id": ..., "expires": ...}

  # After successful verification:
  del _challenge_store[zkp_token]  # single-use

# Attack simulation also calls the real endpoint:
chat_req = ChatRequest(
    agent_id=zkp_agent_id,
    zkp_token=request.token,        # CONSUMED token
    zkp_proof=request.token2,
)
await extract_and_execute(...)       # → AppError: Invalid or expired token

Demo result: "REJECTED — Challenge token consumed. Real endpoint confirmed."
```

### Why ZKP blocks replay but OAuth2 doesn't

| | OAuth2 bearer token | ZKP challenge token |
|--|--|--|
| Reusable? | Yes — stateless JWT, no server state | No — deleted after verification |
| Binding | None — works from any client | Bound to commitment `t` + challenge `c` |
| TTL | Expires at `exp` claim | 60-second TTL, single-use |

### Countermeasures

- **OAuth2:** Use DPoP (RFC 9449) — binding token to a key pair prevents reuse on different devices. Short TTLs. JTI (JWT ID) for one-time use.
- **ZKP:** Already protected by single-use token design.

---

## Attack 3: Nonce Reuse

**Auth types:** ZKP only — the most dangerous Schnorr attack

### How it works

In Schnorr identification, the nonce `r` must be used for ONE proof only. If the same `r` appears in two proofs with different challenges `c1 ≠ c2`, the secret key `x` can be recovered algebraically with no brute force needed.

### The math

```
Let:
  r  = nonce (used twice)
  t  = g^r mod p  (commitment, same for both proofs)
  c1 = H(t ‖ token1) mod q  (challenge 1)
  c2 = H(t ‖ token2) mod q  (challenge 2, token2 ≠ token1 → c2 ≠ c1)
  x  = secret private key

Proof 1: s1 = r + c1·x (mod q)
Proof 2: s2 = r + c2·x (mod q)

Subtract:
  s1 - s2 = r + c1·x - r - c2·x
           = (c1 - c2)·x (mod q)

Solving for x:
  x = (s1 - s2) · inv(c1 - c2, q) (mod q)

x is FULLY RECOVERED algebraically — no discrete log, no brute force.
```

### Demo simulation

```python
# backend/attacks/simulations.py → POST /attacks/nonce-reuse

r = secrets.randbelow(_DHQ)  # reused nonce — the vulnerability
t = pow(_DHG, r, _DHP)

token1 = secrets.token_urlsafe(48)
token2 = secrets.token_urlsafe(48)  # different token

c1 = int(hashlib.sha512(f"{t:x}{token1}".encode()).hexdigest(), 16) % _DHQ
c2 = int(hashlib.sha512(f"{t:x}{token2}".encode()).hexdigest(), 16) % _DHQ

x_secret = int("deadbeef1234567890abcdef", 16) % _DHQ

s1 = (r + c1 * x_secret) % _DHQ
s2 = (r + c2 * x_secret) % _DHQ

# Attack: algebraic recovery using Extended Euclidean Algorithm
diff_c = (c1 - c2) % _DHQ   # nonzero (c1 ≠ c2)
diff_s = (s1 - s2) % _DHQ

def egcd(a, b):
    if b == 0: return (a, 1, 0)
    g, x1, y1 = egcd(b, a % b)
    return (g, y1, x1 - (a // b) * y1)

_, inv_diff_c, _ = egcd(diff_c, _DHQ)
x_recovered = (diff_s * inv_diff_c) % _DHQ

match = (x_recovered == x_secret)  # True — x fully recovered
```

### What the recovered key enables

```
x_recovered = g^x mod p  ← attacker now has the private key

From x, attacker can:
  1. Generate ANY future proof for ANY challenge
  2. Impersonate victim indefinitely
  3. Even if server rotates tokens, attacker has the secret
```

### Real-world nonce-reuse causes

- **Flaky hardware RNG** on embedded devices that returns 0 on failure
- **Virtual machine state rollback** (snapshot/restore reuses state)
- **Multithreading bugs** where two threads share the same RNG state
- **CSPRNG failure** from improper seeding

### Countermeasures

```
1. RFC 6979 deterministic nonce:
   r = HMAC-HMAC(key, message_hash)
   - Deterministic: same message always produces same r
   - Unique: different messages produce different r
   - Never repeats, even across machines/power cycles

2. Delete r immediately after use (defense-in-depth)

3. Hardware security modules (HSM) that prevent nonce reuse at firmware level

4. EdDSA (Ed25519) which is specifically designed to be resistant to nonce reuse
```

---

## Attack Summary Table

| # | Attack | Auth | Root Cause | Countermeasure |
|---|--------|------|------------|----------------|
| 1 | TLS Interception / MITM | both | No mTLS | mTLS + TLS 1.3 pinning |
| 2 | Token Replay | OAuth2 | Stateless JWT reuse | DPoP, short TTL, JTI |
| 2 | Challenge Replay (ZKP) | ZKP | — | Already blocked (single-use token) |
| 3 | Nonce Reuse | ZKP | CSPRNG failure or state reuse | RFC 6979 deterministic nonce |