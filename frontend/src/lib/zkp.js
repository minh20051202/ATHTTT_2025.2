/**
 * Client-side Schnorr Zero-Knowledge Proof implementation.
 *
 * Domain parameters match backend/auth/zkp.py exactly:
 *   p = safe prime (257-bit), q = prime divisor of p-1 (256-bit)
 *   g = generator of order-q subgroup
 *
 * All operations use native JS BigInt — no library dependencies.
 *
 * The password NEVER leaves the client. Only the proof (commitment, response)
 * is sent to the server.
 */

// ---------------------------------------------------------------------------
// Domain parameters (shared with server)
// ---------------------------------------------------------------------------
const P = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ffn;
const Q = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b78612769242e4cffn;
const G = 4n;

// ---------------------------------------------------------------------------
// Modular exponentiation via square-and-multiply
// ---------------------------------------------------------------------------

function modPow(base, exp, mod) {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// ---------------------------------------------------------------------------
// SHA-512 → BigInt (mod q)
// ---------------------------------------------------------------------------

async function hashToBigInt(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  const bytes = new Uint8Array(hashBuffer);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) + BigInt(bytes[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API — mirrors server-side create_public_key / sign_data
// ---------------------------------------------------------------------------

/**
 * Derive the private exponent: x = SHA-512(password) mod q.
 */
async function hashSecret(password) {
  return (await hashToBigInt(password)) % Q;
}

/**
 * Create a Schnorr proof for a challenge token.
 *
 * @param {string} password — the shared secret (never sent to server)
 * @param {string} token    — challenge token from GET /api/chat/zkp-challenge/:id
 * @returns {string} JSON string: {"commitment": t, "response": s}
 */
async function computeProof(password, token) {
  const x = await hashSecret(password);

  // Commitment: r ← random,  t = g^r mod p
  const r = generatePrivateKey();
  const t = modPow(G, r, P);

  // Challenge: c = SHA-512(t || token) mod q
  const c = (await hashToBigInt(`${t.toString(16)}${token}`)) % Q;

  // Response:  s = r + c·x  (mod q)
  const s = (r + c * x) % Q;

  return JSON.stringify({ commitment: t.toString(16), response: s.toString() });
}

/**
 * Create a public key from a password (for agent registration).
 *
 * @param {string} password
 * @returns {string} JSON: {"y": int, "p": int, "g": int, "q": int}
 *
 * Normally called CLIENT-SIDE during registration. The JSON is sent to
 * the server; only the public key y is ever stored.
 */
async function createPublicKey(password) {
  const x = await hashSecret(password);
  const y = modPow(G, x, P);
  return JSON.stringify({
    y: y.toString(16),              // hex — server expects hex for y
    p: P.toString(16),
    g: G.toString(16),
    q: Q.toString(16),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Schnorr keypair.
 * x = random private key (never sent to server)
 * y = g^x mod p (only this is transmitted)
 */
function generatePrivateKey() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let key = 0n;
  for (let i = 0; i < array.length; i++) {
    key = (key << 8n) + BigInt(array[i]);
  }
  return key % Q;
}

async function generateKeyPair() {
  const x = generatePrivateKey();       // random private key — kept in browser memory only
  const y = modPow(G, x, P);           // public key — sent to server during registration

  return {
    privateKey: x.toString(16),     // hex string — signWithPrivateKeyHex expects hex
    publicKey: JSON.stringify({
      y: y.toString(16),             // hex — server parses with int(v, 16)
      p: P.toString(16),
      g: G.toString(16),
      q: Q.toString(16),
    }),
  };
}

/**
 * Create a Schnorr proof using a raw hex private key (from generateKeyPair).
 * No password hashing — x is used directly.
 */
async function signWithPrivateKeyHex(privateKeyHex, token) {
  const x = BigInt(`0x${privateKeyHex}`)

  // Commitment: r ← random,  t = g^r mod p
  const r = generatePrivateKey()
  const t = modPow(G, r, P)

  // Challenge: c = SHA-512(t || token) mod q
  const c = (await hashToBigInt(`${t.toString(16)}${token}`)) % Q

  // Response:  s = r + c·x  (mod q)
  const s = (r + c * x) % Q

  return JSON.stringify({ commitment: t.toString(16), response: s.toString() })
}

export { computeProof, createPublicKey, hashSecret, generateKeyPair, signWithPrivateKeyHex };