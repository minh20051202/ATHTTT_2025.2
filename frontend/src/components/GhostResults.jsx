/**
 * GhostResults — Terminal-style placeholder state (dark theme).
 * Shows "Waiting for your request..." with blinking amber cursor.
 */
export default function GhostResults() {
  return (
    <div style={{
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--border-radius-lg)',
      padding: 'var(--space-6)',
      background: 'var(--color-surface)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Terminal header dots */}
      <div style={{
        display: 'flex',
        gap: '6px',
        marginBottom: 'var(--space-4)',
      }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(239,68,68,0.6)' }} />
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(245,158,11,0.6)' }} />
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(16,185,129,0.6)' }} />
      </div>

      {/* Terminal content */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: 'var(--color-oauth2)',
      }}>
        <span style={{ color: 'var(--color-muted)' }}>$ </span>
        Waiting for your request
        <span className="blinking-cursor">|</span>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .blinking-cursor {
          animation: blink 1s step-end infinite;
          color: var(--color-oauth2);
          font-weight: 700;
        }
      `}</style>
    </div>
  )
}