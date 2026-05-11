# Authentication Flows

> Complete end-to-end documentation for both auth mechanisms used in this demo.

---

## OAuth2 PKJWT (RFC 7523 — Private Key JWT)

### Standards

- **RFC 7523** — JWT Profile for OAuth2 Client Authentication
- **RFC 7521** — Assertion Format for OAuth2 Client Authentication
- **RFC 7519** — JSON Web Token (JWT)
- **RFC 7515** — JSON Web Signature (JWS) — RS256 signing
- **RFC 7519** — HMAC using SHA-2 — HS256 signing for access tokens

### Architecture

```
Client Browser                    Server                         DB
     |                               |                           |
     |  1. Generate RSA-2048 keypair  |                           |
     |  (WebCrypto API)              |                           |
     |                                |                           |
     |  2. POST /api/auth/oauth2/register                        |
     |     public_key_pem ──────────────────────────────────────►| (stored in agents.public_key)
     |                                |                           |
     |  3. POST /api/auth/oauth2/token                            |
     |     client_assertion (JWT signed  |                        |
     |     with private key, RS256)   │                           |
     |  ─────────────────────────────►| 4. Verify client_assertion|
     |                                  |   with stored public_key |
     |                                  |   (asymmetric RS256)     |
     |                                  |                          |
     |  5. Access token (JWT signed     |                          |
     |     with server's HMAC secret,  │                          |
     |     HS256, server-symmetric)    │                          |
     |  ◄─────────────────────────────|                           |
     |                                |                           |
     |  6. POST /api/chat/intent        |                          |
     |     Bearer {access_token}       │                          |
     |  ─────────────────────────────►| 7. Verify (symmetric)    |
     |                                  |   with same HMAC secret |
```

### Key Security Property

**Server never stores per-agent private keys.** The demo originally did (old `oauth2_private_key` column), but the current implementation follows RFC 7523 correctly: the client holds the private key, signs the `client_assertion`, and the server verifies with the stored public key. Access tokens are issued with the server's own HMAC secret (HS256), not per-agent RS256.

### Flow Step-by-Step

#### Step 1: Client generates RSA keypair

Client uses WebCrypto API to generate an RSA-2048 keypair. The private key **never leaves the browser**.

```javascript
// frontend/src/lib/oauth2.js
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
)
const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
```

#### Step 2: Client registers public key

```http
POST /api/auth/oauth2/register
Content-Type: application/x-www-form-urlencoded

client_id=1&public_key_pem=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhki...
```

Server validates the PEM is a valid RSA PUBLIC KEY, then stores it in `agents.public_key`.

#### Step 3: Client creates client_assertion JWT (for token endpoint)

```javascript
// frontend/src/services/authApi.js
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
const now = Math.floor(Date.now() / 1000)
const payload = base64url(JSON.stringify({
  iss: String(agentId),
  sub: String(agentId),
  aud: 'agentic-commerce',
  iat: now,
  exp: now + 300,  // 5 minutes
  jti: crypto.randomUUID(),
}))
const signingInput = `${header}.${payload}`
const signature = await crypto.subtle.sign(
  'RSASSA-PKCS1-v1_5',
  privateKeyCryptoKey,
  new TextEncoder().encode(signingInput)
)
const client_assertion = `${signingInput}.${base64url(new Uint8Array(signature))}`
```

**Signed with the client's private key (asymmetric).** Server verifies with the stored public key.

#### Step 4: Token endpoint verifies and issues access token

```python
# backend/auth/oauth2.py — OAuth2Auth.create_client_assertion()
# Verifies the client_assertion JWT with the stored public_key (RS256)
# Then issues an access token signed with the server's symmetric HMAC secret (HS256)

# backend/auth/oauth2.py — OAuth2Auth.create_access_token()
access_token = jwt.encode(
    {"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"},
    settings.jwt_secret,   # server's symmetric HMAC secret
    algorithm="HS256"
)
```

