import { useRef, useEffect } from 'react'

/* ─── Thinking Indicator ─── */
function ThinkingIndicator({ authType }) {
  return (
    <div style={{
      display: 'flex', gap: '8px', alignItems: 'center',
      padding: '16px 20px', background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: '16px',
      borderBottomLeftRadius: '6px', maxWidth: '380px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '14px', height: '14px', borderRadius: '50%',
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
        maxWidth: '72%', padding: '16px 20px',
        background: bg, border: border,
        borderRadius: '16px', borderBottomRightRadius: '6px',
        fontSize: '17px', lineHeight: 1.5,
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
  const toolBadge = intent?.tool
    ? <span style={{
        display: 'inline-block', padding: '3px 10px',
        background: badgeBg, color: badgeColor,
        borderRadius: '6px', fontSize: '12px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
      }}>{intent.tool}</span>
    : null
  const resultPreview = execResult
    ? jsonPreview(execResult)
    : null

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', animation: 'bubble-enter-left 200ms var(--ease-out) both' }}>
      <div style={{
        maxWidth: '72%', padding: '16px 20px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px', borderBottomLeftRadius: '6px',
        fontSize: '17px', lineHeight: 1.5,
        color: 'var(--color-text)',
      }}>
        {toolBadge}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {resultPreview || <span style={{ color: 'var(--color-muted)' }}>Processing…</span>}
        </div>
      </div>
    </div>
  )
}

function jsonPreview(obj) {
  const s = JSON.stringify(obj)
  return s.slice(0, 240) + (s.length > 240 ? '…' : '')
}

/* ─── Chat Input ─── */
function ChatInput({ message, setMessage, password, setPassword, onSend, sending, authType, disabled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {authType === 'zkp' && (
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" style={{
            padding: '14px 16px', border: '1px solid var(--color-border)',
            borderRadius: '8px', fontSize: '16px', fontFamily: 'var(--font-mono)',
            background: 'var(--color-surface)', color: 'var(--color-text)',
            outline: 'none',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
        <textarea
          value={message} onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Search products, compare prices…"
          rows={3} style={{
            flex: 1, padding: '14px 16px',
            border: '1px solid var(--color-border)', borderRadius: '8px',
            fontSize: '16px', fontFamily: 'var(--font-sans)',
            resize: 'none', background: 'var(--color-surface)',
            color: 'var(--color-text)', outline: 'none',
          }}
        />
        <button
          onClick={onSend} disabled={disabled || sending || !message.trim()}
          style={{
            height: '58px', padding: '0 24px',
            background: disabled || sending ? 'var(--color-muted)' : 'var(--color-primary)',
            color: 'white', border: 'none', borderRadius: '8px',
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

  useEffect(() => {
    bottomRef.current && bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - var(--navbar-height) - 120px)',
    }}>
      {/* Message Area */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '16px' }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: 'var(--color-muted)', marginTop: '48px',
            fontSize: '16px', fontFamily: 'var(--font-mono)',
          }}>
            Ask a question to get started
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') return <UserBubble key={msg.id} content={msg.content} authType={authType} />
          if (msg.role === 'agent') {
            if (msg.thinking) return <ThinkingIndicator key={msg.id} authType={authType} />
            return <AgentBubble key={msg.id} intent={msg.intent} execResult={msg.result} authType={authType} />
          }
          return null
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: '16px', paddingBottom: '4px',
      }}>
        <ChatInput
          message={message} setMessage={setMessage}
          password={password} setPassword={setPassword}
          onSend={onSend} sending={sending} authType={authType}
          disabled={disabled}
        />
      </div>
    </div>
  )
}