import ActionLog from './ActionLog.jsx'
import MetricsPanel from './MetricsPanel.jsx'

export default function ComputationSidebar({ authType, latestResult, messageCount, oauth2Credentials, zkpCredentials }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      gap: '16px', overflow: 'hidden',
    }}>
      <div style={{ flex: '0 0 60%', minHeight: 0, overflow: 'hidden' }}>
        <ActionLog
          authType={authType}
          latestResult={latestResult}
          messageCount={messageCount}
          oauth2Credentials={oauth2Credentials}
          zkpCredentials={zkpCredentials}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MetricsPanel />
      </div>
    </div>
  )
}