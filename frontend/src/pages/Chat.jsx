import { useState, useEffect, useRef } from 'react'
import { useAgents } from '../context/AgentsContext.jsx'
import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import { chatApi, setAgentConfig } from '../services/chatApi.js'
import { getAccessToken } from '../services/authApi.js'
import { demoApi } from '../services/demoApi.js'
import { computeProof } from '../lib/zkp.js'
import { generateRSAKeyPair } from '../lib/oauth2.js'
import ChatThread from '../components/ChatThread.jsx'
import ComputationSidebar from '../components/ComputationSidebar.jsx'

let _messageId = 0
function nextId() { return ++_messageId }

export default function Chat() {
  const { agents, loading: agentsLoading } = useAgents()
  const { storeResult, latestResult } = useChatHistory()

  const [authType, setAuthType] = useState('oauth2')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [messages, setMessages] = useState([])
  const [oauth2Credentials, setOauth2Credentials] = useState(null)

  const pendingAgentIdRef = useRef(null)

  // Restore OAuth2 credentials from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('demo_oauth2_creds')
    if (stored) {
      try {
        const { id, privateKey } = JSON.parse(stored)
        window._demoOAuth2AgentId = id
        window._demoPrivateKey = privateKey
        setOauth2Credentials({ id, privateKey })
      } catch {
        sessionStorage.removeItem('demo_oauth2_creds')
      }
    }
  }, [])

  // Seed + keypair registration (one-time)
  useEffect(() => {
    async function seedAndSetup() {
      try {
        const seedRes = await demoApi.seed()
        const oauth2Agent = seedRes?.data?.oauth2_agent || seedRes?.data
        const agentId = oauth2Agent?.id
        if (!agentId) return

        const { privateKeyPem, publicKeyPem } = await generateRSAKeyPair()
        await demoApi.registerOAuth2PublicKey(agentId, publicKeyPem)

        window._demoOAuth2AgentId = agentId
        window._demoPrivateKey = privateKeyPem
        sessionStorage.setItem('demo_oauth2_creds', JSON.stringify({
          id: agentId, privateKey: privateKeyPem,
        }))
        setOauth2Credentials({ id: agentId, privateKey: privateKeyPem })
      } catch (err) {
        console.warn('Seed failed (may already be seeded):', err.message)
      }
    }
    seedAndSetup()
  }, [])

  // Update agent config on authType/credentials change
  useEffect(() => {
    if (authType === 'oauth2' && oauth2Credentials) {
      setAgentConfig({ agentId: oauth2Credentials.id, privateKeyPem: oauth2Credentials.privateKey, authType: 'oauth2' })
    } else if (authType === 'zkp') {
      setAgentConfig({ authType: 'zkp' })
    }
  }, [authType, oauth2Credentials])

  const handleSend = async () => {
    if (!message.trim() || !agents) return
    if (authType === 'oauth2' && !oauth2Credentials) return

    const userMsg = { id: nextId(), role: 'user', content: message, timestamp: Date.now() }
    const amId = nextId()
    pendingAgentIdRef.current = amId
    const agentMsg = { id: amId, role: 'agent', thinking: true, timestamp: Date.now() }

    setMessages(prev => [...prev, userMsg, agentMsg])
    setMessage('')
    setSending(true)
    setChatError(null)

    try {
      const agentId = authType === 'oauth2' ? oauth2Credentials.id : agents.zkpAgentId
      let res

      if (authType === 'oauth2') {
        res = await chatApi.intent({ message, agent_id: agentId })
      } else {
        if (!password.trim()) throw new Error('Password is required for ZKP authentication')
        const challengeRes = await chatApi.getZkpChallenge(agentId)
        const { zkp_token } = challengeRes.data
        const proofJson = await computeProof(password, zkp_token)
        let proofData
        try { proofData = JSON.parse(proofJson) } catch {
          throw new Error('Failed to compute ZKP proof')
        }
        const proofString = JSON.stringify({ commitment: proofData.commitment, response: proofData.response })
        res = await chatApi.intent({ message, agent_id: agentId, zkp_token, zkp_proof: proofString })
      }

      const { intent, result: execResult, timing, auth_info } = res.data

      setMessages(prev => prev.map(msg =>
        msg.id === pendingAgentIdRef.current
          ? { ...msg, thinking: false, intent, result: execResult, auth_info, timing }
          : msg
      ))
      storeResult(res.data)

      if (authType === 'oauth2') {
        const bearerToken = await getAccessToken(oauth2Credentials.id, oauth2Credentials.privateKey)
        setAgentConfig(prev => ({ ...prev, bearerToken: bearerToken || prev?.bearerToken || '', tokenExpAt: 0, agentId }))
      }
    } catch (err) {
      setChatError(err.message)
      setMessages(prev => prev.map(msg =>
        msg.id === pendingAgentIdRef.current
          ? { ...msg, thinking: false, error: err.message }
          : msg
      ))
    } finally {
      setSending(false)
    }
  }

  if (agentsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <span style={{ color: 'var(--color-oauth2)', fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
          Connecting to server…
        </span>
      </div>
    )
  }

  return (
    <div className="chat-layout-grid">
      {/* Left: ChatThread */}
      <div style={{ borderRight: '1px solid var(--color-border)', paddingRight: 'var(--space-4)' }}>
        {/* Auth type tabs */}
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
                fontWeight: 600, fontSize: 'var(--text-sm)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <ChatThread
          authType={authType}
          messages={messages}
          sending={sending}
          onSend={handleSend}
          message={message}
          setMessage={setMessage}
          password={password}
          setPassword={setPassword}
        />
      </div>

      {/* Right: ComputationSidebar */}
      <ComputationSidebar
        authType={authType}
        latestResult={latestResult}
        messageCount={messages.length}
      />
    </div>
  )
}