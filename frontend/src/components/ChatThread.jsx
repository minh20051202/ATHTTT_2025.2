import { useRef, useEffect, useState } from 'react'

/* ─── Thinking Indicator ─── */
function ThinkingIndicator({ authType }) {
  return (
    <div style={{
      display: 'flex', gap: '12px', alignItems: 'center',
      padding: '24px 30px', background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: '24px',
      borderBottomLeftRadius: '8px', maxWidth: '560px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '20px', height: '20px', borderRadius: '50%',
          background: authType === 'zkp' ? 'var(--color-zkp)' : 'var(--color-oauth2)',
          animation: 'thinking-pulse 1.2s ease-in-out infinite',
          animationDelay: (i * 0.18) + 's',
        }} />
      ))}
    </div>
  )
}

/* ─── User Bubble ─── */
function UserBubble({ content, authType }) {
  const isZkp = authType === 'zkp'
  const bg = isZkp ? 'rgba(4, 120, 87, 0.08)' : 'rgba(180, 83, 9, 0.08)'
  const borderColor = isZkp ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'
  const border = '1px solid ' + borderColor
  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-end',
      animation: 'bubble-enter-right 200ms var(--ease-out) both',
    }}>
      <div style={{
        maxWidth: '72%', padding: '20px 26px',
        background: bg, border: border,
        borderRadius: '24px', borderBottomRightRadius: '8px',
        fontSize: '26px', lineHeight: 1.5,
        color: 'var(--color-text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  )
}

/* ─── Agent Bubble ─── */
function AgentBubble({ intent, execResult, authType }) {
  const isZkp = authType === 'zkp'
  const badgeBg = isZkp ? 'rgba(4, 120, 87, 0.08)' : 'rgba(180, 83, 9, 0.08)'
  const badgeColor = isZkp ? 'var(--color-zkp)' : 'var(--color-oauth2)'
  const toolBadge = intent?.action
    ? <span style={{
        display: 'inline-block', padding: '5px 15px',
        background: badgeBg, color: badgeColor,
        borderRadius: '8px', fontSize: '18px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px',
      }}>{intent.action}</span>
    : null
  const resultPreview = execResult
    ? jsonPreview(execResult)
    : null

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', animation: 'bubble-enter-left 200ms var(--ease-out) both' }}>
      <div style={{
        maxWidth: '72%', padding: '20px 26px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '24px', borderBottomLeftRadius: '8px',
        fontSize: '26px', lineHeight: 1.5,
        color: 'var(--color-text)',
      }}>
        {toolBadge}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '22px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {resultPreview || <span style={{ color: 'var(--color-muted)' }}>Processing…</span>}
        </div>
      </div>
    </div>
  )
}

function jsonPreview(obj) {
  const s = JSON.stringify(obj, null, 2)
  const MAX = 2000
  if (s.length <= MAX) return s
  return s.slice(0, MAX) + '\n… (truncated, ' + (s.length - MAX) + ' more chars)'
}

/* ─── Chat Input ─── */
function ChatInput({ message, setMessage, onSend, sending, authType, disabled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
        <textarea
          value={message} onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Search products, compare prices…"
          rows={2} style={{
            flex: 1, padding: '12px 16px',
            border: '1px solid var(--color-border)', borderRadius: '12px',
            fontSize: '15px', fontFamily: 'var(--font-sans)',
            resize: 'none', background: 'var(--color-surface)',
            color: 'var(--color-text)', outline: 'none',
          }}
        />
        <button
          onClick={onSend} disabled={disabled || sending || !message.trim()}
          style={{
            height: '52px', padding: '0 24px',
            background: disabled || sending ? 'var(--color-muted)' : 'var(--color-primary)',
            color: 'white', border: 'none', borderRadius: '12px',
            fontWeight: 600, fontSize: '15px', cursor: disabled || sending ? 'not-allowed' : 'pointer',
            transition: 'background 120ms var(--ease-out)',
            opacity: disabled || sending ? 0.6 : 1,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/* ─── ChatThread ─── */
export default function ChatThread({ authType, messages, sending, onSend, message, setMessage, password, setPassword, disabled }) {
  const bottomRef = useRef(null)
  const [errorFlash, setErrorFlash] = useState(false)

  // Trigger border flash when an error appears in messages
  useEffect(() => {
    const hasError = messages.some(msg => msg.error)
    if (hasError) {
      setErrorFlash(true)
      const t = setTimeout(() => setErrorFlash(false), 500)
      return () => clearTimeout(t)
    }
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  return (
    <>
      <style>{`
        @keyframes error-flash {
          0%   { outline-color: var(--color-attack); }
          50%  { outline-color: transparent; }
          100% { outline-color: transparent; }
        }
      `}</style>
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - var(--navbar-height) - 120px)',
    }}>
      {/* Message Area */}
      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px',
        paddingBottom: '16px',
        borderRadius: '12px',
        outline: errorFlash ? '2px solid var(--color-attack)' : 'none',
        outlineOffset: '2px',
        transition: 'outline 80ms ease-out',
        animation: errorFlash ? 'error-flash 500ms ease-out' : 'none',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: 'var(--color-muted)', marginTop: '72px',
            fontSize: '24px', fontFamily: 'var(--font-mono)',
          }}>
            Ask a question to get started
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'agent') {
            if (msg.thinking) return <ThinkingIndicator key={msg.id} authType={authType} />
            return <AgentBubble key={msg.id} intent={msg.intent} execResult={msg.result} authType={authType} />
          }
          if (msg.role === 'user') return <UserBubble key={msg.id} content={msg.content} authType={authType} />
          return null
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: '24px', paddingBottom: '6px',
      }}>
        <ChatInput
          message={message} setMessage={setMessage}
          onSend={onSend} sending={sending} authType={authType}
          disabled={disabled}
        />
      </div>
    </div>
    </>
  )
}