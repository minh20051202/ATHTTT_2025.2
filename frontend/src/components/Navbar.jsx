import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/chat', label: 'Chat' },
  { to: '/compare', label: 'Compare' },
  { to: '/attacks', label: 'Attacks' },
]

export default function Navbar() {
  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 'var(--navbar-height)',
      background: 'rgba(19, 27, 46, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(30, 41, 59, 0.8)',
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
        marginRight: 'auto',
        userSelect: 'none',
      }}>
        Agentic Commerce
      </span>

      {NAV_ITEMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          style={({ isActive }) => ({
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: isActive ? 600 : 500,
            color: isActive ? 'var(--color-primary)' : 'var(--color-muted)',
            textDecoration: 'none',
            padding: '6px var(--space-3)',
            borderRadius: 'var(--border-radius-pill)',
            background: isActive ? 'rgba(34, 211, 238, 0.1)' : 'transparent',
            boxShadow: isActive ? '0 0 12px rgba(34, 211, 238, 0.15)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            letterSpacing: '0.01em',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}