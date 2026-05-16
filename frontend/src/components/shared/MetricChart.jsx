/**
 * MetricChart — shared bar-chart components for OAuth2 vs ZKP comparison.
 */

export function BarCell({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{
      height: '10px',
      background: 'var(--color-surface)',
      borderRadius: 'var(--border-radius-pill)',
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: 'var(--border-radius-pill)',
        transition: 'width 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      }} />
    </div>
  )
}

function RowLabelCell({ label }) {
  return (
    <span style={{
      fontSize: '11px',
      color: 'var(--color-muted)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {label}
    </span>
  )
}

export function MetricRow({ label, oauth2Val, zkpVal, oauth2Max, zkpMax, unit = 'ms' }) {
  const fmt = (v) => v < 1 ? v.toFixed(3) : v.toFixed(1)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '80px 1fr 1fr',
      gap: 'var(--space-4)',
      alignItems: 'center',
      padding: 'var(--space-2) 0',
    }}>
      <RowLabelCell label={label} />

      {/* OAuth2 bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span className="font-mono" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)' }}>
            {oauth2Val ? `${fmt(oauth2Val)}${unit}` : '—'}
          </span>
        </div>
        <BarCell value={oauth2Val || 0} max={oauth2Max} color="var(--color-oauth2)" />
      </div>

      {/* ZKP bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span className="font-mono" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)' }}>
            {zkpVal ? `${fmt(zkpVal)}${unit}` : '—'}
          </span>
        </div>
        <BarCell value={zkpVal || 0} max={zkpMax} color="var(--color-zkp)" />
      </div>
    </div>
  )
}

export function MetricHeader() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '80px 1fr 1fr',
      gap: 'var(--space-4)',
      padding: 'var(--space-2) 0',
      borderBottom: '1px solid var(--color-border)',
      marginBottom: 'var(--space-2)',
    }}>
      <div />
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-oauth2)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          OAuth2
        </span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-zkp)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          ZKP
        </span>
      </div>
    </div>
  )
}
