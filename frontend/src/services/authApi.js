import { api } from './api.js'
import { exchangeToken } from '../lib/oauth2.js'

let _cachedToken = null
let _cachedExpiresAt = null
let _lastClientComputationTime = 0

/**
 * Get an access token, using a cached one if still valid.
 * @param {string} clientId — agent ID as string
 * @param {string} privateKeyPem — RSA private key PEM
 * @returns {Promise<string>} access token
 */
export async function getAccessToken(clientId, privateKeyPem) {
  const { token } = await getAccessTokenWithTiming(clientId, privateKeyPem)
  return token
}

/**
 * Get an access token with client-side auth computation timing.
 * Cached bearer-token reuse has no new client computation, so it reports 0.
 */
export async function getAccessTokenWithTiming(clientId, privateKeyPem) {
  // If we have a cached token with > 60s remaining, reuse it
  if (_cachedToken && _cachedExpiresAt && Date.now() < _cachedExpiresAt - 60_000) {
    return {
      token: _cachedToken,
      clientComputationTime: 0,
      cached: true,
    }
  }

  const data = await exchangeToken(clientId, privateKeyPem)
  _cachedToken = data.access_token
  _lastClientComputationTime = data.clientComputationTime ?? 0
  // Cache for 80% of ttl (but at least 30s)
  const ttl = (data.expires_in || 60) * 1000
  _cachedExpiresAt = Date.now() + Math.max(ttl * 0.8, 30_000)
  return {
    token: _cachedToken,
    clientComputationTime: _lastClientComputationTime,
    cached: false,
  }
}

/** Clear cached token (e.g., on expiry error) */
export function clearAccessTokenCache() {
  _cachedToken = null
  _cachedExpiresAt = null
  _lastClientComputationTime = 0
}

/** Returns the current cached token for diagnostics (read-only) */
export function getTokenState() {
  return {
    hasToken: !!_cachedToken,
    expired: _cachedExpiresAt ? Date.now() >= _cachedExpiresAt : true,
    lastClientComputationTime: _lastClientComputationTime,
  }
}
