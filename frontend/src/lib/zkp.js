/**
 * Client-side Schnorr Zero-Knowledge Proof implementation.
 *
 * Domain parameters match backend/auth/zkp.py exactly.
 * 2048-bit safe prime (DH Group 14 from cryptography library).
 *   p = 2048-bit safe prime
 *   q = (p-1)/2  (2047-bit prime order of the order-q subgroup)
 *   g = 2  (standard generator of the order-q subgroup)
 *
 * All operations use native JS BigInt — no library dependencies.
 *
 * The password NEVER leaves the client. Only the proof (commitment, response)
 * is sent to the server.
 */

// ---------------------------------------------------------------------------
// Domain parameters (2048-bit — matches backend auth/zkp.py)
// ---------------------------------------------------------------------------
const P = 0xb00ddc45_6416e6a8_5cb70b0c_3c75fbe7_82699874_96a7a97b_da12c1c8_5a79228c_93f61f99_d93bf8cb_92a9b57d_77869c6b_a7c11cb3_d47538d1_4f7a5cd4_a85c35aa_c1993376_6bf536a7_4464ce02_53e3c044_4c3d2399_1c161065_2606790f_a1939e19_9e7e36bd_0a6a0a3f_43df71e5_70778811_fc38293f_67f3b131_e9f15599_9001dc82_60d06e34_32f6e286_cf5df5bd_5ee74752_ca688745_246ce191_7bc16b57_6adbad2d_cc1e032a_8686f13b_26c162df_e8065bc4_3476aff4_4edbdc1e_d388cc35_24d6ed38_f13ee514_389a74f0_5390f893_bfedbb4b_acdecb6f_f3a54d1f_5ed0469d_05c96236_05616952_dc71dc05_178373d8_1d368189_a18aa942_0ad703c1_6ca60500_777a85afn;
const Q = (P - 1n) / 2n;
const G = 2n;

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

  return JSON.stringify({ commitment: t.toString(16), response: s.toString(16) });
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
    y: y.toString(16),
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
  const xHex = x.toString(16);
  const yHex = y.toString(16);

  return {
    privateKey: xHex,                   // hex — signWithPrivateKeyHex expects hex
    publicKey: JSON.stringify({
      y: yHex,                          // hex — server parses with int(v, 16)
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
  const x = BigInt(`0x${privateKeyHex}`);

  // Commitment: r ← random,  t = g^r mod p
  const r = generatePrivateKey();
  const t = modPow(G, r, P);

  // Challenge: c = SHA-512(t || token) mod q
  const c = (await hashToBigInt(`${t.toString(16)}${token}`)) % Q;

  // Response:  s = r + c·x  (mod q)
  const s = (r + c * x) % Q;

  return JSON.stringify({ commitment: t.toString(16), response: s.toString(16) });
}

/**
 * Create a Schnorr proof using a fixed nonce (r).
 * DANGEROUS: For educational/attack demonstration ONLY.
 */
async function signWithFixedNonce(privateKeyHex, token, fixedNonce) {
  const x = BigInt(`0x${privateKeyHex}`);
  const r = fixedNonce;
  const t = modPow(G, r, P);

  // Challenge: c = SHA-512(t || token) mod q
  const c = (await hashToBigInt(`${t.toString(16)}${token}`)) % Q;

  // Response:  s = r + c·x  (mod q)
  const s = (r + c * x) % Q;

  return JSON.stringify({ commitment: t.toString(16), response: s.toString(16), token });
}

export { computeProof, createPublicKey, hashSecret, generateKeyPair, signWithPrivateKeyHex, signWithFixedNonce, generatePrivateKey };