/**
 * ChatTrace — two-column wrapper: ActionLog (left) + MetricsPanel (right).
 * Renders side-by-side auth comparison with live metrics.
 */
import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import ActionLog from './ActionLog.jsx'
import MetricsPanel from './MetricsPanel.jsx'

export default function ChatTrace({ authType, credentials }) {
  const { latestResult } = useChatHistory()

  return (
    <div className="chat-trace-grid">
      <ActionLog
        key={authType}
        authType={authType}
        latestResult={latestResult}
        credentials={credentials}
      />
      <MetricsPanel />
    </div>
  )
}