/**
 * ActionLog — real-time authentication step log with staggered animation.
 * Shows fixed taxonomy of steps for OAuth2 vs ZKP + expandable payloads.
 * Remounts when authType changes (via key prop from parent ChatTrace).
 */
import { useState, useEffect, useRef } from 'react'
import { getTokenState } from '../services/authApi.js'

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

function buildOAuth2Steps({ credentials, auth_info, timing }) {
  const tokenState = getTokenState()
  const steps = []

  if (tokenState.hasToken && !tokenState.expired && credentials?.tokenExpAt) {
    const remaining = Math.max(0, Math.round((credentials.tokenExpAt - Date.now()) / 1000))
    steps.push({
      type: 'agent',
      badge: 'AGENT',
      label: `Using cached token (expires in ${remaining}s)`,
    })
  } else {
    steps.push({
      type: 'agent',
      badge: 'AGENT',
      label: 'POST /api/auth/oauth2/token — client_assertion signed (RS256)',
    })
  }

  const bearer = credentials?.bearerToken || ''
  steps.push({
    type: 'agent',
    badge: 'AGENT',
    label: `Authorization: Bearer ${bearer.slice(0, 20)}...`,
  })

  steps.push({
    type: 'agent',
    badge: 'AGENT',
    label: 'POST /api/chat/intent',
  })

  // Server steps from response
  if (auth_info?.token_info) {
    steps.push({
      type: 'server',
      badge: 'SERVER',
      label: `verify_token (HS256) → {sub: "${auth_info.token_info.payload?.sub || '?'}", type: "oauth2"}`,
      payload: auth_info.token_info,
      expandable: true,
    })
  }

  const intentLabel = timing?.intent_extraction != null
    ? `intent_extraction → {action} (${Math.round(timing.intent_extraction * 1000)}ms)`
    : 'intent_extraction'
  steps.push({
    type: 'server',
    badge: 'SERVER',
    label: intentLabel,
  })

  const execLabel = timing?.execution != null
    ? `tool_call → (${Math.round(timing.execution * 1000)}ms)`
    : 'tool_call'
  steps.push({
    type: 'server',
    badge: 'SERVER',
    label: execLabel,
  })

  return steps
}

function buildZKPSteps({ credentials, auth_info, timing }) {
  const steps = []

  const agentId = credentials?.agentId || '?'
  steps.push({
    type: 'agent',
    badge: 'AGENT',
    label: `GET /api/chat/zkp-challenge/${agentId}`,
  })

  steps.push({
    type: 'agent',
    badge: 'AGENT',
    label: 'Computing ZKP proof: H(token‖public_key)...',
  })

  const proofSnippet = credentials?.zkpProof
    ? credentials.zkpProof.slice(0, 20)
    : ''

  steps.push({
    type: 'agent',
    badge: 'AGENT',
    label: `POST /api/chat/intent (zkp_token + zkp_proof: ${proofSnippet}...)`,
  })

  if (auth_info?.verification_time != null) {
    const vt = Math.round(auth_info.verification_time * 1000)
    steps.push({
      type: 'server',
      badge: 'SERVER',
      label: `verify_proof (g^s ≡ t·y^c) → valid (${vt}ms)`,
    })
  }

  const intentLabel = timing?.intent_extraction != null
    ? `intent_extraction → {action} (${Math.round(timing.intent_extraction * 1000)}ms)`
    : 'intent_extraction'
  steps.push({
    type: 'server',
    badge: 'SERVER',
    label: intentLabel,
  })

  const execLabel = timing?.execution != null
    ? `tool_call → (${Math.round(timing.execution * 1000)}ms)`
    : 'tool_call'
  steps.push({
    type: 'server',
    badge: 'SERVER',
    label: execLabel,
  })

  return steps
}

// ---------------------------------------------------------------------------
// Badge + row rendering
// ---------------------------------------------------------------------------

