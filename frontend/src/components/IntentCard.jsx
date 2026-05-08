/**
 * IntentCard — shows extracted intent (action, params, confidence)
 * Displayed first in results per pipeline order (dark theme).
 */
export default function IntentCard({ intent }) {
  if (!intent) return null

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '6px',
    }}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)' }}>
        Intent
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{
          background: 'var(--color-oauth2-muted)',
          borderRadius: 'var(--border-radius-sm)',
          padding: '2px 8px',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-oauth2)',
          fontWeight: 600,
        }}>
          {intent.action}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text)' }}>
            Parameters
          </div>
          <pre style={{
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-muted)',
            whiteSpace: 'pre-wrap',
            background: 'transparent',
            margin: 0,
          }}>
            {JSON.stringify(intent.parameters, null, 2)}
          </pre>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '2px' }}>
            Confidence
          </div>
          <div style={{
            fontSize: '20px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-primary)',
          }}>
            {Math.round((intent.confidence || 0) * 100)}%
          </div>
        </div>
      </div>
    </div>
  )
}