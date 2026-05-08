import { useState, useCallback } from 'react'
import { chatApi } from '../services/chatApi.js'
import { useChatHistory } from '../context/ChatHistoryContext.jsx'

export function useChat() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { storeResult, latestResult, clearResult } = useChatHistory()

  const sendMessage = useCallback(async ({ message, agentId, password }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await chatApi.intent({ message, agent_id: agentId, password })
      storeResult(res.data)
      setLoading(false)
      return res.data
    } catch (err) {
      setError(err.message)
      setLoading(false)
      throw err
    }
  }, [storeResult])

  const resetResults = useCallback(() => {
    clearResult()
    setError(null)
  }, [clearResult])

  return { sendMessage, loading, error, latestResult, resetResults }
}