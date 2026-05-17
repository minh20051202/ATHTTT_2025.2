import { createContext, useContext, useEffect, useState } from 'react'
import { demoApi } from '../services/demoApi.js'

const AgentsContext = createContext(null)

export function AgentsProvider({ children }) {
  const [agents, setAgents] = useState(null) // { oauth2AgentId, zkpAgentId }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 3

    async function fetchAgents() {
      // Restore from sessionStorage first (faster, no network on refresh)
      const stored = sessionStorage.getItem('demo_agents')
      if (stored) {
        try {
          const storedAgents = JSON.parse(stored)
          if (storedAgents?.oauth2AgentId && storedAgents?.zkpAgentId && storedAgents?.serverAgentId) {
            setAgents(storedAgents)
            setLoading(false)
            return
          }
          sessionStorage.removeItem('demo_agents')
        } catch {
          sessionStorage.removeItem('demo_agents') // corrupt storage, re-fetch
        }
      }

      while (attempts < maxAttempts) {
        try {
          const res = await demoApi.seed()
          const { oauth2_agent, zkp_agent, server_agent } = res.data
          const agentPair = {
            oauth2AgentId: oauth2_agent.id,
            zkpAgentId: zkp_agent.id,
            serverAgentId: server_agent?.id,
          }
          sessionStorage.setItem('demo_agents', JSON.stringify(agentPair))
          setAgents(agentPair)
          setLoading(false)
          return
        } catch (err) {
          attempts++
          if (attempts >= maxAttempts) {
            setError(err.message)
            setLoading(false)
          } else {
            await new Promise(r => setTimeout(r, 500)) // retry after 500ms
          }
        }
      }
    }

    fetchAgents()
  }, [])

  return (
    <AgentsContext.Provider value={{ agents, loading, error }}>
      {children}
    </AgentsContext.Provider>
  )
}

export const useAgents = () => useContext(AgentsContext)
