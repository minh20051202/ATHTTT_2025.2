/**
 * MetricChart — shared bar-chart components for OAuth2 vs ZKP comparison.
 * Extracted from BenchmarkCard for reuse across auth demo surfaces.
 * Projection-optimized: 16px bars, 13px labels, large value numbers.
 */

// Inline badge showing which auth type wins for a metric
export function WinnerBadge({ winner }) {
  if (!winner) return null
  return (
    <span style={{
      padding: '2px 9px',
      background: winner === 'oauth2' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
      color: winner === 'oauth2' ? 'var(--color-oauth2)' : 'var(--color-zkp)',
      border: `1px solid ${winner === 'oauth2' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
      borderRadius: '100px',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.05em',
      lineHeight: '18px',
    }}>
      {winner === 'oauth2' ? 'OAUTH' : 'ZK'}
    </span>
  )
}

// Animate-on-mount percentage bar for one auth method
export function BarCell({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{
      height: '16px',
      background: 'var(--color-border)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: '6px',
        transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      }} />
    </div>
  )
}

// One metric row: label + OAuth2 bar + ZKP bar + values + optional winner badge
export function MetricRow({ label, oauth2Val, zkpVal, oauth2Max, zkpMax, unit = 'ms', showWinner }) {
  const oauth2Pct = oauth2Max > 0 ? Math.min((oauth2Val / oauth2Max) * 100, 100) : 0
  const zkpPct = zkpMax > 0 ? Math.min((zkpVal / zkpMax) * 100, 100) : 0
  const fmt = (v) => v < 10 ? v.toFixed(3) : v.toFixed(1)

  let winner = null
  if (showWinner && oauth2Val > 0 && zkpVal > 0) {
    winner = oauth2Val <= zkpVal ? 'oauth2' : 'zkp'
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '12px', alignItems: 'center' }}>
      {/* Label + winner badge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{
          fontSize: '13px',
          color: 'var(--color-muted)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}>
          {label}
        </span>
        {winner && <WinnerBadge winner={winner} />}
      </div>

      {/* OAuth2 bar */}
      {oauth2Val !== undefined && oauth2Val > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span style={{ fontSize: '13px', color: 'var(--color-oauth2)', fontWeight: 700 }}>OAuth2</span>
            <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span style={{ fontSize: '13px', color: 'var(--color-zkp)', fontWeight: 700 }}>ZKP</span>
            <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>
              {fmt(zkpVal)}{unit}
            </span>
          </div>
          <BarCell value={zkpVal} max={zkpMax} color="var(--color-zkp)" />
        </div>
      )}
    </div>
  )
}