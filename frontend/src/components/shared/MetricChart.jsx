/**
 * MetricChart — shared bar-chart components for OAuth2 vs ZKP comparison.
 */

export function BarCell({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{
      height: '16px',
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
      fontSize: 'clamp(10px, 1vw, 13px)',
      color: 'var(--color-muted)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      lineHeight: 1.2,
      overflowWrap: 'anywhere',
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
      gridTemplateColumns: 'minmax(72px, 0.9fr) minmax(0, 1fr) minmax(0, 1fr)',
      gap: 'clamp(8px, 1.4vw, 20px)',
      alignItems: 'center',
      padding: 'clamp(8px, 1vw, 12px) 0',
      minWidth: 0,
    }}>
      <RowLabelCell label={label} />

      {/* OAuth2 bar */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span className="font-mono" style={{ fontSize: 'clamp(11px, 1.05vw, 14px)', fontWeight: 700, color: 'var(--color-text)' }}>
            {oauth2Val ? `${fmt(oauth2Val)}${unit}` : '—'}
          </span>
        </div>
        <BarCell value={oauth2Val || 0} max={oauth2Max} color="var(--color-oauth2)" />
      </div>

      {/* ZKP bar */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span className="font-mono" style={{ fontSize: 'clamp(11px, 1.05vw, 14px)', fontWeight: 700, color: 'var(--color-text)' }}>
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
      gridTemplateColumns: 'minmax(72px, 0.9fr) minmax(0, 1fr) minmax(0, 1fr)',
      gap: 'clamp(8px, 1.4vw, 20px)',
      padding: 'clamp(8px, 1vw, 12px) 0',
      borderBottom: '1px solid var(--color-border)',
      marginBottom: 'var(--space-3)',
      minWidth: 0,
    }}>
      <div />
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-oauth2)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          OAuth2
        </span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-zkp)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          ZKP
        </span>
      </div>
    </div>
  )
}