function Badge({ type, label }) {
  const isAgent = type === 'agent'
  // AGENT badge uses primary blue (indigo); SERVER badge uses ZKP green
  const bg = isAgent ? 'rgba(67,56,202,0.08)' : 'var(--color-zkp-muted)'
  const color = isAgent ? 'var(--color-primary)' : 'var(--color-zkp)'
  const borderColor = isAgent ? 'rgba(67,56,202,0.25)' : 'rgba(16,185,129,0.25)'

  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.04em',
      background: bg,
      color,
      border: `1px solid ${borderColor}`,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Single step row
// ---------------------------------------------------------------------------

function StepRow({ id, step, index, expanded, onToggle }) {
  const isError = step.type === 'error'
  const labelColor = isError ? 'var(--color-error)' : 'var(--color-text)'
  const canExpand = step.expandable && step.payload

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--space-3)',
        alignItems: 'start',
        padding: '6px var(--space-3)',
        borderBottom: '1px solid var(--color-border)',
        opacity: 0,
        transform: 'translateY(6px)',
        animation: 'fadeSlideIn 0.4s ease-out both',
        animationDelay: `calc(var(--step-index, 0) * 150ms)`,
        '--step-index': index,
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        lineHeight: 1.5,
      }}
    >
      {/* Badge */}
      <Badge type={step.type} label={step.badge} />

      {/* Time + label */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <span style={{ color: labelColor, wordBreak: 'break-all' }}>
          {step.label}
        </span>
        {expanded && canExpand && step.payload && (
          <pre style={{
            margin: '8px 0 0',
            padding: 'var(--space-3)',
            background: 'var(--color-bg)',
            borderRadius: 'var(--border-radius-sm)',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-muted)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            border: '1px solid var(--color-border)',
            overflow: 'auto',
            maxHeight: '200px',
          }}>
            {JSON.stringify(step.payload, null, 2)}
          </pre>
        )}
      </div>

      {/* Expand toggle */}
      {canExpand && (
        <button
          onClick={() => onToggle(id)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            lineHeight: 1.4,
          }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '[−]' : '[+]'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Greeting on mount (initial empty state)
// ---------------------------------------------------------------------------

const GREETING_STEP = {
  type: 'server',
  badge: 'SERVER',
  label: "Hello! I'm authenticating via two methods — watch the Action Log to see what happens behind the scenes with every message.",
}

// ---------------------------------------------------------------------------
// Main ActionLog component
// ---------------------------------------------------------------------------

export default function ActionLog({ authType, latestResult, tokenCached, credentials, messageCount = 0 }) {
  const [expandedSteps, setExpandedSteps] = useState({})
  const bottomRef = useRef(null)
  const prevStepsLen = useRef(0)

  // Determine if this is the initial mounted state (no messages yet)
  const isInitial = messageCount === 0

  // Build the step list based on auth type and response data
  const rawSteps = isInitial
    ? []
    : authType === 'oauth2'
      ? buildOAuth2Steps({ credentials, auth_info: latestResult?.auth_info, timing: latestResult?.timing })
      : buildZKPSteps({ credentials, auth_info: latestResult?.auth_info, timing: latestResult?.timing })

  // Ring buffer: keep last 50
  const steps = rawSteps.slice(-50)

  // Scroll to bottom on new steps
  useEffect(() => {
    if (steps.length > prevStepsLen.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevStepsLen.current = steps.length
  }, [steps.length])

  // Reset expanded state when authType changes (remount handles this via key prop)
  // but also clear when latestResult changes (new response with new step IDs)
  useEffect(() => {
    setExpandedSteps({})
    prevStepsLen.current = 0
  }, [latestResult?.timestamp])

  const toggleExpand = (id) => {
    setExpandedSteps(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Show greeting only on initial mount (before any steps)
  const displaySteps = isInitial ? [GREETING_STEP] : steps

  return (
    <>
      {/* fadeSlideIn keyframe injected once */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius-lg)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-elevated)',
        }}>
          <span style={{
            fontWeight: 700,
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)',
          }}>
            Action Log
          </span>
          </div>

        {/* Steps container — scrollable */}
        <div style={{
          overflowY: 'auto',
          maxHeight: '400px',
        }}>
          {displaySteps.map((step, i) => (
            <StepRow
              key={step.label}
              id={step.label}
              step={step}
              index={i}
              expanded={!!expandedSteps[step.label]}
              onToggle={toggleExpand}
            />
          ))}

          {/* Auto-scroll anchor */}
          <div ref={bottomRef} style={{ height: '1px' }} />
        </div>
      </div>
    </>
  )
}