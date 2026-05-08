/**
 * TimingBreakdown — animated horizontal bar chart (dark theme).
 * 3 stages: Intent extraction (cyan), Authentication (amber/emerald), Execution (green).
 * Bars animate on mount with cubic-bezier easing.
 */
import { useState, useEffect } from 'react'

export default function TimingBreakdown({ timing, authType = 'oauth2' }) {
  const [animated, setAnimated] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Trigger animation after mount
  useEffect(() => {
    setMounted(true)
    // Small delay to ensure the transition is visible
    const timer = setTimeout(() => setAnimated(true), 50)
    return () => clearTimeout(timer)
  }, [])

  if (!timing) return null

  const total = timing.total || 1
  const authColor = authType === 'zkp' ? 'var(--color-zkp)' : 'var(--color-oauth2)'

  const stages = [
    { key: 'intent_extraction', label: 'Intent extraction', color: 'var(--color-primary)' },
    { key: 'authentication', label: 'Authentication', color: authColor },
    { key: 'execution', label: 'Execution', color: '#22C55E' },
  ]

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
    }}>
      <div style={{
        fontWeight: 600,
        fontSize: '13px',
        marginBottom: 'var(--space-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-text-muted)',
      }}>
        Timing
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {stages.map(({ key, label, color }) => {
          const ms = (timing[key] || 0) * 1000
          const pct = Math.min(((timing[key] || 0) / total) * 100, 100)
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-text)' }}>{label}</span>
                <span style={{
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text)',
                }}>
                  {ms.toFixed(1)}ms
                </span>
              </div>
              <div style={{
                height: '6px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: animated ? `${pct}%` : '0%',
                  background: color,
                  borderRadius: '3px',
                  transition: animated
                    ? 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
                    : 'none',
                }} />
              </div>
            </div>
          )
        })}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: 'var(--space-2)',
          marginTop: 'var(--space-1)',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>Total</span>
          <span style={{
            fontSize: '13px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'var(--color-primary)',
          }}>
            {(total * 1000).toFixed(1)}ms
          </span>
        </div>
      </div>
    </div>
  )
}