/**
 * Attacks page — simulates attack types against OAuth2 vs ZKP auth.
 * Split-screen breach/protection animation with forensics cards.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useChatHistory } from '../context/ChatHistoryContext.jsx'

const ATTACK_TYPES = [
  { key: 'replay', label: 'Replay Attack', desc: 'Reuse a captured token or proof', icon: '↺' },
  { key: 'token_theft', label: 'Token Theft', desc: 'Extract credentials from a valid token', icon: '⚿' },
  {
    key: 'credential_stuffing',
    label: 'Credential Stuffing',
    desc: 'Use stolen tokens to authenticate',
    icon: '📋',
  },
]

export default function Attacks() {
  const { latestResult } = useChatHistory()
  const [attackType, setAttackType] = useState('replay')
  const [oauth2Phase, setOauth2Phase] = useState('idle')
  const [zkpPhase, setZkpPhase] = useState('idle')
  const [showForensics, setShowForensics] = useState(false)
  const [blinkState, setBlinkState] = useState(false)
  const [replayDebounce, setReplayDebounce] = useState(false)

  const timeoutRefs = useRef({})
  const replayTimeoutRef = useRef(null)

  const clearAllTimeouts = useCallback(() => {
    Object.values(timeoutRefs.current).forEach(clearTimeout)
    timeoutRefs.current = {}
  }, [])

  const resetPanels = useCallback(() => {
    clearAllTimeouts()
    setOauth2Phase('idle')
    setZkpPhase('idle')
    setShowForensics(false)
    setBlinkState(false)
    setReplayDebounce(false)
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current)
      replayTimeoutRef.current = null
    }
  }, [clearAllTimeouts])

  // OAuth2 breach animation state machine
  useEffect(() => {
    if (oauth2Phase === 'idle') return

    let t

    if (oauth2Phase === 'dim') {
      t = setTimeout(() => setOauth2Phase('flash'), 200)
    } else if (oauth2Phase === 'flash') {
      t = setTimeout(() => setOauth2Phase('blink'), 400)
    } else if (oauth2Phase === 'blink') {
      let blinks = 0
      const blinkInterval = setInterval(() => {
        blinks++
        setBlinkState(prev => !prev)
        if (blinks >= 3) {
          clearInterval(blinkInterval)
          setOauth2Phase('exfil')
          setBlinkState(false)
        }
      }, 80)
      t = timeoutRefs.current.blinkInterval = setTimeout(() => clearInterval(blinkInterval), 600)
      return () => clearInterval(blinkInterval)
    } else if (oauth2Phase === 'exfil') {
      t = setTimeout(() => setOauth2Phase('done'), 600)
    }

    if (t) timeoutRefs.current[oauth2Phase] = t
    return () => clearTimeout(t)
  }, [oauth2Phase])

  // ZKP animation runs alongside OAuth2
  useEffect(() => {
    if (oauth2Phase === 'idle') return

    if (oauth2Phase === 'dim' && zkpPhase === 'idle') {
      timeoutRefs.current.zkp_start = setTimeout(() => {
        setZkpPhase('pulse')
      }, 0)
    }

    return () => {}
  }, [oauth2Phase])

  useEffect(() => {
    if (zkpPhase === 'pulse') {
      const t = setTimeout(() => setZkpPhase('check'), 400)
      timeoutRefs.current.zkp_check = t
    } else if (zkpPhase === 'check') {
      const t = setTimeout(() => setZkpPhase('label'), 200)
      timeoutRefs.current.zkp_label = t
    } else if (zkpPhase === 'label') {
      const t = setTimeout(() => setZkpPhase('done'), 300)
      timeoutRefs.current.zkp_done = t
    } else if (zkpPhase === 'done' && oauth2Phase === 'done') {
      const t = setTimeout(() => setShowForensics(true), 200)
      timeoutRefs.current.show_forensics = t
    }
  }, [zkpPhase, oauth2Phase])

  const handleExecute = () => {
    resetPanels()
    setOauth2Phase('dim')
    setZkpPhase('idle')
  }

  const handleReplay = () => {
    if (replayDebounce) return
    setReplayDebounce(true)
    resetPanels()
    handleExecute()
    replayTimeoutRef.current = setTimeout(() => setReplayDebounce(false), 1500)
  }

  const animationDone = oauth2Phase === 'done' && zkpPhase === 'done'
  const hasToken = latestResult?.auth_info && (latestResult.auth_info.token || latestResult.auth_info.proof)

  const token = latestResult?.auth_info?.type === 'oauth2'
    ? latestResult.auth_info.token
    : latestResult.auth_info?.proof

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: 'var(--space-8)' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: 'var(--space-2)' }}>Attack Simulation</h1>
        <p style={{ fontSize: '14px', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>
          Visualize OAuth2 vulnerabilities vs ZKP protection. Token and proof are loaded from the latest chat session.
        </p>

        {/* Attack type selector */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
          {ATTACK_TYPES.map(({ key, label, desc, icon }) => (
            <button
              key={key}
              onClick={() => { setAttackType(key); }}
              style={{
                flex: '1 1 200px',
                padding: 'var(--space-4)',
                border: attackType === key ? '2px solid var(--color-attack)' : '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius-lg)',
                background: attackType === key ? 'var(--color-attack-muted)' : 'var(--color-surface)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                <span style={{ fontSize: '16px' }}>{icon}</span>
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text)' }}>{label}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* Token preview */}
        {!hasToken ? (
          <div style={{
            padding: 'var(--space-6)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius-lg)',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '14px',
          }}>
            No token from any chat session.{' '}
            <a href="/chat" style={{ color: 'var(--color-oauth2)' }}>Go to Chat</a>
            {' '}to create one.
          </div>
        ) : (
          <div style={{
            padding: 'var(--space-4)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius-lg)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Loaded from latest session — {latestResult?.auth_info?.type?.toUpperCase() ?? 'NONE'}
            </div>
            <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)', wordBreak: 'break-all' }}>
              {latestResult?.auth_info?.type === 'oauth2'
                ? `Token: ${(latestResult.auth_info.token || '').slice(0, 30)}...`
                : `Proof: ${(latestResult.auth_info?.proof || '').slice(0, 30)}...`
              }
            </div>
          </div>
        )}

        {/* Split execution area */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          {/* OAuth2 breach panel */}
          <div
            style={{
              borderTop: '3px solid var(--color-oauth2)',
              border: oauth2Phase === 'done' ? '1px solid var(--color-attack)' : '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius-lg)',
              background: 'var(--color-surface)',
              overflow: 'hidden',
              opacity: oauth2Phase === 'idle' ? 1 : 0.7,
              transition: 'opacity 0.15s ease',
              position: 'relative',
              padding: 'var(--space-4)',
              minHeight: '180px',
            }}
          >
            {/* Red flash overlay */}
            {oauth2Phase === 'flash' && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(239,68,68,0.3)',
                animation: 'fadeOut 0.15s ease forwards',
              }} />
            )}

            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-oauth2)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              OAuth2 Breach
            </div>

            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: blinkState ? 'var(--color-oauth2)' : 'var(--color-text)',
              transition: 'color 0.05s ease',
              marginBottom: 'var(--space-3)',
              wordBreak: 'break-all',
            }}>
              {token ? `"${token.slice(0, 30)}..."` : '(no token loaded)'}
            </div>

            {/* EXFILTRATED label */}
            {oauth2Phase === 'exfil' || oauth2Phase === 'done' ? (
              <div style={{
                display: 'inline-block',
                background: 'var(--color-attack)',
                color: 'white',
                padding: '4px 10px',
                borderRadius: '4px',
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.05em',
                animation: 'shake 0.4s ease',
              }}>
                EXFILTRATED
              </div>
            ) : null}

            {oauth2Phase === 'done' && (
              <button
                onClick={handleReplay}
                disabled={replayDebounce}
                style={{
                  marginTop: 'var(--space-3)',
                  padding: '8px 16px',
                  background: replayDebounce ? 'var(--color-muted)' : 'var(--color-attack)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: replayDebounce ? 'not-allowed' : 'pointer',
                  opacity: replayDebounce ? 0.7 : 1,
                  animation: replayDebounce ? 'debounce-pulse 0.75s infinite' : 'none',
                }}
              >
                Replay Attack
              </button>
            )}
          </div>

          {/* ZKP protection panel */}
          <div
            style={{
              borderTop: '3px solid var(--color-zkp)',
              border: zkpPhase === 'done' ? '1px solid var(--color-zkp)' : '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius-lg)',
              background: 'var(--color-surface)',
              overflow: 'hidden',
              position: 'relative',
              padding: 'var(--space-4)',
              minHeight: '180px',
            }}
          >
            {/* Emerald pulse */}
            {zkpPhase === 'pulse' && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'rgba(16,185,129,0.3)',
                  animation: 'pulse-scale 0.4s ease forwards',
                }} />
              </div>
            )}

            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-zkp)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ZKP Protection
            </div>

            {/* Checkmark icon */}
            {(zkpPhase === 'check' || zkpPhase === 'label' || zkpPhase === 'done') && (
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--color-zkp)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--space-3)',
                color: 'white',
                fontWeight: 700,
                fontSize: '16px',
                opacity: 0,
                animation: 'fadeIn 0.3s ease forwards',
              }}>
                &#10003;
              </div>
            )}

            {/* Slide-in label */}
            {(zkpPhase === 'label' || zkpPhase === 'done') ? (
              <div style={{
                background: 'var(--color-zkp-muted)',
                border: '1px solid var(--color-zkp)',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-zkp)',
                letterSpacing: '0.03em',
                animation: 'slide-up 0.2s ease forwards',
              }}>
                PROOF ACCEPTED — NO DATA EXPOSED
              </div>
            ) : null}
          </div>
        </div>

        {/* Execute and Reset buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <button
            onClick={handleExecute}
            disabled={!hasToken || oauth2Phase !== 'idle'}
            style={{
              flex: 1,
              padding: 'var(--space-3) var(--space-4)',
              background: oauth2Phase !== 'idle' ? 'var(--color-muted)' : 'var(--color-attack)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: !hasToken || oauth2Phase !== 'idle' ? 'not-allowed' : 'pointer',
              opacity: !hasToken || oauth2Phase !== 'idle' ? 0.5 : 1,
            }}
          >
            Execute Attack
          </button>
          {animationDone && (
            <button
              onClick={resetPanels}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'transparent',
                color: 'var(--color-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Forensics cards */}
        {showForensics && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            {/* OAuth2 forensics card */}
            <div style={{
              border: '1px solid var(--color-attack)',
              borderRadius: 'var(--border-radius-lg)',
              padding: 'var(--space-4)',
              background: 'var(--color-attack-muted)',
            }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-attack)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DATA EXFILTRATED
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-2)', fontSize: '13px' }}>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Token: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text)' }}>
                    {token ? `${token.slice(0, 30)}...` : '—'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Threat: </span>
                  <span style={{ color: 'var(--color-text)' }}>Token replay, man-in-the-middle</span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Impact: </span>
                  <span style={{ color: 'var(--color-text)' }}>Attacker can impersonate user until token expires</span>
                </div>
              </div>
            </div>

            {/* ZKP forensics card */}
            <div style={{
              border: '1px solid var(--color-zkp)',
              borderRadius: 'var(--border-radius-lg)',
              padding: 'var(--space-4)',
              background: 'var(--color-zkp-muted)',
            }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-zkp)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                NO DATA EXPOSED
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-2)', fontSize: '13px' }}>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Proof size: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text)' }}>~200 bytes (public key only)</span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Threat: </span>
                  <span style={{ color: 'var(--color-zkp)' }}>NONE identified</span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>Impact: </span>
                  <span style={{ color: 'var(--color-text)' }}>Proof is useless without the original password</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Timing comparison bar chart */}
        {showForensics && (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius-lg)',
            padding: 'var(--space-4)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Timing Comparison
            </div>

            {/* OAuth2 bar */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-attack)', fontWeight: 600 }}>OAuth2 Attack</span>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>~850ms</span>
              </div>
              <div style={{ height: '12px', background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: '95%',
                  height: '100%',
                  background: 'var(--color-attack)',
                  borderRadius: '4px',
                }} />
              </div>
            </div>

            {/* ZKP bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-zkp)', fontWeight: 600 }}>ZKP Proof</span>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>~200ms</span>
              </div>
              <div style={{ height: '12px', background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: '22%',
                  height: '100%',
                  background: 'var(--color-zkp)',
                  borderRadius: '4px',
                }} />
              </div>
            </div>
          </div>
        )}
      </div>
  )
}