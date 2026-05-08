/** @jsxImportSource react */
import { useState, useEffect } from 'react'

// ─── OAuth2 Flow Steps ───────────────────────────────────────────
const OAUTH2_STEPS = [
  {
    step: 1,
    title: 'Client creates signed JWT client_assertion',
    code: 'RS256(payload, private_key.pem)',
    color: 'var(--color-text)',
  },
  {
    step: 2,
    title: 'Client sends assertion to token endpoint',
    code: 'POST /api/auth/oauth2/token\n← 200 { access_token: "eyJ..." }',
    color: 'var(--color-text)',
  },
  {
    step: 3,
    title: 'Client sends Bearer token to intent API',
    code: 'Authorization: Bearer eyJ...\n← 200 { auth_info: { type: "oauth2" } }',
    color: 'var(--color-text)',
  },
  {
    step: 4,
    title: 'ATTACK: Forged assertion — stolen private key',
    code: 'Signs fake JWT with stolen key\n→ gets access_token',
    color: 'var(--color-attack)',
    isAttack: true,
  },
]

// ─── ZKP Flow Steps ──────────────────────────────────────────────
const ZKP_STEPS = [
  {
    step: 1,
    title: 'GET /zkp-challenge/{id} → challenge token',
    code: 'Token TTL: 60s',
    color: 'var(--color-text)',
  },
  {
    step: 2,
    title: 'Client computes Schnorr proof LOCALLY',
    code: 'computeProof(password, token)\n{ commitment, response } — password never sent',
    color: 'var(--color-text)',
  },
  {
    step: 3,
    title: 'POST /intent { message, zkp_token, zkp_proof }',
    code: '← 200 { auth_info: { type: "zkp" } }',
    color: 'var(--color-text)',
  },
  {
    step: 4,
    title: 'Server verifies: g^s ≟ t × y^c (mod p)',
    code: 'Uses PUBLIC KEY only — cannot derive password',
    color: 'var(--color-text)',
  },
  {
    step: 5,
    title: 'Server returns result — password never received',
    code: '',
    color: 'var(--color-text)',
  },
]

// ─── Security Checklists ─────────────────────────────────────────
const OAUTH2_CHECKLIST = [
  { text: 'Private key must be kept secure on client', checked: true },
  { text: 'Server stores only public key (server safe even if DB breached)', checked: false },
  { text: 'Vulnerable to forged assertion if private key compromised', checked: true },
  { text: 'Access token can still be stolen from wire (HTTPS mitigates)', checked: false },
  { text: 'Zero-knowledge — no (PKJWT uses signatures, not ZK)', checked: true },
]

const ZKP_CHECKLIST = [
  { text: 'No password stored on server', checked: true },
  { text: 'Replay-protected (single-use challenge tokens)', checked: true },
  { text: 'Server only sees public key', checked: true },
  { text: 'Zero-knowledge proof — server cannot derive password', checked: true },
]

// ─── Terminal Window Component ──────────────────────────────────
function TerminalWindow({ children, borderColor }) {
  return (
    <div
      className="terminal-window"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      {children}
    </div>
  )
}

function TerminalHeader({ title }) {
  return (
    <div className="terminal-window-header">
      <div style={{ display: 'flex', gap: '6px' }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#EF4444', opacity: 0.5, display: 'block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#F59E0B', opacity: 0.5, display: 'block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10B981', opacity: 0.5, display: 'block' }} />
      </div>
      <span style={{ fontSize: '12px', color: 'var(--color-muted)', marginLeft: '8px' }}>{title}</span>
    </div>
  )
}

function TerminalContent({ children }) {
  return <div className="terminal-window-content">{children}</div>
}

// ─── Security Rating Bar ─────────────────────────────────────────
function SecurityRating({ score, maxScore, label, fillColor, darkColor }) {
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setAnimate(true), 50)
    return () => clearTimeout(timer)
  }, [])

  const percentage = (score / maxScore) * 100

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
        <span style={{ fontWeight: 600, color: darkColor }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{score}/{maxScore}</span>
      </div>
      <div style={{
        height: '8px',
        background: 'var(--color-border)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: animate ? `${percentage}%` : '0%',
          background: fillColor,
          borderRadius: '4px',
          transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
    </div>
  )
}

// ─── Step Flow ──────────────────────────────────────────────────
function FlowStep({ step, title, code, color, isAttack }) {
  return (
    <div style={{
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--color-muted)',
          minWidth: '20px',
        }}>
          {step}.
        </span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 600,
            color: color,
            marginBottom: code ? '4px' : 0,
          }}>
            {title}
          </div>
          {code && (
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-muted)',
              margin: 0,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}>
              {code}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Security Checklist ─────────────────────────────────────────
function SecurityChecklist({ items }) {
  return (
    <div style={{
      padding: 'var(--space-3)',
      borderTop: '1px solid var(--color-border)',
      marginTop: 'auto',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Security Checklist
      </div>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-2)',
          fontSize: '12px',
          color: 'var(--color-text)',
          marginBottom: '6px',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            color: item.checked ? 'var(--color-zkp)' : 'var(--color-attack)',
            fontWeight: 700,
          }}>
            {item.checked ? '[x]' : '[ ]'}
          </span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Protocol Side (OAuth2 or ZKP) ──────────────────────────────
function ProtocolSide({ type }) {
  const isOAuth2 = type === 'oauth2'
  const borderColor = isOAuth2 ? 'var(--color-oauth2)' : 'var(--color-zkp)'
  const badgeClass = isOAuth2 ? 'badge badge-oauth2' : 'badge badge-zkp'
  const badgeText = isOAuth2 ? 'TOKEN-BASED' : 'PROOF-BASED'
  const title = isOAuth2 ? 'OAuth2' : 'ZKP'
  const securityScore = isOAuth2 ? 68 : 95
  const securityLabel = isOAuth2 ? 'VULNERABLE' : 'SECURE'
  const securityFillColor = isOAuth2 ? '#EF4444' : 'var(--color-zkp)'
  const steps = isOAuth2 ? OAUTH2_STEPS : ZKP_STEPS
  const checklist = isOAuth2 ? OAUTH2_CHECKLIST : ZKP_CHECKLIST

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Protocol Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <span className={badgeClass}>{badgeText}</span>
        <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text)' }}>{title}</span>
      </div>

      {/* Security Rating Bar */}
      <SecurityRating
        score={securityScore}
        maxScore={100}
        label={securityLabel}
        fillColor={securityFillColor}
        darkColor={securityFillColor}
      />

      {/* Terminal Window */}
      <TerminalWindow borderColor={borderColor}>
        <TerminalHeader title={isOAuth2 ? 'oauth2-pkjwt-flow' : 'zkp-schnorr-flow'} />
        <TerminalContent>
          {steps.map((step) => (
            <FlowStep
              key={step.step}
              step={step.step}
              title={step.title}
              code={step.code}
              color={step.color}
              isAttack={step.isAttack}
            />
          ))}
          <SecurityChecklist items={checklist} />
        </TerminalContent>
      </TerminalWindow>
    </div>
  )
}

// ─── Main Compare Page ───────────────────────────────────────────
export default function Compare() {
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 1024)

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-6)' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text)', marginBottom: 'var(--space-2)' }}>
          Authentication Comparison
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-muted)', margin: 0 }}>
          OAuth2 (PKJWT) vs Zero-Knowledge Proof — security architecture comparison
        </p>
      </div>

      {/* Split Screen */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-4)',
        flexDirection: isNarrow ? 'column' : 'row',
      }}>
        <ProtocolSide type="oauth2" />
        <ProtocolSide type="zkp" />
      </div>
    </div>
  )
}