import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import { MetricRow, MetricHeader } from './shared/MetricChart.jsx'

export default function MetricsPanel() {
  const { resultsByAuth } = useChatHistory()

  const oauth2 = resultsByAuth?.oauth2
  const zkp = resultsByAuth?.zkp
  const oauth2Auth = oauth2?.auth_info
  const zkpAuth = zkp?.auth_info

  const oauth2Verify = (oauth2Auth?.verification_time ?? 0) * 1000
  const zkpVerify = (zkpAuth?.verification_time ?? 0) * 1000

  const oauth2Client = (oauth2Auth?.client_computation_time ?? 0) * 1000
  const zkpClient = (zkpAuth?.client_computation_time ?? 0) * 1000

  const oauth2Total = oauth2Client + oauth2Verify
  const zkpTotal = zkpClient + zkpVerify

  const oauth2Payload = oauth2Auth?.token_size ?? 0
  const zkpPayload = zkpAuth?.proof_info?.proof_size ?? 0

  const ALL_MAX_T = Math.max(oauth2Total, zkpTotal, 1)
  const ALL_MAX_P = Math.max(oauth2Payload, zkpPayload, 1)
  const ALL_MAX_V = Math.max(oauth2Verify, zkpVerify, 1)
  const ALL_MAX_C = Math.max(oauth2Client, zkpClient, 1)

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <span className="panel-title">Efficiency Metrics</span>
      </div>
      <div className="panel-content">
        <MetricHeader />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <MetricRow
            label="Client Compute"
            oauth2Val={oauth2Client}
            zkpVal={zkpClient}
            oauth2Max={ALL_MAX_C}
            zkpMax={ALL_MAX_C}
            unit="ms"
          />
          <MetricRow
            label="Verification"
            oauth2Val={oauth2Verify}
            zkpVal={zkpVerify}
            oauth2Max={ALL_MAX_V}
            zkpMax={ALL_MAX_V}
            unit="ms"
          />
          <MetricRow
            label="Payload"
            oauth2Val={oauth2Payload}
            zkpVal={zkpPayload}
            oauth2Max={ALL_MAX_P}
            zkpMax={ALL_MAX_P}
            unit="B"
          />
          <MetricRow
            label="Auth Latency"
            oauth2Val={oauth2Total}
            zkpVal={zkpTotal}
            oauth2Max={ALL_MAX_T}
            zkpMax={ALL_MAX_T}
            unit="ms"
          />
        </div>
      </div>
    </div>
  )
}
