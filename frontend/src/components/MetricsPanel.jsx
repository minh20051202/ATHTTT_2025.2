/**
 * MetricsPanel — live side-by-side metrics for OAuth2 vs ZKP.
 * Always renders (no guard), showing placeholder bars when data is absent.
 * Derived from resultsByAuth in ChatHistoryContext.
 */
import { useChatHistory } from '../context/ChatHistoryContext.jsx'
import { MetricRow } from './shared/MetricChart.jsx'

export default function MetricsPanel() {
  const { resultsByAuth } = useChatHistory()

  const oauth2 = resultsByAuth?.oauth2
  const zkp = resultsByAuth?.zkp
  const oauth2Auth = oauth2?.auth_info
  const zkpAuth = zkp?.auth_info

  // Verification time (seconds → ms)
  const oauth2Verify = (oauth2Auth?.verification_time ?? 0) * 1000
  const zkpVerify = (zkpAuth?.verification_time ?? 0) * 1000

  // Total timing (seconds → ms)
  const oauth2Total = (oauth2?.timing?.total ?? 0) * 1000
  const zkpTotal = (zkp?.timing?.total ?? 0) * 1000

  // Payload sizes (bytes)
  const oauth2Payload = oauth2Auth?.token_size ?? 0
  const zkpPayload = zkpAuth?.proof_info?.proof_size ?? 0

  // Max values across both auth types (for bar normalization)
  const VERIFY_MAX = Math.max(oauth2Verify, zkpVerify, 0.001)
  const TOTAL_MAX = Math.max(oauth2Total, zkpTotal, 0.001)
  const PAYLOAD_MAX = Math.max(oauth2Payload, zkpPayload, 1)

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--border-radius-lg)',
      padding: 'var(--space-4)',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-4)' }}>
        <span style={{
          fontWeight: 700,
          fontSize: '13px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-text)',
        }}>
          Live Metrics
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <MetricRow
          label="Verify"
          oauth2Val={oauth2Verify}
          zkpVal={zkpVerify}
          oauth2Max={VERIFY_MAX}
          zkpMax={VERIFY_MAX}
          unit="ms"
          showWinner={true}
        />
        <MetricRow
          label="Total"
          oauth2Val={oauth2Total}
          zkpVal={zkpTotal}
          oauth2Max={TOTAL_MAX}
          zkpMax={TOTAL_MAX}
          unit="ms"
          showWinner={false}
        />
        <MetricRow
          label="Payload"
          oauth2Val={oauth2Payload}
          zkpVal={zkpPayload}
          oauth2Max={PAYLOAD_MAX}
          zkpMax={PAYLOAD_MAX}
          unit="B"
          showWinner={true}
        />
      </div>
    </div>
  )
}