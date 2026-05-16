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

  clientAssertionSub: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'client-assertion-sub', agentId }),

  proofCorrelation: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'proof-correlation', agentId }),

  challengePredictability: (authType, token, agentId) =>
    runAttack({ authType, token, attackType: 'challenge-predictability', agentId }),

  // NONCE-REUSE ATTACK: Schnorr broken if nonce r is reused across proofs
  // POST /api/attacks/nonce-reuse (body fields required by AttackRequest schema)
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
      // Note: The compare endpoint in python accepts CompareRequest which currently
      // doesn't take agent_id. If needed, we'd update CompareRequest.
    }),
}