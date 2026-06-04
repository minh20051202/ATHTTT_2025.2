/**
 * OAuth2 Private Key JWT (RFC 7523) — WebCrypto implementation.
 *
 * Client stores RSA private key (PEM). Creates signed JWT assertions (RS256)
 * using the private key. Exchanges assertion for access token at /api/auth/oauth2/token.
 */

// ---------------------------------------------------------------------------
// Key generation (WebCrypto SubtleCrypto)
// ---------------------------------------------------------------------------

/**
 * Generate an RSA-2048 keypair using WebCrypto.
 * Returns PEM strings and the raw CryptoKey for the private key.
 */
export async function generateRSAKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  )
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  return {
    privateKeyPem: arrayBufferToPem(privateKeyBuffer, 'PRIVATE KEY'),
    publicKeyPem: arrayBufferToPem(publicKeyBuffer, 'PUBLIC KEY'),
    privateKeyCryptoKey: keyPair.privateKey,
  }
}

function arrayBufferToPem(buffer, label) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  const lines = base64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

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

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function b64uEncode(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

// ---------------------------------------------------------------------------
// Client assertion creation
// ---------------------------------------------------------------------------

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
    exp,
    jti: `${now}-${Math.random().toString(36).slice(2, 10)}`,
  }

  // Encode header and payload
  const headerBytes = new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const header = b64uEncode(headerBytes)
  const payloadB64 = b64uEncode(payloadBytes)

  const signingInput = `${header}.${payloadB64}`

  // Sign with RSASSA-PKCS1-v1_5 + SHA-256 (WebCrypto)
  const signatureBytes = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  const signature = b64uEncode(new Uint8Array(signatureBytes))

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
  const { assertion, generationTime } = await createClientAssertion(clientId, privateKeyPem)
  const formData = new URLSearchParams()
  formData.append('client_id', clientId)
  formData.append('client_assertion', assertion)

  const response = await fetch('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `Token exchange failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    ...data,
    clientComputationTime: generationTime / 1000,
  }
}
