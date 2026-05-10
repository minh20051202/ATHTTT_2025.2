import ActionLog from './ActionLog.jsx'
import MetricsPanel from './MetricsPanel.jsx'

export default function ComputationSidebar({ authType, latestResult, messageCount }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - var(--navbar-height) - 120px)',
      gap: '16px', overflow: 'hidden',
    }}>
      <div style={{ flex: '0 0 60%', minHeight: 0, overflow: 'hidden' }}>
        <ActionLog
          authType={authType}
          latestResult={latestResult}
          messageCount={messageCount}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MetricsPanel />
      </div>
    </div>
  )
}