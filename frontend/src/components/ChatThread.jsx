import { useRef, useEffect } from 'react'

/* ─── Thinking Indicator ─── */
function ThinkingIndicator({ authType }) {
  return (
    <div style={{
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '12px 16px', background: 'var(--color-surface)',
      border: '1px solid var(--color-border)', borderRadius: '12px',
      borderBottomLeftRadius: '4px', maxWidth: '320px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: authType === 'zkp' ? 'var(--color-zkp)' : 'var(--color-oauth2)',
          animation: 'thinking-pulse 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.18}s`,
        }} />
      ))}
      <style>{`
        @keyframes thinking-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

/* ─── User Bubble ─── */
function UserBubble({ content, authType }) {
  const bg = authType === 'zkp'
    ? 'rgba(4, 120, 87, 0.08)'
    : 'rgba(180, 83, 9, 0.08)'
  const borderColor = authType === 'zkp'
    ? 'rgba(16, 185, 129, 0.3)'
    : 'rgba(245, 158, 11, 0.3)'
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        maxWidth: '72%', padding: '12px 16px',
        background: bg, border: `1px solid ${borderColor}`,
        borderRadius: '12px', borderBottomRightRadius: '4px',
        fontSize: '14px', color: 'var(--color-text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  )
}

/* ─── Agent Bubble ─── */
function AgentBubble({ intent, execResult, authType }) {
  const badgeBg = authType === 'zkp'
    ? 'rgba(4, 120, 87, 0.08)'
    : 'rgba(180, 83, 9, 0.08)'
  const badgeColor = authType === 'zkp'
    ? 'var(--color-zkp)'
    : 'var(--color-oauth2)'
  const toolBadge = intent?.tool
    ? <span style={{
        display: 'inline-block', padding: '2px 8px',
        background: badgeBg, color: badgeColor,
        borderRadius: '4px', fontSize: '10px', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px',
      }}>{intent.tool}</span>
    : null
  const resultPreview = execResult
    ? JSON.stringify(execResult).slice(0, 240) + (JSON.stringify(execResult).length > 240 ? '…' : '')
    : null

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        maxWidth: '72%', padding: '12px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '12px', borderBottomLeftRadius: '4px',
        fontSize: '14px', color: 'var(--color-text)',
      }}>
        {toolBadge}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {resultPreview || <span style={{ color: 'var(--color-muted)' }}>Processing…</span>}
        </div>
      </div>
    </div>
  )
}

/* ─── Chat Input ─── */
function ChatInput({ message, setMessage, password, setPassword, onSend, sending, authType }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {authType === 'zkp' && (
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" style={{
            padding: '10px 14px', border: '1px solid var(--color-border)',
            borderRadius: '8px', fontSize: '14px', fontFamily: 'var(--font-mono)',
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
          rows={2} style={{
            flex: 1, padding: '12px 14px',
            border: '1px solid var(--color-border)', borderRadius: '8px',
            fontSize: '14px', fontFamily: 'var(--font-sans)',
            resize: 'none', background: 'var(--color-surface)',
            color: 'var(--color-text)', outline: 'none',
          }}
        />
        <button
          onClick={onSend} disabled={sending || !message.trim()}
          style={{
            height: '52px', padding: '0 20px',
            background: sending ? 'var(--color-muted)' : 'var(--color-primary)',
            color: 'white', border: 'none', borderRadius: '8px',
            fontWeight: 600, fontSize: '14px', cursor: sending ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s ease',
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/* ─── ChatThread ─── */
export default function ChatThread({ authType, messages, sending, onSend, message, setMessage, password, setPassword }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
            textAlign: 'center', color: 'var(--color-muted)', marginTop: '32px',
            fontSize: '14px', fontFamily: 'var(--font-mono)',
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
        />
      </div>
    </div>
  )
}