/**
 * BenchmarkCard — live side-by-side comparison of OAuth2 vs ZKP authentication.
 * Shows bar-chart rows for speed, latency, and payload size.
 * Visible once at least one auth result exists in resultsByAuth.
 */
import { useState, useEffect } from 'react'
import { useChatHistory } from '../context/ChatHistoryContext.jsx'

// Inline badge showing which auth type wins for a metric
function WinnerBadge({ winner }) {
  if (!winner) return null
  return (
    <span style={{
      padding: '1px 7px',
      background: winner === 'oauth2' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
      color: winner === 'oauth2' ? 'var(--color-oauth2)' : 'var(--color-zkp)',
      border: `1px solid ${winner === 'oauth2' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
      borderRadius: '100px',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.04em',
      lineHeight: '16px',
    }}>
      {winner === 'oauth2' ? 'token' : 'secure'}
    </span>
  )
}

// Animate-on-mount percentage bar for one auth method
function BarCell({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{
      height: '8px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '4px',
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: '4px',
        transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      }} />
    </div>
  )
}

// One metric row: label + OAuth2 bar + ZKP bar + values + optional winner badge
function MetricRow({ label, oauth2Val, zkpVal, oauth2Max, zkpMax, unit = 'ms', showWinner }) {
  const oauth2Pct = oauth2Max > 0 ? Math.min((oauth2Val / oauth2Max) * 100, 100) : 0
  const zkpPct = zkpMax > 0 ? Math.min((zkpVal / zkpMax) * 100, 100) : 0
  const fmt = (v) => v < 10 ? v.toFixed(3) : v.toFixed(1)

  let winner = null
  if (showWinner && oauth2Val > 0 && zkpVal > 0) {
    winner = oauth2Val <= zkpVal ? 'oauth2' : 'zkp'
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '8px', alignItems: 'center' }}>
      {/* Label + winner badge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span style={{
          fontSize: '11px',
          color: 'var(--color-muted)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {label}
        </span>
        {winner && <WinnerBadge winner={winner} />}
      </div>

      {/* OAuth2 bar */}
      {oauth2Val !== undefined && oauth2Val > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-oauth2)', fontWeight: 600 }}>OAuth2</span>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
              {fmt(oauth2Val)}{unit}
            </span>
          </div>
          <BarCell value={oauth2Val} max={oauth2Max} color="var(--color-oauth2)" />
        </div>
      )}
      {/* OAuth2 placeholder when no result yet */}
      {(!oauth2Val || oauth2Val <= 0) && <div />}

      {/* ZKP bar */}
      {zkpVal !== undefined && zkpVal > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-zkp)', fontWeight: 600 }}>ZKP</span>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
              {fmt(zkpVal)}{unit}
            </span>
          </div>
          <BarCell value={zkpVal} max={zkpMax} color="var(--color-zkp)" />
        </div>
      )}
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
      <span style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 600 }}>{label}</span>
    </div>
  )
}

export default function BenchmarkCard() {
  const { resultsByAuth } = useChatHistory()
  const [animated, setAnimated] = useState(false)

  // All hooks must be called unconditionally — guard after useEffect
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 60)
    return () => clearTimeout(t)
  }, [])

  const oauth2 = resultsByAuth?.oauth2
  const zkp = resultsByAuth?.zkp

  // Guard: show nothing until at least one auth result exists
  // (after all hooks above, per Rules of Hooks)
  if (!oauth2 && !zkp) return null

  const oauth2Auth = oauth2?.auth_info
  const zkpAuth = zkp?.auth_info

  // Verification time (seconds → ms)
  const oauth2Verify = (oauth2Auth?.verification_time ?? 0) * 1000
  const zkpVerify = (zkpAuth?.verification_time ?? 0) * 1000

  // Total timing
  const oauth2Total = (oauth2?.timing?.total ?? 0) * 1000
  const zkpTotal = (zkp?.timing?.total ?? 0) * 1000

  // Payload sizes
  const oauth2Payload = oauth2Auth?.token_size ?? 0
  const zkpPayload = zkpAuth?.proof_info?.proof_size ?? 0

  // Max values across both auth types (for bar normalization)
  const VERIFY_MAX = Math.max(oauth2Verify, zkpVerify, 0.001)
  const TOTAL_MAX = Math.max(oauth2Total, zkpTotal, 0.001)
  const PAYLOAD_MAX = Math.max(oauth2Payload, zkpPayload, 1)

  return (
    <div style={{
      opacity: animated ? 1 : 0,
      transform: animated ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 0.35s ease, transform 0.35s ease',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--border-radius-lg)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📊</span>
          <span style={{
            fontWeight: 700,
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--color-text)',
          }}>
            Live Benchmark
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <LegendDot color="var(--color-oauth2)" label="OAuth2" />
          <LegendDot color="var(--color-zkp)" label="ZKP" />
        </div>
      </div>

      {/* Metric rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <MetricRow
          label="Verify"
          oauth2Val={oauth2Verify}
          zkpVal={zkpVerify}
          oauth2Max={VERIFY_MAX}
          zkpMax={VERIFY_MAX}
          unit="ms"
          showWinner={true}
        />
        <MetricRow
          label="Total"
          oauth2Val={oauth2Total}
          zkpVal={zkpTotal}
          oauth2Max={TOTAL_MAX}
          zkpMax={TOTAL_MAX}
          unit="ms"
          showWinner={false}
        />
        <MetricRow
          label="Payload"
          oauth2Val={oauth2Payload}
          zkpVal={zkpPayload}
          oauth2Max={PAYLOAD_MAX}
          zkpMax={PAYLOAD_MAX}
          unit="B"
          showWinner={true}
        />
      </div>

      {/* Summary pills — shown when both results are available */}
      {oauth2Auth && zkpAuth && (
        <div style={{
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          {zkpVerify < oauth2Verify && oauth2Verify > 0 && (
            <div style={{
              padding: '3px 10px',
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-zkp)',
            }}>
              ZKP {((oauth2Verify / zkpVerify - 1) * 100).toFixed(0)}% faster
            </div>
          )}
          <div style={{
            padding: '3px 10px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--color-muted)',
          }}>
            OAuth2: server stores RSA keypair | ZKP: server stores public key only
          </div>
        </div>
      )}
    </div>
  )
}