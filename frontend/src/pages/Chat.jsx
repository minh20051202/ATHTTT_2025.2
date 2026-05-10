import { useState, useEffect } from 'react'
import { useAgents } from '../context/AgentsContext.jsx'
import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import { chatApi, setAgentConfig } from '../services/chatApi.js'
import { getAccessToken } from '../services/authApi.js'
import { demoApi } from '../services/demoApi.js'
import { computeProof } from '../lib/zkp.js'
import { generateRSAKeyPair } from '../lib/oauth2.js'
import ZKPFlow from '../components/ZKPFlow.jsx'
import GhostResults from '../components/GhostResults.jsx'
import IntentCard from '../components/IntentCard.jsx'
import AuthInfoPanel from '../components/AuthInfoPanel.jsx'
import ProofAccordion from '../components/ProofAccordion.jsx'
import TimingBreakdown from '../components/TimingBreakdown.jsx'
import ChatTrace from '../components/ChatTrace.jsx'

export default function Chat() {
  const { agents, loading: agentsLoading } = useAgents()
  const { storeResult } = useChatHistory()

  const [authType, setAuthType] = useState('oauth2') // 'oauth2' | 'zkp'
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [result, setResult] = useState(null)
  const [oauth2TokenAcquired, setOauth2TokenAcquired] = useState(false)
  const [oauth2Credentials, setOauth2Credentials] = useState(null) // { id, privateKey }
  const [chatCredentials, setChatCredentials] = useState({
    bearerToken: '',
    tokenExpAt: 0,
    agentId: null,
    zkpProof: '',
  })

  // Restore OAuth2 credentials from sessionStorage (survives page refresh,
  // unlike window vars which are reset on remount when multiple Chat instances
  // race on demoApi.seed() and only the first gets the private_key back).
  useEffect(() => {
    const stored = sessionStorage.getItem('demo_oauth2_creds')
    if (stored) {
      try {
        const { id, privateKey } = JSON.parse(stored)
        window._demoOAuth2AgentId = id
        window._demoPrivateKey = privateKey
        setOauth2Credentials({ id, privateKey })
        setOauth2TokenAcquired(true)
      } catch {
        sessionStorage.removeItem('demo_oauth2_creds')
      }
    }
  }, [])

  // Seed to get OAuth2 agent + key (one-time per session).
  // Client generates its own RSA keypair and registers the public key with the server.
  useEffect(() => {
    async function seedAndSetup() {
      try {
        const seedRes = await demoApi.seed()
        const oauth2Agent = seedRes?.data?.oauth2_agent || seedRes?.data
        const agentId = oauth2Agent?.id
        if (!agentId) return

        // Client generates its own RSA keypair — private key never leaves the browser
        const { privateKeyPem, publicKeyPem } = await generateRSAKeyPair()

        // Register the public key with the server
        await demoApi.registerOAuth2PublicKey(agentId, publicKeyPem)

        // Persist so refresh / concurrent mounts still work
        window._demoOAuth2AgentId = agentId
        window._demoPrivateKey = privateKeyPem
        sessionStorage.setItem('demo_oauth2_creds', JSON.stringify({
          id: agentId,
          privateKey: privateKeyPem,
        }))
        setOauth2Credentials({ id: agentId, privateKey: privateKeyPem })
        setOauth2TokenAcquired(true)
      } catch (err) {
        console.warn('Seed failed (may already be seeded):', err.message)
      }
    }
    seedAndSetup()
  }, [])

  // Update agent config whenever authType or OAuth2 credentials change
  useEffect(() => {
    if (authType === 'oauth2' && oauth2Credentials) {
      setAgentConfig({
        agentId: oauth2Credentials.id,
        privateKeyPem: oauth2Credentials.privateKey,
        authType: 'oauth2',
      })
    } else if (authType === 'zkp') {
      // Clear OAuth2 config so chatApi.intent doesn't inject OAuth2 header for ZKP requests
      setAgentConfig({ authType: 'zkp' })
    }
  }, [authType, oauth2Credentials])

  // Two-step ZKP flow:
  // 1. GET /api/chat/zkp-challenge/:agent_id → get challenge token
  // 2. Compute proof client-side (password never sent to server)
  // 3. POST /api/chat/intent with zkp_token + zkp_proof
  const handleSend = async (e) => {
    e.preventDefault()
    if (!message.trim()) return
    if (!agents) return
    if (authType === 'oauth2' && !oauth2Credentials) return

    const agentId = authType === 'oauth2' ? oauth2Credentials.id : agents.zkpAgentId

    setSending(true)
    setChatError(null)
    try {
      if (authType === 'oauth2') {
        const res = await chatApi.intent({ message, agent_id: agentId })
        setResult(res.data)
        storeResult(res.data)
        // Update ChatTrace credentials after successful OAuth2 auth
        const bearerToken = await getAccessToken(oauth2Credentials.id, oauth2Credentials.privateKey)
        setChatCredentials(prev => ({
          ...prev,
          bearerToken: bearerToken || '',
          tokenExpAt: 0,
          agentId: agentId,
        }))
      } else {
        if (!password.trim()) {
          setChatError('Password is required for ZKP authentication')
          setSending(false)
          return
        }
        // Step 1: fetch challenge token from server
        const challengeRes = await chatApi.getZkpChallenge(agentId)
        const { zkp_token } = challengeRes.data

        // Step 2: compute proof client-side (password never leaves browser)
        const proofJson = await computeProof(password, zkp_token)
        let proofData
        try {
          proofData = JSON.parse(proofJson)
        } catch {
          setChatError('Failed to compute ZKP proof')
          setSending(false)
          return
        }

        // Step 3: send intent with proof
        const proofString = JSON.stringify({
          commitment: proofData.commitment,
          response: proofData.response,
        })
        const res = await chatApi.intent({
          message,
          agent_id: agentId,
          zkp_token,
          zkp_proof: proofString,
        })
        setResult(res.data)
        storeResult(res.data)
        // Update ChatTrace credentials after successful ZKP auth
        setChatCredentials(prev => ({
          ...prev,
          zkpProof: proofString,
          agentId: agentId,
        }))
      }
    } catch (err) {
      setChatError(err.message)
      setResult(null)
    } finally {
      setSending(false)
    }
  }

  if (agentsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <span style={{ color: 'var(--color-oauth2)', fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
          Connecting to server...
        </span>
      </div>
    )
  }

  // Active display: result from THIS session or the stored latest (from other page navigation)
  const displayResult = result

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: 'var(--space-8)' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: 'var(--space-4)' }}>Chat — Intent + Auth Demo</h1>

      {/* Agent Selector — tabs above input (D1) */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {[
          { key: 'oauth2', label: 'OAuth2 Agent', color: 'var(--color-oauth2)', muted: 'var(--color-oauth2-muted)' },
          { key: 'zkp', label: 'ZKP Agent', color: 'var(--color-zkp)', muted: 'var(--color-zkp-muted)' },
        ].map(({ key, label, color, muted }) => (
          <button
            key={key}
            onClick={() => setAuthType(key)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              border: 'none',
              borderBottom: authType === key ? `2px solid ${color}` : '2px solid transparent',
              background: authType === key ? muted : 'transparent',
              color: authType === key ? color : 'var(--color-muted)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ZKP 5-step data flow + password input (shown only when ZKP selected) */}
      {authType === 'zkp' && (
        <ZKPFlow />
      )}

      {/* Chat input form */}
      <form onSubmit={handleSend} style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* ZKP password input — required for ZKP authentication */}
          {authType === 'zkp' && (
            <div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  marginBottom: 'var(--space-3)',
                }}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Search for products, compare prices..."
                rows={3}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'var(--font-sans)',
                  resize: 'vertical',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={sending || !message.trim() || (authType === 'oauth2' && !oauth2Credentials)}
              style={{
                height: '76px',
                padding: '0 var(--space-6)',
                background: sending ? 'var(--color-muted)' : 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: sending ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease',
                opacity: sending ? 0.6 : 1,
              }}
            >
              {sending ? 'Processing...' : 'Send'}
            </button>
          </div>
        </div>
      </form>

      {/* Error handling */}
      {chatError && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-attack-muted)',
          border: '1px solid var(--color-attack)',
          borderRadius: '6px',
          marginBottom: 'var(--space-4)',
          fontSize: '14px',
          color: 'var(--color-attack)',
        }}>
          <strong>Authentication error:</strong> {chatError}
        </div>
      )}

      {/* ChatTrace — dual auth comparison with step log + metrics */}
      <ChatTrace authType={authType} credentials={chatCredentials} />

      {/* Results area: ghost (empty) OR populated */}
      {!displayResult ? (
        <GhostResults />
      ) : (
        <ChatResults result={displayResult} authType={authType} />
      )}
    </div>
  )
}

function ChatResults({ result, authType }) {
  const { intent, result: execResult, timing, auth_info } = result

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Intent card */}
      <IntentCard intent={intent} />

      {/* Auth info */}
      <AuthInfoPanel authInfo={auth_info} />

      {/* Proof accordion (ZKP only, expanded by default the first time) */}
      {authType === 'zkp' && auth_info.type === 'zkp' && auth_info.proof_info && (
        <ProofAccordion proofInfo={auth_info.proof_info} />
      )}

      {/* Timing breakdown */}
      <TimingBreakdown timing={timing} />

      {/* Exec result */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
      }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)' }}>
          Result
        </div>
        <pre style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(execResult, null, 2)}
        </pre>
      </div>
    </div>
  )
}