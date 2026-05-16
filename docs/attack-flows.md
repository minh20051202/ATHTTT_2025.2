# Attack Flows

Step-by-step breakdown of each attack vector: how it works, the math, what the demo simulates, and the countermeasure.

---

## Attack 1: Credential Theft via Logs

**Auth types:** both

### How it works

An attacker with read access to AI agent conversation logs, vector DB, or observability buffers extracts bearer tokens or secrets that were logged during normal operation.

- **OAuth2:** Bearer tokens appear in `Authorization: Bearer {token}` headers, which get written to log sinks when agents log their own HTTP calls.
- **ZKP:** The secret password `x` can appear in agent system prompts or LangChain tool-call history, completely bypassing ZKP's cryptographic protection.

### Demo simulation

```
backend/utils/config.py:
  settings.log_buffer  — circular buffer, max 20 entries
                       — populated by /api/chat/intent handler
                       — captures Authorization headers on every call

backend/attacks/simulations.py → POST /attacks/credential-theft:
  1. Search log_buffer for "Authorization: Bearer {token}"
  2. For ZKP: search for "agent_secret" in log entries
  3. If found → success: True, expose stolen token/secret
  4. If not found → success: False, "Logs are clean"
```

### OAuth2 flow

```
1. Agent makes authenticated request → server logs headers to log_buffer
2. Attacker reads log_buffer (insider, DB backup, log aggregation misconfig)
3. Attacker extracts: Authorization: Bearer eyJhbGc...
4. Attacker uses token directly → access granted until expiry
```

### ZKP flow

```
1. Agent logs its system prompt (which may include the password)
   or an LLM framework logs tool-call arguments
2. Attacker finds: "password": "VictimAgentPassword123"
3. Attacker computes public key y = g^x mod p
4. All future ZKP authentications compromised → attacker computes valid proofs
```

### Countermeasures

- **OAuth2:** Short token TTL (5 min), rotate frequently, exclude tokens from logs, never persist in vector DB
- **ZKP:** Never expose secret in prompts/logs, use HSM so agent never "sees" key material, rotate sub-keys

### Why it works against both

Both schemes fail if the underlying secret leaks. ZKP is cryptographically strong but operationally weak: if the secret appears in plaintext anywhere the agent can be prompted to reveal it, the cryptographic layer is irrelevant.

---

## Attack 2: TLS Interception / MITM

**Auth types:** both

### How it works

An attacker positioned between client and server (evil proxy, TLS-terminating load balancer, compromised CA) captures credentials in transit:

- **OAuth2:** Extracts `Authorization: Bearer {token}` from decrypted traffic
- **ZKP:** Extracts `zkp_proof` from POST body during registration/intent call

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
     - Search proxy_buffer for zkp_proof or password in body (ZKP)
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
registration/intent POST body:
  {"zkp_proof": "abc123...", "password": "..."}  ← captured by proxy

Proof alone is not reusable (single-use token), but:
- Password during registration grants full access
- Proof size/metadata enables fingerprinting
```

### Countermeasures

- **mTLS:** Both client and server present X.509 certificates. Proxy cannot terminate TLS without a valid client cert.
- **TLS 1.3 + certificate pinning:** Client pins server certificate. Proxy cannot impersonate server.

---

## Attack 3: Token Replay

**Auth types:** OAuth2 (ZKP challenge tokens are already single-use and blocked)

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

**Key point:** This is not simulated — the attack genuinely calls the protected `/api/chat/intent` endpoint with the stolen token.

### ZKP: challenge token replay is blocked

ZKP challenge tokens (UUIDs) are stored in server memory and deleted after one use.

```
backend/api/chat.py:
  _challenge_store[token] = {"agent_id": ..., "expires": ...}

  # After successful verification:
  del _challenge_store[zkp_token]  # single-use

backend/attacks/simulations.py → POST /attacks/replay (ZKP path):
  1. Check if token exists in _challenge_store
  2. Token was already consumed on first use → token_present = False
  3. success: False, "Challenge token consumed on first use"
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

## Attack 4: Client Assertion Substitution

**Auth types:** OAuth2 only

### How it works

The attacker forges a `client_assertion` JWT claiming to be a different client. If the server doesn't verify that the assertion's `iss`/`sub` matches a previously registered key, the attacker can impersonate any agent.

### RFC 7523 requires

```
1. Parse assertion → get issuer (iss)
2. Look up registered public key for that issuer
3. Verify signature with THAT issuer's key
4. Refuse if assertion signed with a key not matching the registered issuer
```

