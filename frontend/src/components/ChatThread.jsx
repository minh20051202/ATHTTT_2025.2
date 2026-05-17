import { useRef, useEffect, useState } from 'react'

/* ─── Thinking Indicator ─── */
function ThinkingIndicator({ authType }) {
  const dotColor = authType === 'zkp' ? 'var(--color-zkp)' : 'var(--color-oauth2)'
  return (
    <div className="chat-bubble agent-bubble" style={{ maxWidth: 'min(720px, 92%)' }}>
      <div className="thinking-bubble">
        {[0, 1, 2].map(i => (
          <span key={i} className="thinking-dot" style={{
            background: dotColor,
            animationDelay: (i * 0.18) + 's',
          }} />
        ))}
      </div>
    </div>
  )
}

/* ─── User Bubble ─── */
function UserBubble({ content, authType }) {
  const isZkp = authType === 'zkp'
  const bg = isZkp ? 'var(--color-zkp-muted)' : 'var(--color-oauth2-muted)'
  const borderColor = isZkp ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'
  
  return (
    <div className="chat-bubble user-bubble" style={{ background: bg, border: `1px solid ${borderColor}` }}>
      {content}
    </div>
  )
}

/* ─── Agent Bubble ─── */
function AgentBubble({ intent, execResult, authType }) {
  const isZkp = authType === 'zkp'
  const badgeClass = isZkp ? 'badge-zkp' : 'badge-oauth2'
  
  const resultPreview = execResult
    ? jsonPreview(execResult)
    : null

  return (
    <div className="chat-bubble agent-bubble">
      {intent?.action && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <span className={`badge ${badgeClass}`}>{intent.action}</span>
        </div>
      )}
      <div className="font-mono" style={{ fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text)' }}>
        {resultPreview || <span style={{ color: 'var(--color-muted)' }}>Processing…</span>}
      </div>
    </div>
  )
}

function jsonPreview(obj) {
  const s = JSON.stringify(obj, null, 2)
  const MAX = 1000
  if (s.length <= MAX) return s
  return s.slice(0, MAX) + '\n… (truncated)'
}

/* ─── Chat Input ─── */
function ChatInput({ message, setMessage, onSend, sending, disabled }) {
  return (
    <div className="chat-input-wrapper">
      <textarea
        className="chat-input"
        value={message} 
        onChange={e => setMessage(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder="Search products, compare prices…"
        rows={1}
      />
      <button
        className="send-button"
        onClick={onSend} 
        disabled={disabled || sending || !message.trim()}
      >
        {sending ? '…' : 'Send'}
      </button>
    </div>
  )
}

/* ─── ChatThread ─── */
export default function ChatThread({ authType, messages, sending, onSend, message, setMessage, disabled }) {
  const bottomRef = useRef(null)
  const [errorFlash, setErrorFlash] = useState(false)

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
    <div className={`chat-container ${errorFlash ? 'error-flash' : ''}`}>
      <style>{`
        .error-flash {
          animation: border-flash-red 0.5s ease-out;
        }
        @keyframes border-flash-red {
          0% { box-shadow: inset 0 0 0 2px var(--color-attack); }
          100% { box-shadow: none; }
        }
      `}</style>
      
      <div className="chat-thread">
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: 'var(--color-muted)', marginTop: 'var(--space-12)',
            fontSize: '14px', fontStyle: 'italic'
          }}>
            Initialize agent session to begin…
          </div>
        )}
        {messages.map((msg, idx) => {
          if (msg.role === 'agent') {
            if (msg.thinking) {
              return (
                <ThinkingIndicator
                  key={msg.id}
                  authType={authType}
                />
              )
            }
            return (
              <AgentBubble
                key={msg.id}
                intent={msg.intent}
                execResult={msg.result}
                authType={authType}
              />
            )
          }
          if (msg.role === 'user') return <UserBubble key={msg.id} content={msg.content} authType={authType} />
          return null
        })}
        <div ref={bottomRef} />
      </div>

      <ChatInput
        message={message} 
        setMessage={setMessage}
        onSend={onSend} 
        sending={sending} 
        disabled={disabled}
      />
    </div>
  )
}
