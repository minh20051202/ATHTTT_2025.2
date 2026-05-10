import { api } from './api.js'

// Seed endpoint is safe to call multiple times — idempotent
// Returns existing user/agents if already seeded
export const demoApi = {
  seed: () => api.post('/demo/seed'),
  registerOAuth2PublicKey: (clientId, publicKeyPem) => {
    const formData = new URLSearchParams()
    formData.append('client_id', String(clientId))
    formData.append('public_key_pem', publicKeyPem)
    return fetch('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    }).then(r => r.json())
  },
}