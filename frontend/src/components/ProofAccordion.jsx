/**
 * ProofAccordion — expandable ZKP proof technical details (dark theme).
 * Per DF1 deferred decision: 8-byte grouping, uppercase hex, NO ASCII sidebar.
 * Copy button with "Copied!" feedback.
 */
import { useState } from 'react'

function formatHex(hexString) {
  if (!hexString) return ''
  // Uppercase, grouped in 8-byte (16 character) chunks
  const clean = hexString.toUpperCase().replace(/[^A-F0-9]/g, '')
  const groups = []
  for (let i = 0; i < clean.length; i += 16) {
    groups.push(clean.slice(i, i + 16))
  }
  return groups.join(' ')
}

export default function ProofAccordion({ proofInfo }) {
  const [open, setOpen] = useState(false)
  const [copiedField, setCopiedField] = useState(null)

  const handleCopy = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch (err) {
      // clipboard not available
    }
  }

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: 'var(--space-3) var(--space-4)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--color-text)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontFamily: 'var(--font-sans)',
        }}
      >
        Proof Details
        <span style={{ fontSize: '12px', color: 'var(--color-muted)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: 'var(--space-4)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}>
            {proofInfo.c_value !== undefined && (
              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}>
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--color-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    c (challenge)
                  </div>
                  <button
                    onClick={() => handleCopy(proofInfo.c_value, 'c')}
                    style={{
                      background: 'var(--color-zkp-muted)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      borderRadius: 'var(--border-radius-sm)',
                      color: copiedField === 'c' ? 'var(--color-zkp)' : 'var(--color-muted)',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {copiedField === 'c' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{
                  color: 'var(--color-zkp)',
                  wordBreak: 'break-all',
                  lineHeight: 1.6,
                  background: 'rgba(16,185,129,0.06)',
                  padding: '8px',
                  borderRadius: 'var(--border-radius-sm)',
                }}>
                  {formatHex(proofInfo.c_value)}
                </div>
              </div>
            )}
            {proofInfo.m_value !== undefined && (
              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}>
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--color-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    m (response)
                  </div>
                  <button
                    onClick={() => handleCopy(proofInfo.m_value, 'm')}
                    style={{
                      background: 'var(--color-zkp-muted)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      borderRadius: 'var(--border-radius-sm)',
                      color: copiedField === 'm' ? 'var(--color-zkp)' : 'var(--color-muted)',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {copiedField === 'm' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{
                  color: 'var(--color-zkp)',
                  wordBreak: 'break-all',
                  lineHeight: 1.6,
                  background: 'rgba(16,185,129,0.06)',
                  padding: '8px',
                  borderRadius: 'var(--border-radius-sm)',
                }}>
                  {formatHex(proofInfo.m_value)}
                </div>
              </div>
            )}
            {proofInfo.proof_size !== undefined && (
              <div style={{
                color: 'var(--color-muted)',
                fontSize: '11px',
                borderTop: '1px solid var(--color-border)',
                paddingTop: 'var(--space-2)',
                marginTop: 'var(--space-1)',
              }}>
                Proof size: <span style={{ color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>{proofInfo.proof_size} bytes</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}