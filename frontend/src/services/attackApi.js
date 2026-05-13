import { api } from './api.js'

const BASE = '/api/attacks'

async function runAttack({ authType, token, attackType }) {
  const formData = new URLSearchParams()
  formData.append('auth_type', authType)
  formData.append('token', token)
  formData.append('attack_type', attackType)
  const res = await api.post(`${BASE}/${attackType}`, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export const attackApi = {
  replay: (authType, token) =>
    runAttack({ authType, token, attackType: 'replay' }),

  tokenTheft: (authType, token) =>
    runAttack({ authType, token, attackType: 'token-theft' }),

  credentialStuffing: (authType, token) =>
    runAttack({ authType, token, attackType: 'credential-stuffing' }),

  algorithmConfusion: (authType, token) =>
    runAttack({ authType, token, attackType: 'algorithm-confusion' }),

  nonceReuse: (authType, token) =>
    runAttack({ authType, token, attackType: 'nonce-reuse' }),
}