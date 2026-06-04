import { chatApi } from '../services/chatApi.js'
import { getAccessTokenWithTiming } from '../services/authApi.js'
import { signWithPrivateKeyHex } from '../lib/zkp.js'

function parseJson(data) {
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function normalizeErrorPayload(payload) {
  if (!payload || typeof payload === 'string') return payload || 'Delegation failed'
  return payload.detail?.message || payload.detail || payload.message || 'Delegation failed'
}

function readSseFrame(frame) {
  let event = 'message'
  const dataLines = []

  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') {
      event = value || 'message'
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  return { event, data: parseJson(dataLines.join('\n')) }
}

async function readSseStream(response, onEvent) {
  if (!response.body) {
    throw new Error('Delegation response did not include a stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  async function dispatchFrame(frame) {
    const trimmed = frame.trim()
    if (!trimmed) return

    const item = readSseFrame(trimmed)
    if (item.event === 'error') {
      throw new Error(normalizeErrorPayload(item.data))
    }
    await onEvent(item)
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      await dispatchFrame(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  await dispatchFrame(buffer)
}

export class UserAgent {
  constructor(config) {
    this.config = {
      agentId: config?.agentId,
      authType: config?.authType,
      privateKeyPem: config?.privateKeyPem,
      privateKey: config?.privateKey,
      targetServerAgentId: config?.targetServerAgentId,
    }
  }

  async delegate(task, { onEvent } = {}) {
    const startedAt = performance.now()
    const state = {
      intent: null,
      result: null,
      auth_info: null,
      client_auth_time: 0,
      timing: null,
      reasoning_steps: [],
      done: null,
    }

    const headers = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    }
    const body = {
      task,
      calling_agent_id: this.config.agentId,
      target_agent_id: this.config.targetServerAgentId,
    }

    if (!body.calling_agent_id) {
      throw new Error('Missing calling agent id')
    }
    if (!body.target_agent_id) {
      throw new Error('Missing target server agent id')
    }

    if (this.config.authType === 'oauth2') {
      const { token, clientComputationTime } = await getAccessTokenWithTiming(
        String(this.config.agentId),
        this.config.privateKeyPem,
      )
      state.client_auth_time = clientComputationTime
      headers.Authorization = `Bearer ${token}`
    } else if (this.config.authType === 'zkp') {
      const challengeRes = await chatApi.getZkpChallenge(this.config.agentId)
      const { zkp_token } = challengeRes.data
      body.zkp_token = zkp_token
      const proofStart = performance.now()
      body.zkp_proof = await signWithPrivateKeyHex(this.config.privateKey, zkp_token)
      state.client_auth_time = (performance.now() - proofStart) / 1000
    } else {
      throw new Error(`Unsupported auth type: ${this.config.authType || 'unknown'}`)
    }

    const response = await fetch('/api/agent/delegate', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(normalizeErrorPayload(parseJson(text)))
    }

    if (onEvent) {
      await onEvent({
        event: 'processing',
        data: { label: 'Processing request' },
        state: { ...state },
      })
    }

    await readSseStream(response, async ({ event, data }) => {
      if (event === 'auth') {
        state.auth_info = {
          ...data,
          client_computation_time: state.client_auth_time,
        }
      } else if (event === 'reasoning') {
        state.reasoning_steps = [...state.reasoning_steps, data]
      } else if (event === 'intent_result') {
        state.intent = data
      } else if (event === 'tool_result') {
        state.result = data
      } else if (event === 'done') {
        state.done = data
      }

      if (onEvent) {
        await onEvent({ event, data, state: { ...state } })
      }
    })

    state.timing = {
      total: (performance.now() - startedAt) / 1000,
      reasoning_steps: state.reasoning_steps,
    }

    return state
  }
}

export default UserAgent
