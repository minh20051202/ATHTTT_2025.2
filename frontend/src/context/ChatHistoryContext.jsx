import { createContext, useContext, useState, useCallback } from 'react'

/**
 * Stores the LATEST chat result only (not full history).
 * ZKP proofs are large base64 strings — storing only latest avoids
 * unbounded memory growth after many messages.
 */
const ChatHistoryContext = createContext(null)

export function ChatHistoryProvider({ children }) {
  const [latestResult, setLatestResult] = useState(null)
  // { intent, result, timing, authInfo, timestamp }

  const storeResult = useCallback((data) => {
    setLatestResult({ ...data, timestamp: Date.now() })
  }, [])

  const clearResult = useCallback(() => {
    setLatestResult(null)
  }, [])

  return (
    <ChatHistoryContext.Provider value={{ latestResult, storeResult, clearResult }}>
      {children}
    </ChatHistoryContext.Provider>
  )
}

export const useChatHistory = () => useContext(ChatHistoryContext)