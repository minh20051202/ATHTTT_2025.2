import { useState, useCallback } from "react";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { attackApi } from "../services/attackApi.js";

const ATTACK_TYPES = [
  { key: "replay",       label: "Token Replay",         auth: "oauth2", desc: "Reuse a captured bearer token" },
  { key: "alg-confuse",  label: "Algorithm Confusion",  auth: "oauth2", desc: "Flip RS256→HS256, forge with server's public key" },
  { key: "nonce-reuse",  label: "Nonce Reuse",          auth: "zkp",    desc: "Two proofs same r → extract private key" },
  { key: "proof-replay", label: "Challenge Replay",     auth: "zkp",    desc: "Replay a proof with the same challenge token" },
]

function AttackPanel() {
  const { latestResult } = useChatHistory()

  const [attackType, setAttackType]     = useState("replay")
  const [attackPhase, setAttackPhase]   = useState("idle")
  const [attackSteps, setAttackSteps]   = useState([])
  const [attackResult, setAttackResult] = useState(null)

  const authInfo = latestResult?.auth_info
  const authType = authInfo?.type || "oauth2"
  const token = authInfo?.type === "oauth2"
    ? authInfo.token
    : authInfo?.type === "zkp"
      ? authInfo.proof
      : null
  const hasToken = !!token

  const resetPanels = useCallback(() => {
    setAttackPhase("idle")
    setAttackSteps([])
    setAttackResult(null)
  }, [])

  const executeAttack = useCallback(async () => {
    if (!hasToken) return

    setAttackPhase("scanning")
    setAttackResult(null)
    setAttackSteps([])
    setAttackSteps([{
      label: "Scanning network traffic",
      detail: "Intercepting token...",
      success: true,
    }])

    await new Promise(r => setTimeout(r, 500))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, {
      label: "Launching exploit",
      detail: `${ATTACK_TYPES.find(a => a.key === attackType)?.label} on ${authType}`,
      success: true,
    }])

    await new Promise(r => setTimeout(r, 500))

    try {
      const apiFn = {
        "replay":       attackApi.replay,
        "alg-confuse":  attackApi.algorithmConfusion,
        "nonce-reuse":  attackApi.nonceReuse,
        "proof-replay": attackApi.replay,
      }[attackType]

      const type = ATTACK_TYPES.find(a => a.key === attackType)?.auth || authType
      const result = await apiFn(type, token)
      const data = result.data

      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 400))
      setAttackSteps(prev => [...prev, {
        label: data.success ? "DATA EXPOSED" : "Attack blocked",
        detail: data.message,
        success: data.success,
        expandable: !data.success,
        payload: data.details,
      }])
      setAttackResult(data)
      setAttackPhase("done")
    } catch (err) {
      setAttackSteps(prev => [...prev, {
        label: "Attack error",
        detail: err.message,
        success: null,
      }])
      setAttackPhase("done")
    }
  }, [attackType, authType, token, hasToken])

  const handleExecute = () => {
    resetPanels()
    executeAttack()
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - var(--navbar-height) - 120px)",
        gap: "var(--space-3)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--border-radius-lg)",
          overflow: "auto",
          flex: 1,
          padding: "0 var(--space-4) var(--space-4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
            padding: "var(--space-3) 0",
            marginBottom: "var(--space-3)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: "20px",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--color-attack)",
              marginBottom: "var(--space-2)",
            }}
          >
            Attack Simulation
          </div>
        </div>

        {/* Attack type selector */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
            flexWrap: "wrap",
          }}
        >
          {ATTACK_TYPES.map(({ key, label, auth }) => (
            <button
              key={key}
              onClick={() => {
                setAttackType(key)
              }}
              style={{
                flex: "1 1 180px",
                padding: "8px 12px",
                border:
                  attackType === key
                    ? "2px solid var(--color-attack)"
                    : "1px solid var(--color-border)",
                borderRadius: "var(--border-radius-md)",
                background:
                  attackType === key
                    ? "var(--color-attack-muted)"
                    : "var(--color-surface)",
                cursor: "pointer",
                textAlign: "left",
                transition:
                  "background 120ms var(--ease-out), border-color 120ms var(--ease-out)",
              }}
            >
              <div
                style={{
                  fontSize: "17px",
                  fontWeight: 700,
                  color:
                    attackType === key
                      ? "var(--color-attack)"
                      : "var(--color-text)",
                  marginBottom: "2px",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: "15px",
                  color: "var(--color-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {auth === "oauth2" ? "OAuth2" : "ZKP"}
              </div>
              <div
                style={{
                  fontSize: "14px",
                  color: "var(--color-muted)",
                  marginTop: "2px",
                }}
              >
                {ATTACK_TYPES.find(a => a.key === key)?.desc}
              </div>
            </button>
          ))}
        </div>

        {/* Token preview */}
        {!hasToken ? (
          <div
            style={{
              padding: "var(--space-4)",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--border-radius-md)",
              textAlign: "center",
              color: "var(--color-muted)",
              fontSize: "18px",
              marginBottom: "var(--space-3)",
            }}
          >
            Send a message in Chat to load a token for simulation.
          </div>
        ) : (
          <div
            style={{
              fontSize: "17px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-muted)",
              marginBottom: "var(--space-3)",
              wordBreak: "break-all",
            }}
          >
            Token: {token.slice(0, 24)}...
          </div>
        )}

        {/* Auth type badge */}
        {hasToken && (
          <div
            style={{
              display: "inline-block",
              padding: "4px 12px",
              borderRadius: "6px",
              border: `1px solid ${authType === "oauth2" ? "var(--color-oauth2)" : "var(--color-zkp)"}`,
              background: authType === "oauth2" ? "var(--color-oauth2-muted)" : "var(--color-zkp-muted)",
              color: authType === "oauth2" ? "var(--color-oauth2)" : "var(--color-zkp)",
              fontSize: "18px",
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "var(--space-3)",
            }}
          >
            {authType === "oauth2" ? "OAuth2" : "ZKP"} Token
          </div>
        )}

        {/* Step log */}
        {attackSteps.length > 0 && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--border-radius-md)",
              marginBottom: "var(--space-3)",
              overflow: "hidden",
            }}
          >
            {attackSteps.map((step, i) => (
              <div
                key={i}
                style={{
                  borderBottom: i < attackSteps.length - 1 ? "1px solid var(--color-border)" : "none",
                  padding: "12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background:
                        step.success === true
                          ? "var(--color-zkp)"
                          : step.success === false
                            ? "var(--color-attack)"
                            : step.success === null
                              ? "var(--color-muted)"
                              : "var(--color-muted)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "18px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      color:
                        step.success === false
                          ? "var(--color-attack)"
                          : step.success === null
                            ? "var(--color-muted)"
                            : "var(--color-text)",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-muted)",
                    marginLeft: "16px",
                  }}
                >
                  {step.detail}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Execute / Reset */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginBottom: attackPhase === "done" && attackResult ? "var(--space-3)" : 0,
          }}
        >
          <button
            onClick={handleExecute}
            disabled={!hasToken || attackPhase !== "idle"}
            style={{
              flex: 1,
              padding: "10px 16px",
              background:
                !hasToken || attackPhase !== "idle"
                  ? "var(--color-muted)"
                  : "var(--color-attack)",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: 700,
              fontSize: "20px",
              cursor:
                !hasToken || attackPhase !== "idle" ? "not-allowed" : "pointer",
              opacity: !hasToken || attackPhase !== "idle" ? 0.6 : 1,
            }}
          >
            Execute
          </button>
          {attackPhase === "done" && (
            <button
              onClick={resetPanels}
              style={{
                padding: "10px 16px",
                background: "transparent",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "18px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Forensics card */}
        {attackPhase === "done" && attackResult && (
          <div
            style={{
              marginTop: "16px",
              padding: "20px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "12px",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: "20px",
                marginBottom: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Security Analysis
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  background: attackResult.success
                    ? "rgba(220,38,38,0.06)"
                    : "rgba(16,185,129,0.06)",
                  border: "1px solid " +
                    (attackResult.success
                      ? "rgba(220,38,38,0.2)"
                      : "rgba(16,185,129,0.2)"),
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "20px",
                    marginBottom: "8px",
                    color: attackResult.success
                      ? "var(--color-attack)"
                      : "var(--color-zkp)",
                  }}
                >
                  {attackResult.success ? "VULNERABLE" : "PROTECTED"}
                </div>
                <div
                  style={{
                    fontSize: "17px",
                    color: "var(--color-text)",
                    marginBottom: "6px",
                  }}
                >
                  {attackResult.details?.vulnerability || attackResult.message}
                </div>
                {attackResult.details?.countermeasure && (
                  <div
                    style={{
                      fontSize: "15px",
                      color: "var(--color-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Countermeasure: {attackResult.details.countermeasure}
                  </div>
                )}
                {attackResult.details?.countermeasure_in_place && (
                  <div
                    style={{
                      fontSize: "15px",
                      color: "var(--color-zkp)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {attackResult.details.countermeasure_in_place}
                  </div>
                )}
                {attackResult.details?.severity && (
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "15px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-attack)",
                    }}
                  >
                    Severity: {attackResult.details.severity}
                  </div>
                )}
                {attackResult.details?.math && (
                  <pre
                    style={{
                      margin: "8px 0 0",
                      padding: "12px",
                      background: "var(--color-surface)",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-attack)",
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(attackResult.details.math, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AttackPanel