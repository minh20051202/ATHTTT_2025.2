import { createContext, useContext, useState, useCallback } from 'react'

/**
 * Stores chat results keyed by auth type (oauth2 | zkp).
 * Tracking both independently enables live side-by-side comparison.
 * latestResult is the most recently stored result (regardless of type),
 * kept for backwards compat with components that only need any single result.
 */
const ChatHistoryContext = createContext(null)

export function ChatHistoryProvider({ children }) {
  const [resultsByAuth, setResultsByAuth] = useState({ oauth2: null, zkp: null })
  // Derived: most recent result (any type)
  const [latestResult, setLatestResult] = useState(null)

  const storeResult = useCallback((data) => {
    const authType = data?.auth_info?.type
    if (!authType) return
    const keyed = { ...data, timestamp: Date.now() }
    setResultsByAuth(prev => ({ ...prev, [authType]: keyed }))
    setLatestResult(keyed)
  }, [])

  return (
    <ChatHistoryContext.Provider value={{ latestResult, resultsByAuth, storeResult }}>
      {children}
    </ChatHistoryContext.Provider>
  )
}

export const useChatHistory = () => useContext(ChatHistoryContext)