import { api } from './api.js'

const BASE = '/attacks'

async function runAttack({ authType, token, attackType, token2, agentId }) {
  const res = await api.post(`${BASE}/${attackType}`, {
    auth_type: authType,
    token,
    token2,
    attack_type: attackType,
    agent_id: agentId,
  })
  return res.data
}

export const attackApi = {
  replay: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'replay', agentId }),

  credentialTheft: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'credential-theft', agentId }),

  mitm: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'mitm', agentId }),

  nonceReuse: () =>
    api.post('/attacks/nonce-reuse', {
      auth_type: 'zkp',
      token: 'nonce-reuse-demonstration',
      attack_type: 'nonce-reuse',
    }).then(r => r.data),

  compare: (oauth2Token, zkpToken, oauth2AgentId, zkpAgentId) =>
    api.post('/attacks/compare', {
      oauth2_token: oauth2Token,
      zkp_token: zkpToken,
    }),
}