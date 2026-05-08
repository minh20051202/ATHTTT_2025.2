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

function HeroTerminal({ type, title, colorClass }) {
  const content = terminalContent[type];

  return (
    <div className={`terminal-window ${colorClass}`} style={{ borderLeftColor: type === 'oauth2' ? 'var(--color-oauth2)' : 'var(--color-zkp)', borderLeftWidth: '4px' }}>
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

function Stepper() {
  const steps = [
    { num: '01', title: 'User Initiates Auth', desc: 'Client requests authentication from the server' },
    { num: '02', title: 'Challenge-Response', desc: 'Server sends unique challenge; client computes proof' },
    { num: '03', title: 'Verify & Allow', desc: 'Server validates proof without learning the secret' },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: '0', width: '100%', overflowX: 'auto', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)' }}>
      {steps.map((step, i) => (
        <div key={step.num} style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '180px' }}>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'bold', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>{step.num}</div>
            <div style={{ fontSize: 'var(--text-base)', fontFamily: 'var(--font-sans)', fontWeight: '600', color: 'var(--color-text)', marginTop: 'var(--space-1)' }}>{step.title}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)', textAlign: 'center' }}>{step.desc}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', marginLeft: 'var(--space-4)', marginRight: 'var(--space-4)', marginTop: 'var(--space-1)', flexShrink: '0' }}>→</div>
          )}
        </div>
      ))}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', width: '100%', maxWidth: '80rem', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)' }}>
          <div style={{ flex: '1' }}>
            <HeroTerminal type="oauth2" title="OAuth 2.0 Flow" colorClass="border-l-[var(--color-oauth2)]" />
          </div>
          <div style={{ flex: '1' }}>
            <HeroTerminal type="zkp" title="ZKP Auth Flow" colorClass="border-l-[var(--color-zkp)]" />
          </div>
        </div>
      </section>

      {/* Stepper Section */}
      <section style={{ paddingTop: 'var(--space-16)', paddingBottom: 'var(--space-16)', borderTop: '1px solid var(--color-border)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-sans)', fontWeight: '600', textAlign: 'center', marginBottom: 'var(--space-12)', color: 'var(--color-text)' }}>
          How ZKP Authentication Works
        </h2>
        <Stepper />
      </section>

      {/* CTA Tiles */}
      <section style={{ paddingTop: 'var(--space-16)', paddingBottom: 'var(--space-16)', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-sans)', fontWeight: '600', color: 'var(--color-text)' }}>Explore Further</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', justifyContent: 'center', alignItems: 'center' }}>
          <CTATile to="/compare" borderColor="var(--color-oauth2)">
            <span style={{ color: 'var(--color-oauth2)', fontFamily: 'var(--font-sans)', fontWeight: '700', fontSize: 'var(--text-lg)' }}>Compare</span>
            <span style={{ color: 'var(--color-text)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', textAlign: 'center' }}>Side-by-side protocol comparison</span>
          </CTATile>
          <CTATile to="/attacks" borderColor="var(--color-zkp)">
            <span style={{ color: 'var(--color-zkp)', fontFamily: 'var(--font-sans)', fontWeight: '700', fontSize: 'var(--text-lg)' }}>Try Attacks</span>
            <span style={{ color: 'var(--color-text)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', textAlign: 'center' }}>Test attack vectors against OAuth2</span>
          </CTATile>
        </div>
      </section>

      {/* Mini Comparison Table */}
      <section style={{ paddingTop: 'var(--space-16)', paddingBottom: 'var(--space-16)', borderTop: '1px solid var(--color-border)', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)' }}>
        <div style={{ maxWidth: '42rem', marginLeft: 'auto', marginRight: 'auto' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-sans)', fontWeight: '600', textAlign: 'center', marginBottom: 'var(--space-8)', color: 'var(--color-text)' }}>
            Quick Comparison
          </h2>
          <div style={{ borderRadius: '8px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', fontFamily: 'var(--font-sans)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-4)', backgroundColor: 'var(--color-surface)', color: 'var(--color-muted)', fontWeight: '500' }}>Aspect</th>
                  <th style={{ textAlign: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--color-surface)', color: 'var(--color-oauth2)', fontWeight: '500' }}>OAuth 2.0</th>
                  <th style={{ textAlign: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--color-surface)', color: 'var(--color-zkp)', fontWeight: '500' }}>ZKP</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-4)', color: 'var(--color-text)' }}>Security</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-muted)' }}>Token-based</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-zkp)', fontWeight: '600' }}>Cryptographic</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-4)', color: 'var(--color-text)' }}>Complexity</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-oauth2)', fontWeight: '600' }}>Lower</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-muted)' }}>Higher</td>
                </tr>
                <tr>
                  <td style={{ padding: 'var(--space-4)', color: 'var(--color-text)' }}>Replay Protection</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-muted)' }}>Requires HTTPS</td>
                  <td style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-zkp)', fontWeight: '600' }}>Built-in</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}