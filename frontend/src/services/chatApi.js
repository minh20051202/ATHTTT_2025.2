import { api } from './api.js'
import { getAccessToken } from './authApi.js'

// ---------------------------------------------------------------------------
// Agent config for OAuth2 PKJWT (set by Chat.jsx when agent is selected)
// ---------------------------------------------------------------------------
let _agentConfig = null  // { agentId, privateKeyPem, authType }

/**
 * Called by Chat.jsx when an agent is selected.
 * @param {{ agentId: number, privateKeyPem: string, authType: 'oauth2' | 'zkp' }} config
 */
export function setAgentConfig(config) {
  _agentConfig = config
}

/** Get the current agent config (for diagnostics) */
export function getAgentConfig() {
  return _agentConfig
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

export const chatApi = {
  /** Step 1 of ZKP flow: get a challenge token from the server */
  getZkpChallenge: (agentId) => api.get(`/chat/zkp-challenge/${agentId}`),

  /**
   * Send an intent request.
   * For OAuth2 agents, automatically fetches and injects a Bearer token.
   * @param {{ message: string, agent_id: number, password?: string }} data
   */
  intent: async (data) => {
    const headers = {}

    if (_agentConfig && _agentConfig.authType === 'oauth2' && _agentConfig.privateKeyPem) {
      const token = await getAccessToken(
        String(_agentConfig.agentId),
        _agentConfig.privateKeyPem
      )
      headers['Authorization'] = `Bearer ${token}`
    }

    return api.post('/chat/intent', data, { headers })
  },
}