A vulnerable server skips step 2–3: it accepts any valid RS256 signature for any issuer.

### Demo simulation

```
backend/attacks/simulations.py → POST /attacks/client-assertion-sub:
  1. Generate new RSA-2048 keypair (attacker's keypair)
  2. Create client_assertion JWT:
     - iss = "99"  (victim's agent_id)
     - sub = "99"  (victim's agent_id)
     - sign with attacker's private key
  3. Look up victim agent's stored public_key from DB
  4. Attempt to verify: jwt.decode(assertion, victim_public_key, RS256)

Vulnerable (settings.strict_assertion_check=False):
  - Server doesn't verify issuer→key binding
  - Forged assertion for victim_id signed by attacker_key → ACCEPTED

Secure (settings.strict_assertion_check=True):
  - Server requires assertion signed with victim's OWN registered key
  - Forged assertion signed by attacker_key → REJECTED
```

### Assertion payload (what the attacker writes)

```json
{
  "iss": "99",       ← impersonate victim agent ID 99
  "sub": "99",       ← same
  "aud": "https://oauth.example.com/token",
  "iat": 1715000000,
  "exp": 1715000300,
  "jti": "unique-id-123"
}
```

Signed with attacker's `private_key_pem` → verified with victim's `public_key_pem` → **MISMATCH unless server checks the binding**.

### Countermeasures

RFC 7523 compliance: The server MUST maintain a mapping of `issuer → registered public key` and verify the assertion was signed with the key registered for that specific issuer. Never accept a valid RS256 signature as proof of identity without checking WHICH key signed it.

---

## Attack 5: Proof Correlation / Traffic Analysis

**Auth types:** ZKP only

### How it works

Even though ZKP proofs don't reveal the secret, the mathematical structure of the proof creates a persistent fingerprint:

- **Fixed proof size:** ZKP proofs (commitment + response) are always the same byte length → very distinctive
- **Shared public key:** All proof verifications use the same `y = g^x mod p` → observer can link any two proofs from the same agent
- **Commitment tracking:** If the same commitment `t` appears in two proofs, it means the nonce `r` was reused → potential nonce-reuse attack detectable

### Demo simulation

Always succeeds (this is a metadata leak, not a cryptographic break):

```
backend/attacks/simulations.py → POST /attacks/proof-correlation:
  1. timing["analysis"] = time.time() - attack_start
  2. success: True  (attack cannot be blocked, it exploits metadata leakage)
  3. Exposes:
     - proof_size_fingerprint: "~180-220 bytes per proof"
     - public_key_linkability: "All proofs share public key y"
     - commitment_t_tracking: "Same t in two proofs → nonce reuse signal"
```

### Why OAuth2 is not susceptible

OAuth2 tokens are opaque UUIDs with no mathematical relationship between one token and the next. No shared state to fingerprint.

### Long-term implications

```
Observations over time:
  Proof 1: {t: abc..., size: 186 bytes, at: 10:00:01}
  Proof 2: {t: def..., size: 186 bytes, at: 10:15:23}
  Proof 3: {t: ghi..., size: 186 bytes, at: 10:31:07}

Analysis:
  - All proofs same size → same client configuration → same agent
  - All from same public key y → definitively same identity
  - Timing shows active hours: 10:00-10:35
  - Frequency: ~every 15 minutes

Result: Full activity profile of this agent over weeks/months
```

### Countermeasures

- **Constant-time proof padding:** Pad proofs to fixed byte length regardless of actual content
- **Onion routing:** Route requests through multiple proxies that strip identifying headers
- ** BBS+ / threshold signatures:** Group signatures that hide which member signed without cryptographic proof metadata

---

## Attack 6: Nonce Reuse

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
| 1 | Credential Theft via Logs | both | Secrets in observability | Log hygiene, HSM, short TTL |
| 2 | TLS Interception / MITM | both | No mTLS | mTLS + TLS 1.3 pinning |
| 3 | Token Replay | OAuth2 | Stateless JWT reuse | DPoP, short TTL, JTI |
| 3 | Challenge Replay (ZKP) | ZKP | — | Already blocked (single-use token) |
| 4 | Client Assertion Substitution | OAuth2 | Missing issuer→key binding check | Strict RFC 7523 validation |
| 5 | Traffic Analysis / Proof Correlation | ZKP | Proof metadata leaks identity | Padding, onion routing, BBS+ |
| 6 | Nonce Reuse | ZKP | CSPRNG failure or state reuse | RFC 6979 deterministic nonce |