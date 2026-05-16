import { NavLink } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <div style={{
          width: '20px',
          height: '20px',
          background: 'var(--color-primary)',
          borderRadius: '4px',
          display: 'grid',
          placeItems: 'center',
          color: 'white',
          fontSize: '10px'
        }}>A</div>
        Agentic Commerce
      </div>

      <div className="navbar-links">
        <NavLink 
          to="/" 
          className={({ isActive }) => `navbar-link ${isActive ? 'active' : ''}`}
        >
          Chat
        </NavLink>
        <NavLink 
          to="/attacks" 
          className={({ isActive }) => `navbar-link ${isActive ? 'active' : ''}`}
        >
          Attack Simulation
        </NavLink>
      </div>
    </nav>
  )
}
