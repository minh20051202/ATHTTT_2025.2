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
    <div className={`terminal-window ${colorClass}`}>
      <div className="terminal-window-header">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${type === 'oauth2' ? 'bg-[var(--color-oauth2)]' : 'bg-[var(--color-zkp)]'}`} />
          <span className="terminal-title">{title}</span>
        </div>
        <span className={`badge-${type} text-xs px-2 py-0.5 rounded`}>
          {type === 'oauth2' ? 'OAuth 2.0' : 'ZKP'}
        </span>
      </div>
      <div className="terminal-window-content">
        {content.map((line, i) => (
          <div key={i} className={line.startsWith('> [') ? 'text-[var(--color-muted)]' : ''}>
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
    <div className="flex items-start justify-center gap-0 w-full overflow-x-auto px-4">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-start">
          <div className="flex flex-col items-center min-w-[180px]">
            <div className="text-2xl font-bold text-[var(--color-primary)] font-mono">{step.num}</div>
            <div className="text-base font-sans font-semibold text-[var(--color-text)] mt-1">{step.title}</div>
            <div className="text-sm text-[var(--color-muted)] mt-1 text-center">{step.desc}</div>
          </div>
          {i < steps.length - 1 && (
            <div className="text-[var(--color-muted)] font-mono text-xl mx-4 mt-1 flex-shrink-0">→</div>
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
      className="flex flex-col items-center justify-center p-6 rounded-lg border-2 transition-all hover:scale-105 min-w-[160px]"
      style={{
        borderColor: borderColor,
        backgroundColor: borderColor === 'var(--color-oauth2)' ? 'var(--color-oauth2-muted)' : 'var(--color-zkp-muted)',
      }}
    >
      {children}
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Hero Headline */}
      <section className="flex flex-col items-center justify-center min-h-screen px-4 py-16">
        <h1 className="text-3xl md:text-4xl font-sans font-bold text-center max-w-3xl mb-16 leading-tight">
          Agent Authentication:{' '}
          <span className="text-[var(--color-oauth2)]">OAuth2</span> vs{' '}
          <span className="text-[var(--color-zkp)]">Zero-Knowledge Proof</span>
        </h1>

        {/* Dual Console Panels */}
        <div className="flex flex-col lg:flex-row gap-8 w-full max-w-5xl px-4">
          <div className="flex-1">
            <HeroTerminal type="oauth2" title="OAuth 2.0 Flow" colorClass="border-l-[var(--color-oauth2)]" />
          </div>
          <div className="flex-1">
            <HeroTerminal type="zkp" title="ZKP Auth Flow" colorClass="border-l-[var(--color-zkp)]" />
          </div>
        </div>
      </section>

      {/* Stepper Section */}
      <section className="py-16 border-t border-[var(--color-border)]">
        <h2 className="text-xl font-sans font-semibold text-center mb-12 text-[var(--color-text)]">
          How ZKP Authentication Works
        </h2>
        <Stepper />
      </section>

      {/* CTA Tiles */}
      <section className="py-16 border-t border-[var(--color-border)] flex flex-col items-center gap-6">
        <h2 className="text-xl font-sans font-semibold text-[var(--color-text)]">Explore Further</h2>
        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
          <CTATile to="/compare" borderColor="var(--color-oauth2)">
            <span className="text-[var(--color-oauth2)] font-sans font-bold text-lg">Compare</span>
            <span className="text-[var(--color-text)] text-sm mt-1 text-center">Side-by-side protocol comparison</span>
          </CTATile>
          <CTATile to="/attacks" borderColor="var(--color-zkp)">
            <span className="text-[var(--color-zkp)] font-sans font-bold text-lg">Try Attacks</span>
            <span className="text-[var(--color-text)] text-sm mt-1 text-center">Test attack vectors against OAuth2</span>
          </CTATile>
        </div>
      </section>

      {/* Mini Comparison Table */}
      <section className="py-16 border-t border-[var(--color-border)] px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-sans font-semibold text-center mb-8 text-[var(--color-text)]">
            Quick Comparison
          </h2>
          <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
            <table className="w-full font-sans">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left p-4 bg-[var(--color-surface)] text-[var(--color-muted)] font-medium">Aspect</th>
                  <th className="text-center p-4 bg-[var(--color-surface)] text-[var(--color-oauth2)] font-medium">OAuth 2.0</th>
                  <th className="text-center p-4 bg-[var(--color-surface)] text-[var(--color-zkp)] font-medium">ZKP</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-4 text-[var(--color-text)]">Security</td>
                  <td className="p-4 text-center text-[var(--color-muted)]">Token-based</td>
                  <td className="p-4 text-center text-[var(--color-zkp)] font-semibold">Cryptographic</td>
                </tr>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-4 text-[var(--color-text)]">Complexity</td>
                  <td className="p-4 text-center text-[var(--color-oauth2)] font-semibold">Lower</td>
                  <td className="p-4 text-center text-[var(--color-muted)]">Higher</td>
                </tr>
                <tr>
                  <td className="p-4 text-[var(--color-text)]">Replay Protection</td>
                  <td className="p-4 text-center text-[var(--color-muted)]">Requires HTTPS</td>
                  <td className="p-4 text-center text-[var(--color-zkp)] font-semibold">Built-in</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}