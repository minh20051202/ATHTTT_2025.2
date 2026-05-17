import { useState, useEffect, useRef } from 'react'
import { getAccessToken } from '../services/authApi.js'

async function buildOAuth2StepsFull({ oauth2Credentials, latestResult, fetchToken }) {
  const steps = []
  steps.push({
    phase: 'CLIENT_ASSERTION',
    type: 'agent',
    label: 'Build client_assertion JWT',
    detail: '{ iss: id, sub: id, aud: server, exp: now+5m }',
    mono: true,
  })
  steps.push({
    phase: 'CLIENT_ASSERTION',
    type: 'agent',
    label: 'Sign with RSA-2048 (RS256)',
    detail: 'RSASSA-PKCS1-v1_5 + SHA-256',
    mono: true,
  })
  steps.push({
    phase: 'TOKEN_REQUEST',
    type: 'agent',
    label: 'POST /oauth2/token',
    detail: 'Exchange assertion for access token',
  })
  const bearerToken = await fetchToken()
  steps.push({
    phase: 'API_CALL',
    type: 'agent',
    label: 'Authorization: Bearer <token>',
    detail: `Token size: ${bearerToken?.length || 0} bytes`,
    token: bearerToken,
  })

  const authInfo = latestResult?.auth_info
  if (authInfo?.token_info?.payload) {
    steps.push({
      phase: 'SERVER_VERIFY',
      type: 'server',
      label: 'Verify HS256 JWT',
      detail: `Verification time: ${(authInfo.verification_time * 1000).toFixed(2)}ms`,
      payload: authInfo.token_info,
      expandable: true
    })
  }
  return steps
}

function buildZKPStepsFull({ zkpCredentials, latestResult }) {
  const steps = []
  const authInfo = latestResult?.auth_info
  steps.push({
    phase: 'CHALLENGE_REQUEST',
    type: 'agent',
    label: 'GET /zkp-challenge',
    detail: 'Request random UUID v4 challenge',
  })
  steps.push({
    phase: 'PROOF_COMPUTE',
    type: 'agent',
    label: 'Compute t = g^r mod p',
    detail: '2048-bit modular exponentiation',
    mono: true,
  })
  steps.push({
    phase: 'PROOF_COMPUTE',
    type: 'agent',
    label: 'Compute s = r + c·x mod q',
    detail: 'Schnorr non-interactive proof response',
    mono: true,
  })
  if (authInfo) {
    steps.push({
      phase: 'SERVER_VERIFY',
      type: 'server',
      label: 'Verify g^s ≡ t · y^c (mod p)',
      detail: `Verification: ${(authInfo.verification_time * 1000).toFixed(1)}ms`,
    })
  }
  return steps
}

function buildReasoningSteps(latestResult, liveReasoningSteps = []) {
  const reasoningSteps = liveReasoningSteps.length
    ? liveReasoningSteps
    : latestResult?.timing?.reasoning_steps || []

  return reasoningSteps.map((step) => ({
    phase: step.node === 'ToolNode'
      ? 'TOOL_CALL'
      : step.node === 'SynthesisNode'
        ? 'SYNTHESIS'
        : 'INTENT',
    type: 'server',
    label: step.label || step.node,
    detail: Number.isFinite(step.duration_ms)
      ? `${step.node}: ${step.duration_ms.toFixed(1)}ms`
      : step.node,
  }))
}

function Badge({ type }) {
  const isAgent = type === 'agent'
  return (
    <span className={`badge ${isAgent ? 'badge-oauth2' : 'badge-zkp'}`} style={{ minWidth: '60px', justifyContent: 'center' }}>
      {isAgent ? 'CLIENT' : 'SERVER'}
    </span>
  )
}

function PhaseSeparator({ phase }) {
  const labels = {
    CLIENT_ASSERTION: 'Assertion Signing',
    TOKEN_REQUEST: 'Token Exchange',
    API_CALL: 'API Request',
    SERVER_VERIFY: 'Verification',
    CHALLENGE_REQUEST: 'Challenge',
    PROOF_COMPUTE: 'Computation',
    PROOF_SEND: 'Dispatch',
    INTENT: 'Intent',
    TOOL_CALL: 'Execution',
    SYNTHESIS: 'Synthesis',
  }
  return (
    <div style={{
      padding: 'var(--space-2) var(--space-4)',
      background: 'var(--color-surface)',
      fontSize: '10px',
      fontWeight: 800,
      textTransform: 'uppercase',
      color: 'var(--color-muted)',
      borderBottom: '1px solid var(--color-border)',
      letterSpacing: '0.05em'
    }}>
      {labels[phase] || phase}
    </div>
  )
}

function StepRow({ step, expanded, onToggle }) {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Badge type={step.type} />
        <span className="font-mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text)' }}>
          {step.label}
        </span>
      </div>
      {step.detail && (
        <div style={{ paddingLeft: '72px', fontSize: '11px', color: 'var(--color-muted)' }}>
          {step.mono ? <code className="font-mono">{step.detail}</code> : step.detail}
        </div>
      )}
      {step.expandable && (
        <button onClick={onToggle} style={{ marginLeft: '72px', fontSize: '10px', color: 'var(--color-primary)', textAlign: 'left', fontWeight: 600 }}>
          {expanded ? '[−] Hide Data' : '[+] View Payload'}
        </button>
      )}
      {expanded && step.payload && (
        <pre className="font-mono" style={{ marginLeft: '72px', marginTop: '4px', padding: '8px', background: 'var(--color-surface)', borderRadius: '4px', fontSize: '10px', overflow: 'auto' }}>
          {JSON.stringify(step.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function ActionLog({
  authType,
  latestResult,
  messageCount = 0,
  oauth2Credentials,
  zkpCredentials,
  liveReasoningSteps = [],
}) {
  const [expandedSteps, setExpandedSteps] = useState({})
  const [steps, setSteps] = useState([])
  const bottomRef = useRef(null)

  useEffect(() => {
    if (messageCount === 0) return
    async function buildSteps() {
      const newSteps = authType === 'oauth2' 
        ? await buildOAuth2StepsFull({ 
            oauth2Credentials, 
            latestResult, 
            fetchToken: () => oauth2Credentials ? getAccessToken(String(oauth2Credentials.id), oauth2Credentials.privateKey) : Promise.resolve('') 
          })
        : buildZKPStepsFull({ zkpCredentials, latestResult })
      setSteps([...newSteps, ...buildReasoningSteps(latestResult, liveReasoningSteps)])
    }
    buildSteps()
  }, [latestResult?.timestamp, authType, messageCount, liveReasoningSteps])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length])

  const phases = [...new Set(steps.map(s => s.phase))]

  return (
    <div className="sidebar-panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title">Trace Log</span>
        <span className={`badge ${authType === 'zkp' ? 'badge-zkp' : 'badge-oauth2'}`}>
          {authType.toUpperCase()}
        </span>
      </div>
      <div className="panel-content" style={{ padding: 0 }}>
        {steps.length === 0 ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-muted)', fontSize: '12px' }}>
            Awaiting session data…
          </div>
        ) : (
          phases.map(phase => (
            <div key={phase}>
              <PhaseSeparator phase={phase} />
              {steps.filter(s => s.phase === phase).map((s, i) => (
                <StepRow 
                  key={i} 
                  step={s} 
                  expanded={!!expandedSteps[s.label]} 
                  onToggle={() => setExpandedSteps(prev => ({...prev, [s.label]: !prev[s.label]}))} 
                />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