#### Step 5–7: Subsequent requests use the access token

```http
POST /api/chat/intent
Authorization: Bearer {access_token}
```

Server verifies the access token with the shared HMAC secret (symmetric).

---

## ZKP Schnorr (Schnorr Identification Protocol)

### Standards

- **Schnorr Identification Protocol** — Fiat-Shamir transform for non-interactive proof
- **Security relies on:** hardness of discrete logarithm in the order-q subgroup of GF(p)

### Architecture

```
Server stores ONLY public key y. Server can NEVER derive the private key x.

Client (browser)                               Server                     DB
    |                                              |                        |
    |  1. Generate random private key x            |                        |
    |  2. Compute public key y = g^x mod p         |                        |
    |  3. POST /api/auth/zkp/register             |                        |
    |     public_key JSON ({y,p,g,q}) ───────────────────────────────►    | (stored in agents.public_key)
    |                                              |                        |
    |  4. GET /api/chat/zkp-challenge/{agent_id}  |                        |
    |  ◄──────────────────────────────────────────| token = challenge       |
    |                                              |                        |
    |  5. Compute proof locally:                   |                        |
    |     - r = random nonce                       |                        |
    |     - t = g^r mod p  (commitment)           |                        |
    |     - c = H(t ‖ token) mod q  (challenge)  |                        |
    |     - s = r + c·x mod q  (response)         |                        |
    |                                              |                        |
    |  6. POST /api/chat/intent                    |                        |
    |     {zkp_token, zkp_proof}                   |                        |
    |  ─────────────────────────────────────────► | 7. Verify proof        |
    |                                              | 8. g^s ≡ t·y^c (mod p) |
    |  9. 200 OK / result                          |                        |
    |  ◄──────────────────────────────────────────|                        |
```

### Key Security Property

**The password (or private key) never leaves the browser.** The server cannot compute the private key from the public key (discrete logarithm problem). The server cannot replay challenges (tokens are single-use, 60s TTL).

### Domain Parameters

Shared between client and server (hardcoded in both):

```javascript
// frontend/src/lib/zkp.js
const P = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ffn  // 257-bit safe prime
const Q = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b78612769242e4cffn  // 256-bit order
const G = 4n                                                                                    // generator
```

```python
# backend/auth/zkp.py
_DHP = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff
_DHQ = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b78612769242e4cff
_DHG = 0x4
```

p and q satisfy: p = 2q + 1 (q is a safe prime, g generates the order-q subgroup).

### Flow Step-by-Step

#### Key Generation (one-time on first ZKP tab load)

```javascript
// frontend/src/lib/zkp.js

// Random private key — stays in browser memory
function generatePrivateKey() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  let key = 0n
  for (let i = 0; i < array.length; i++) {
    key = (key << 8n) + BigInt(array[i])
  }
  return key % Q  // reduced modulo q
}

async function generateKeyPair() {
  const x = generatePrivateKey()                          // random 256-bit private key
  const y = modPow(G, x, P)                              // public key y = g^x mod p
  return {
    privateKey: x.toString(16),                           // hex, stored in sessionStorage
    publicKey: JSON.stringify({ y: y.toString(16), p, g, q })  // hex strings
  }
}
```

Server receives and stores the JSON: `{"y":"deadbeef...", "p":"1cf3...", "g":"4", "q":"e798..."}`

Server stores this JSON string in `agents.public_key`. All values are hex strings.

#### Step 4: Get challenge token

```http
GET /api/chat/zkp-challenge/2
```

```python
# backend/api/chat.py
token = str(uuid.uuid4())           # random 48-byte URL-safe token
_challenge_store[token] = {
    "agent_id": agent_id,
    "expires": time.time() + 60     # 60-second TTL
}
return {"zkp_token": token, "agent_id": agent_id}
```

The token is a UUID v4 — unpredictable, single-use, time-limited.

#### Step 5: Client computes proof

The client performs the Schnorr 3-pass interaction (Fiat-Shamir transformed to non-interactive):

