export default function Navbar() {
  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 'var(--navbar-height)',
      background: 'rgba(244, 242, 238, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 var(--space-6)',
      gap: 'var(--space-2)',
      zIndex: 50,
    }}>
      {/* Logo / wordmark */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize: '15px',
        color: 'var(--color-primary)',
        letterSpacing: '-0.02em',
        userSelect: 'none',
      }}>
        Agentic Commerce
      </span>
    </nav>
  )
}