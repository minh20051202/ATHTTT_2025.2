/**
 * @deprecated ZKPFlow is unused — the 5-step ZKP data flow is now shown
 * in ComputationSidebar/ActionLog. Kept for reference only.
 * Will be removed in a future release.
 */
/**
 * ZKPFlow — 5-step horizontal data flow explainer (dark theme).
 * Each step: circle connector with title + description.
 * Active/completed state uses emerald ZKP color.
 */
const ZKP_STEPS = [
  {
    num: '1',
    title: 'Challenge Fetch',
    desc: 'GET /zkp-challenge/{id}',
    detail: 'Server issues challenge token (5min TTL)',
  },
  {
    num: '2',
    title: 'Proof Compute',
    desc: 'computeProof(password, token)',
    detail: 'Client computes Schnorr proof locally',
  },
  {
    num: '3',
    title: 'Proof Send',
    desc: 'POST /intent { message, zkp_token, zkp_proof }',
    detail: 'Only proof goes to server',
  },
  {
    num: '4',
    title: 'Server Verify',
    desc: 'g^s ≟ t × y^c (mod p)',
    detail: 'Server verifies against stored public key',
  },
  {
    num: '5',
    title: 'Response Return',
    desc: 'Verified ✓ — password never sent',
    detail: 'Server response',
  },
]

export default function ZKPFlow({ currentStep = 3 }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      padding: 'var(--space-5)',
    }}>
      <div style={{
        fontWeight: 700,
        fontSize: '14px',
        marginBottom: 'var(--space-5)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-mono)',
      }}>
        ZKP Authentication Flow
      </div>

      {/* Horizontal stepper */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        position: 'relative',
      }}>
        {/* Connector line behind circles */}
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          right: '20px',
          height: '2px',
          background: 'var(--color-border)',
          zIndex: 0,
        }} />
        {/* Filled portion of connector */}
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          width: `${((currentStep - 1) / (ZKP_STEPS.length - 1)) * 100}%`,
          height: '2px',
          background: 'var(--color-zkp)',
          zIndex: 1,
          transition: 'width 0.4s ease',
        }} />

        {ZKP_STEPS.map((step) => {
          const isCompleted = step.num < currentStep
          const isActive = step.num == currentStep

          return (
            <div
              key={step.num}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 2,
                flex: 1,
              }}
            >
              {/* Circle */}
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: `2px solid ${isCompleted || isActive ? 'var(--color-zkp)' : 'var(--color-muted)'}`,
                background: isCompleted
                  ? 'rgba(16,185,129,0.15)'
                  : isActive
                    ? 'rgba(16,185,129,0.12)'
                    : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: isCompleted || isActive ? 'var(--color-zkp)' : 'var(--color-muted)',
                transition: 'all 0.3s ease',
              }}>
                {isCompleted ? '✓' : step.num}
              </div>

              {/* Title */}
              <div style={{
                marginTop: '10px',
                fontSize: '11px',
                fontWeight: 600,
                color: isActive ? 'var(--color-zkp)' : 'var(--color-text)',
                textAlign: 'center',
                fontFamily: 'var(--font-sans)',
              }}>
                {step.title}
              </div>

              {/* Desc */}
              <div style={{
                marginTop: '2px',
                fontSize: '9px',
                color: 'var(--color-muted)',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                maxWidth: '70px',
                lineHeight: 1.3,
              }}>
                {step.desc}
              </div>

              {/* Detail */}
              <div style={{
                marginTop: '4px',
                fontSize: '9px',
                color: 'var(--color-muted)',
                textAlign: 'center',
                maxWidth: '80px',
                lineHeight: 1.3,
              }}>
                {step.detail}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}