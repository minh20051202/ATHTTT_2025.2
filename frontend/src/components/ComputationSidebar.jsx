import ActionLog from './ActionLog.jsx'
import MetricsPanel from './MetricsPanel.jsx'

export default function ComputationSidebar({
  authType,
  latestResult,
  messageCount,
  oauth2Credentials,
  zkpCredentials,
  liveReasoningSteps = [],
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      gap: '16px', overflow: 'hidden',
    }}>
      <div style={{ flex: '0 0 clamp(220px, 38%, 360px)', minHeight: 0, overflow: 'hidden' }}>
        <ActionLog
          authType={authType}
          latestResult={latestResult}
          messageCount={messageCount}
          oauth2Credentials={oauth2Credentials}
          zkpCredentials={zkpCredentials}
          liveReasoningSteps={liveReasoningSteps}
        />
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <MetricsPanel />
      </div>
    </div>
  )
}
