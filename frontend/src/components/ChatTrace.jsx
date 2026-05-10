import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import ActionLog from './ActionLog.jsx'
import MetricsPanel from './MetricsPanel.jsx'

export default function ChatTrace({ authType, latestResult, messageCount }) {
  const { latestResult: fromContext } = useChatHistory()
  const result = latestResult !== undefined ? latestResult : fromContext
  return (
    <div className="chat-trace-grid">
      <ActionLog
        authType={authType}
        latestResult={result}
        messageCount={messageCount ?? 0}
      />
      <MetricsPanel />
    </div>
  )
}