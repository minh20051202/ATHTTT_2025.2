/**
 * AuthInfoPanel — conditional OAuth2 vs ZKP auth display (dark theme).
 * oauth2: shows JWT token + token_info.header/.payload/.signature preview
 * zkp: shows proof + plain-English summary
 */
import { useState } from 'react'

function OAuth2Details({ info }) {
  const { token, token_info } = info
  const short = token ? `${token.slice(0, 20)}...` : '—'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <span className="badge badge-oauth2">TOKEN-BASED — REPLAY VULNERABLE</span>
      </div>
      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--border-radius-sm)',
        padding: 'var(--space-3)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-all',
        border: '1px solid var(--color-border)',
      }}>
        <div style={{ marginBottom: 'var(--space-1)' }}>
          <span style={{ color: 'var(--color-muted)' }}>Token: </span>
          {short}
        </div>
        {token_info && (
          <>
            {token_info.header && (
              <div style={{ marginBottom: 'var(--space-1)' }}>
                <span style={{ color: 'var(--color-muted)' }}>Header: </span>
                {JSON.stringify(token_info.header)}
              </div>
            )}
            {token_info.payload && (
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Payload: </span>
                {Object.keys(token_info.payload).join(', ')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ZKPDetails({ info }) {
  const { proof_info } = info

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <span className="badge badge-zkp">PROOF-BASED — REPLAY PROTECTED</span>
      </div>

      {/* Plain-English summary */}
      {proof_info?.verification_time && (
        <div style={{
          background: 'var(--color-zkp-muted)',
          border: '1px solid rgba(16,185,129,0.2)',
          borderRadius: 'var(--border-radius-sm)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          fontSize: '13px',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-sans)',
        }}>
          This proof took <strong style={{ color: 'var(--color-zkp)', fontFamily: 'var(--font-mono)' }}>
            {Math.round(proof_info.verification_time * 1000)}ms
          </strong> to verify. Server uses only public key —{' '}
          <strong>never sees the original password</strong>.
        </div>
      )}

      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--border-radius-sm)',
        padding: 'var(--space-3)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-all',
        border: '1px solid var(--color-border)',
      }}>
        {proof_info?.proof_size && (
          <div style={{ marginBottom: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-muted)' }}>Size: </span>
            {proof_info.proof_size} bytes
          </div>
        )}
        {proof_info?.c_value && (
          <div style={{ marginBottom: 'var(--space-1)' }}>
            <span style={{ color: 'var(--color-muted)' }}>c: </span>
            {proof_info.c_value.slice(0, 16)}...
          </div>
        )}
        {proof_info?.m_value && (
          <div>
            <span style={{ color: 'var(--color-muted)' }}>m: </span>
            {proof_info.m_value.slice(0, 16)}...
          </div>
        )}
      </div>
    </div>
  )
}

export default function AuthInfoPanel({ authInfo }) {
  if (!authInfo) return null

  const isZKP = authInfo.type === 'zkp'
  const borderColor = isZKP ? 'var(--color-zkp)' : 'var(--color-oauth2)'

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: '8px',
    }}>
      <div style={{
        fontWeight: 600,
        fontSize: '13px',
        marginBottom: 'var(--space-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-muted)',
      }}>
        Authentication
      </div>
      {authInfo.type === 'oauth2' ? (
        <OAuth2Details info={authInfo} />
      ) : authInfo.type === 'zkp' ? (
        <ZKPDetails info={authInfo} />
      ) : null}
    </div>
  )
}