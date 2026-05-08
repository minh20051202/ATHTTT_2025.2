import { Link } from 'react-router-dom';

const terminalContent = {
  oauth2: [
    '> Initiating OAuth2 authentication flow...',
    '>',
    '> [1] Client sends auth request to Authorization Server',
    '>     GET /authorize?client_id=demo&redirect_uri=https://app/callback',
    '>',
    '> [2] Resource owner authenticates & grants permission',
    '>     User logs in with credentials',
    '>     Consent screen displayed',
    '>',
    '> [3] Authorization server issues authorization code',
    '>     Response: GET https://app/callback?code=AUTH_CODE_abc123',
    '>',
    '> [4] Client exchanges code for access token',
    '>     POST /token { code: AUTH_CODE_abc123, client_secret: ... }',
    '>     Response: { access_token: "eyJhbG...", token_type: "Bearer" }',
    '>',
    '> [5] Client uses token to access protected resources',
    '>     GET /api/userprofile',
    '>     Header: Authorization: Bearer eyJhbG...',
    '>',
    '> [VULNERABLE] Token exposed in browser history',
    '> [VULNERABLE] No proof of identity - only possession',
    '>',
    '> Access token acquired: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    '> Token type: Bearer | Expires: 3600s | Scope: read write',
  ],
  zkp: [
    '> Initiating ZKP-based authentication flow...',
    '>',
    '> [1] Client generates cryptographic commitment',
    '>     Commitment: COM(user_id, secret, nonce) = h(abc123...)',
    '>     Random nonce generated for each session',
    '>',
    '> [2] Server sends authentication challenge',
    '>     Challenge: "Prove you know the secret without revealing it"',
    '>     Random challenge: c = sha256(nonce || commitment)',
    '>',
    '> [3] Client computes zero-knowledge proof',
    '>     Response: r = secret + c * nonce (mod n)',
    '>     Proof generated WITHOUT transmitting secret',
    '>',
    '> [4] Server verifies proof deterministically',
    '>     Verify: g^r == commitment * challenge^c (mod p)',
    '>     Cryptographic verification: PASSED',
    '>',
    '> [5] Session established - identity proven, secret never shared',
    '>     No tokens stored | No credentials transmitted',
    '>',
    '> [SECURE] Secret never leaves client',
    '> [SECURE] Each session uses fresh randomness',
    '> [SECURE] No replay possible - challenge is unique',
    '>',
    '> Authentication result: VERIFIED',
    '> Proof valid: true | Replay protection: true | Secret exposed: false',
  ],
};

function HeroTerminal({ type, title }) {
  const content = terminalContent[type];

  return (
    <div className="terminal-window" style={{ borderLeftColor: type === 'oauth2' ? 'var(--color-oauth2)' : 'var(--color-zkp)', borderLeftWidth: '4px' }}>
      <div className="terminal-window-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="status-dot" style={{ backgroundColor: type === 'oauth2' ? 'var(--color-oauth2)' : 'var(--color-zkp)' }} />
          <span className="terminal-title">{title}</span>
        </div>
        <span className={`badge-${type}`} style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', paddingTop: '2px', paddingBottom: '2px', borderRadius: '4px', display: 'inline-block' }}>
          {type === 'oauth2' ? 'OAuth 2.0' : 'ZKP'}
        </span>
      </div>
      <div className="terminal-window-content">
        {content.map((line, i) => (
          <div key={i} style={line.startsWith('> [') ? { color: 'var(--color-muted)' } : {}}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function CTATile({ to, borderColor, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        borderRadius: '8px',
        border: '2px solid',
        borderColor: borderColor,
        backgroundColor: borderColor === 'var(--color-oauth2)' ? 'var(--color-oauth2-muted)' : 'var(--color-zkp-muted)',
        minWidth: '160px',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
    >
      {children}
    </Link>
  );
}

export default function Landing() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Hero Headline */}
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)', paddingTop: 'var(--space-16)', paddingBottom: 'var(--space-16)' }}>
        <h1 style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontFamily: 'var(--font-sans)', fontWeight: '700', textAlign: 'center', maxWidth: '48rem', marginBottom: 'var(--space-16)', lineHeight: '1.2' }}>
          Agent Authentication:{' '}
          <span style={{ color: 'var(--color-oauth2)' }}>OAuth2</span> vs{' '}
          <span style={{ color: 'var(--color-zkp)' }}>Zero-Knowledge Proof</span>
        </h1>

        {/* Dual Console Panels */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-8)', width: '100%', maxWidth: '80rem', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)', alignItems: 'stretch' }}>
          <div style={{ flex: '1', minWidth: 0 }}>
            <HeroTerminal type="oauth2" title="OAuth 2.0 Flow" />
          </div>
          <div style={{ flex: '1', minWidth: 0 }}>
            <HeroTerminal type="zkp" title="ZKP Auth Flow" />
          </div>
        </div>
      </section>
    </div>
  );
}