```javascript
// frontend/src/lib/zkp.js

async function signWithPrivateKeyHex(privateKeyHex, token) {
  const x = BigInt(`0x${privateKeyHex}`)   // parse hex private key

  // Commitment: r = random, t = g^r mod p
  const r = generatePrivateKey()
  const t = modPow(G, r, P)

  // Challenge: c = H(t ‖ token) mod q  (Fiat-Shamir: use token as "challenge")
  const c = (await hashToBigInt(`${t.toString(16)}${token}`)) % Q

  // Response: s = r + c·x mod q
  const s = (r + c * x) % Q

  return JSON.stringify({
    commitment: t.toString(16),  // hex string
    response: s.toString(16)      // hex string  ← CRITICAL: must be hex, NOT decimal
  })
}
```

**Important encoding:** Both `commitment` and `response` are **hex strings**. `BigInt.toString(16)` produces hex. `BigInt.toString()` (no radix) produces **decimal** — the root cause of the 401 bug during development.

Proof JSON example:
```json
{"commitment":"166b785a0505d8f8c6bbbf3702a0d73055f5ddc9fd42033d10918c16e947ac68e","response":"1a2b3c..."}
```

#### Step 6–7: Server verifies proof

```python
# backend/auth/zkp.py

def _verify_schnorr(proof_data, pk_json, token):
    proof = json.loads(proof_data)         # {"commitment": "...", "response": "..."}
    pk    = json.loads(pk_json)           # {"y": "...", "p": "...", "g": "...", "q": "..."}

    # Parse hex strings to ints (accepts hex strings from browser, ints from tests)
    def to_int(v):
        return int(v, 16) if isinstance(v, str) else int(v)

    t = to_int(proof["commitment"])       # g^r mod p
    s = to_int(proof["response"])         # r + c·x mod q
    y = to_int(pk["y"])                   # g^x mod p (stored public key)
    p = to_int(pk["p"])
    g = to_int(pk["g"])
    q = _DHQ

    # Recompute challenge from stored token (same as client)
    c = int(hashlib.sha512(f"{t:x}{token}".encode()).hexdigest(), 16) % q

    # Verify Schnorr equation: g^s ≡ t · y^c (mod p)
    left  = pow(g, s, p)
    right = (pow(y, c, p) * (t % p)) % p

    return left == right
```

**The verification equation** derives from:
- Client knows: `s = r + c·x (mod q)`
- Server computes: `g^s = g^(r+cx) = g^r · g^(cx) = t · (g^x)^c = t · y^c (mod p)`
- If client doesn't know x, the response s will be wrong, and `g^s ≠ t · y^c`

### Token Lifecycle

| Token | Generated by | Stored in | Lifetime | Purpose |
|-------|-------------|-----------|----------|---------|
| `zkp_token` | Server (UUID v4) | Server memory (`_challenge_store`) | 60s | Prevent replay, bind challenge to session |
| `client_assertion` (OAuth2) | Client (JWT) | Not stored | 5 min | Prove client holds private key |
| `access_token` (OAuth2) | Server | Not stored (stateless JWT) | 1h | Authorize API requests |

---

## Comparison

| Aspect | OAuth2 PKJWT | ZKP Schnorr |
|--------|-------------|-------------|
| **RFC** | RFC 7523 | Schnorr ID (Fiat-Shamir) |
| **Key type** | RSA-2048 (asymmetric) | Safe prime + subgroup (discrete log) |
| **Server stores private key** | No | N/A (no private key exists) |
| **Secret transmission** | Client signs JWT (proves private key possession) | Server never sees secret |
| **Replay protection** | `jti` + token TTL | Single-use token per request |
| **Client computation** | RSA sign (heavy) | Hash + modular exponentiation (fast) |
| **Server computation** | RSA verify + HMAC verify | 3× modpow + hash (fast) |
| **Standardization** | IETF standard | Academic (used in Bitcoin Taproot) |