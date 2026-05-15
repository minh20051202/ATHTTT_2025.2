import { api } from './api.js'

const BASE = '/attacks'

async function runAttack({ authType, token, attackType }) {
  const res = await api.post(`${BASE}/${attackType}`, {
    auth_type: authType,
    token,
    attack_type: attackType,
  })
  return res.data
}

export const attackApi = {
  replay: (authType, token) =>
    runAttack({ authType, token, attackType: 'replay' }),

  credentialTheft: (authType, token) =>
    runAttack({ authType, token, attackType: 'credential-theft' }),

  mitm: (authType, token) =>
    runAttack({ authType, token, attackType: 'mitm' }),

  clientAssertionSub: (authType, token) =>
    runAttack({ authType, token, attackType: 'client-assertion-sub' }),

  proofCorrelation: (authType, token) =>
    runAttack({ authType, token, attackType: 'proof-correlation' }),

  challengePredictability: (authType, token) =>
    runAttack({ authType, token, attackType: 'challenge-predictability' }),

  algorithmConfusion: (authType, token) =>
    runAttack({ authType, token, attackType: 'algorithm-confusion' }),

  nonceReuse: (authType, token) =>
    runAttack({ authType, token, attackType: 'nonce-reuse' }),

  compare: (oauth2Token, zkpToken) =>
    api.post('/attacks/compare', {
      oauth2_token: oauth2Token,
      zkp_token: zkpToken,
    }),
}