import { useState, useCallback, useEffect, useRef } from "react";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { attackApi } from "../services/attackApi.js";

const ATTACK_TYPES = [
  { key: "compare",      label: "Side-by-Side",     auth: "both",   desc: "Comprehensive attack simulation on both OAuth2 & ZKP" },
  { key: "replay",       label: "Token Replay",      auth: "both",   desc: "Reuse captured bearer token or ZKP proof" },
  { key: "credential-theft", label: "Credential Theft", auth: "both", desc: "Credentials stolen from AI agent conversation logs" },
  { key: "mitm",         label: "MITM Intercept",    auth: "both",   desc: "Intercept credentials in transit via TLS downgrade" },
  { key: "alg-confuse",  label: "Algorithm Confusion", auth: "oauth2", desc: "Flip RS256→HS256, forge with public key" },
  { key: "client-assertion-sub", label: "Assertion Substitution", auth: "oauth2", desc: "Forge assertions impersonating another agent" },
  { key: "nonce-reuse",  label: "Nonce Reuse",       auth: "zkp",    desc: "Two proofs same r → extract private key" },
  { key: "proof-correlation", label: "Proof Correlation", auth: "zkp", desc: "Traffic analysis reveals identity patterns" },
  { key: "challenge-predictability", label: "Challenge Predictability", auth: "zkp", desc: "Predict challenge to pre-compute proof" },
]

/* ─── Status LED pulsing pixel ─── */
function StatusLED({ status }) {
  const color = status === "vulnerable" ? "var(--terminal-accent)" : "var(--terminal-secure)";
  return (
    <div className="status-led" style={{
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: color,
      boxShadow: `0 0 6px ${color}`,
      display: "inline-block",
      marginRight: "10px",
      verticalAlign: "middle"
    }} />
  );
}

/* ─── Oscilloscope hex noise animation ─── */
function Oscilloscope() {
  const [chunks, setChunks] = useState([]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const hex = Array.from({ length: 4 }, () => 
        Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
      ).join(' ');
      const time = new Date().getTime().toString(16).slice(-4);
      setChunks(prev => [...prev.slice(-9), `${time}: ${hex}`]);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="oscilloscope" style={{ 
      fontFamily: "'IBM Plex Mono', monospace", 
      fontSize: "10px", 
      color: "var(--terminal-secure)",
      opacity: 0.4,
      padding: "12px",
      border: "1px solid rgba(52, 211, 153, 0.2)",
      background: "rgba(0,0,0,0.3)",
      height: "140px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      marginBottom: "16px"
    }}>
      <div style={{ fontSize: "9px", marginBottom: "8px", borderBottom: "1px solid rgba(52, 211, 153, 0.1)", paddingBottom: "4px" }}>
        [LIVE_INTERCEPT_STREAM]
      </div>
      {chunks.map((chunk, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {`> ${chunk}`}
        </div>
      ))}
    </div>
  );
}

/* ─── Forensic analysis readout ─── */
function ForensicsReadout({ result }) {
  if (!result) return null;

  const vulnerability = result.details?.vulnerability || result.message;
  const payload = result.details?.exposed_data || 
                 result.details?.leaked_metadata || 
                 result.details?.intercepted_data || 
                 result.details?.server_validation ||
                 result.details?.math;
  const mitigation = result.details?.countermeasure || result.details?.countermeasure_in_place;

  const status = result.success ? "vulnerable" : "protected";

  return (
    <div style={{ 
      border: "1px solid var(--terminal-border)",
      background: "rgba(255,255,255,0.01)",
      display: "flex",
      flexDirection: "column",
      fontSize: "11px",
      marginBottom: "12px"
    }}>
      <div style={{ 
        background: result.success ? "rgba(248,113,113,0.1)" : "rgba(52,211,153,0.1)",
        padding: "6px 10px",
        borderBottom: "1px solid var(--terminal-border)",
        fontWeight: "bold",
        display: "flex",
        justifyContent: "space-between",
        color: result.success ? "var(--terminal-accent)" : "var(--terminal-secure)",
        textTransform: "uppercase"
      }}>
        <span><StatusLED status={status} />Analysis Trace</span>
        <span>{result.success ? "● [VULNERABLE]" : "◆ [PROTECTED]"}</span>
      </div>

      <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <div style={{ color: "var(--terminal-muted)", marginBottom: "2px", fontWeight: "bold" }}>[VULNERABILITY]</div>
          <div style={{ color: "var(--terminal-text)" }}>{vulnerability}</div>
        </div>

        {payload && (
          <div>
            <div style={{ color: "var(--terminal-muted)", marginBottom: "2px", fontWeight: "bold" }}>[PAYLOAD]</div>
            <pre style={{ 
              margin: 0, 
              padding: "8px", 
              background: "rgba(0,0,0,0.5)", 
              border: "1px solid var(--terminal-border)",
              color: "var(--terminal-accent)",
              overflowX: "auto",
              fontSize: "10px",
              fontFamily: "'IBM Plex Mono', monospace"
            }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        {mitigation && (
          <div>
            <div style={{ color: "var(--terminal-muted)", marginBottom: "2px", fontWeight: "bold" }}>[MITIGATION]</div>
            <div style={{ color: "var(--terminal-secure)" }}>{mitigation}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Scrolling terminal execution log ─── */
function ExecutionLog({ steps }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps]);

  return (
    <div 
      className="execution-log" 
      ref={scrollRef}
      style={{
        height: "160px",
        overflowY: "auto",
        background: "var(--terminal-bg)",
        border: "1px solid var(--terminal-border)",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontFamily: "'IBM Plex Mono', monospace"
      }}
    >
      {steps.map((step, i) => (
        <div key={i} style={{ fontSize: "11px", display: "flex", gap: "8px" }}>
          <span style={{ color: step.success ? "var(--terminal-secure)" : step.success === false ? "var(--terminal-accent)" : "var(--terminal-muted)" }}>
            {">"}
          </span>
          <span style={{ color: "var(--terminal-text)", fontWeight: 700 }}>{step.label}</span>
          <span style={{ color: "var(--terminal-muted)" }}>:: {step.detail}</span>
        </div>
      ))}
      {steps.length > 0 && (
        <div style={{ color: "var(--terminal-muted)", fontSize: "11px" }}>_</div>
      )}
    </div>
  );
}

/* ─── Side-by-side OAuth2 vs ZKP comparison card ─── */
function CompareCard({ oauth2Results, zkpResults }) {
  // We'll show a summary status (vulnerable if any attack succeeds)
  const oauth2Vulnerable = oauth2Results && Object.values(oauth2Results).some(r => r.success)
  const zkpVulnerable    = zkpResults && Object.values(zkpResults).some(r => r.success)

  const oauth2Status = oauth2Vulnerable ? "vulnerable" : "protected";
  const zkpStatus    = zkpVulnerable ? "vulnerable" : "protected";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header summary badge row */}
      <div style={{ display: "flex", gap: "0", border: "1px solid var(--terminal-border)" }}>
        <div
          style={{
            flex: 1,
            padding: "10px 16px",
            borderRight: "1px solid var(--terminal-border)",
            background: oauth2Vulnerable ? "rgba(248,113,113,0.05)" : "rgba(52,211,153,0.05)",
          }}
        >
          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--terminal-muted)", marginBottom: "2px", textTransform: "uppercase" }}>
            [OAUTH2_CHANNEL]
          </div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: oauth2Vulnerable ? "var(--terminal-accent)" : "var(--terminal-secure)", display: "flex", alignItems: "center" }}>
            {oauth2Results ? (
              <>
                <StatusLED status={oauth2Status} />
                {oauth2Vulnerable ? "● VULNERABLE" : "◆ PROTECTED"}
              </>
            ) : "NOT TESTED"}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            padding: "10px 16px",
            background: zkpVulnerable ? "rgba(248,113,113,0.05)" : "rgba(52,211,153,0.05)",
          }}
        >
          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--terminal-muted)", marginBottom: "2px", textTransform: "uppercase" }}>
            [ZKP_CHANNEL]
          </div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: zkpVulnerable ? "var(--terminal-accent)" : "var(--terminal-secure)", display: "flex", alignItems: "center" }}>
            {zkpResults ? (
              <>
                <StatusLED status={zkpStatus} />
                {zkpVulnerable ? "● VULNERABLE" : "◆ PROTECTED"}
              </>
            ) : "NOT TESTED"}
          </div>
        </div>
      </div>

      {/* Comparison Detail List */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* OAuth2 column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {oauth2Results ? (
            Object.entries(oauth2Results).map(([key, result]) => (
              <div key={key}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--terminal-muted)", marginBottom: "4px", textTransform: "uppercase" }}>
                  {key.replace(/_/g, " ")}
                </div>
                <ForensicsReadout result={result} />
              </div>
            ))
          ) : (
            <div style={{ padding: "16px", borderRadius: "0px", border: "1px solid var(--terminal-border)", textAlign: "center", color: "var(--terminal-muted)", fontSize: "11px" }}>
              Awaiting OAuth2 data...
            </div>
          )}
        </div>

        {/* ZKP column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {zkpResults ? (
            Object.entries(zkpResults).map(([key, result]) => (
              <div key={key}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--terminal-muted)", marginBottom: "4px", textTransform: "uppercase" }}>
                  {key.replace(/_/g, " ")}
                </div>
                <ForensicsReadout result={result} />
              </div>
            ))
          ) : (
            <div style={{ padding: "16px", borderRadius: "0px", border: "1px solid var(--terminal-border)", textAlign: "center", color: "var(--terminal-muted)", fontSize: "11px" }}>
              Awaiting ZKP data...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Main AttackPanel ─── */
export default function AttackPanel() {
  const { latestResult, resultsByAuth } = useChatHistory()

  const [attackType, setAttackType]     = useState("compare")
  const [attackPhase, setAttackPhase]   = useState("idle")
  const [attackSteps, setAttackSteps]   = useState([])
  const [attackResult, setAttackResult] = useState(null)
  const [compareResult, setCompareResult] = useState(null)
  const [errorFlash, setErrorFlash] = useState(false)

  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 900 : false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const listboxRef = useRef(null)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 900
      setIsMobile(mobile)
      if (!mobile) setMobileMenuOpen(false)
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    if (!isMobile && listboxRef.current) {
      listboxRef.current.focus()
    }
  }, [isMobile])

  const authInfo = latestResult?.auth_info
  const authType = authInfo?.type || "oauth2"
  const token = authInfo?.type === "oauth2"
    ? authInfo.token
    : authInfo?.type === "zkp"
      ? authInfo.proof
      : null

  // Tokens from both auth types (for compare mode)
  const oauth2Token = resultsByAuth?.oauth2?.auth_info?.token
  const zkpToken    = resultsByAuth?.zkp?.auth_info?.proof
  const oauth2HasToken = !!oauth2Token
  const zkpHasToken    = !!zkpToken
  const hasEitherToken = oauth2HasToken || zkpHasToken
  const hasToken        = !!token  // current tab token (for single-mode attacks)

  const resetPanels = useCallback(() => {
    setAttackPhase("idle")
    setAttackSteps([])
    setAttackResult(null)
    setCompareResult(null)
  }, [])

  const executeSingleAttack = useCallback(async () => {
    if (!hasToken) return
    setAttackPhase("scanning")
    setAttackResult(null)
    setAttackSteps([])
    setAttackSteps([{ label: "Scanning network traffic", detail: "Intercepting token...", success: true }])
    await new Promise(r => setTimeout(r, 500))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, { label: "Launching exploit", detail: `${ATTACK_TYPES.find(a => a.key === attackType)?.label} on ${authType}`, success: true }])
    await new Promise(r => setTimeout(r, 500))

    try {
      const apiFn = {
        "replay":                   attackApi.replay,
        "credential-theft":         attackApi.credentialTheft,
        "mitm":                     attackApi.mitm,
        "alg-confuse":              attackApi.algorithmConfusion,
        "client-assertion-sub":    attackApi.clientAssertionSub,
        "nonce-reuse":              attackApi.nonceReuse,
        "proof-correlation":        attackApi.proofCorrelation,
        "challenge-predictability": attackApi.challengePredictability,
      }[attackType]
      const type = ATTACK_TYPES.find(a => a.key === attackType)?.auth || authType
      const targetAuthType = type === "both" ? authType : type
      const attackResp = await apiFn(targetAuthType, token)

      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 400))
      setAttackSteps(prev => [...prev, {
        label: attackResp.success ? "DATA EXPOSED" : "Attack blocked",
        detail: attackResp.message,
        success: attackResp.success,
        expandable: !attackResp.success,
        payload: attackResp.details,
      }])
      setAttackResult(attackResp)
      setAttackPhase("done")
    } catch (err) {
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 500)
      setAttackSteps(prev => [...prev, { label: "Attack error", detail: err.message, success: null }])
      setAttackPhase("done")
    }
  }, [attackType, authType, token, hasToken])

  const executeCompareAttack = useCallback(async () => {
    // Read tokens from current component scope — no stale closure
    const oauth2 = resultsByAuth?.oauth2?.auth_info?.token || null
    const zkp    = resultsByAuth?.zkp?.auth_info?.proof    || null
    if (!oauth2 && !zkp) return

    setAttackPhase("scanning")
    setCompareResult(null)
    setAttackSteps([])
    setAttackSteps([{ label: "Scanning both auth channels", detail: "Collecting OAuth2 + ZKP tokens...", success: true }])
    await new Promise(r => setTimeout(r, 400))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, {
      label: "Running comprehensive comparison",
      detail: `OAuth2 ${oauth2 ? "✓" : "✗"}  ZKP ${zkp ? "✓" : "✗"}`,
      success: true,
    }])
    await new Promise(r => setTimeout(r, 800))

    try {
      const resp = await attackApi.compare(oauth2, zkp)
      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 300))
      setCompareResult(resp.data)
      setAttackPhase("done")
    } catch (err) {
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 500)
      setAttackSteps(prev => [...prev, { label: "Attack error", detail: err.message, success: null }])
      setAttackPhase("done")
    }
  }, [resultsByAuth])

  const handleExecute = useCallback(() => {
    resetPanels()
    setMobileMenuOpen(false)
    if (attackType === "compare") {
      executeCompareAttack()
    } else {
      executeSingleAttack()
    }
  }, [attackType, executeSingleAttack, executeCompareAttack, resetPanels])

  const handleKeyDown = (e) => {
    if (attackPhase !== "idle" && attackPhase !== "done") return

    const currentIndex = ATTACK_TYPES.findIndex(a => a.key === attackType)
    let nextIndex = currentIndex

    if (e.key === "ArrowDown") {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % ATTACK_TYPES.length
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + ATTACK_TYPES.length) % ATTACK_TYPES.length
    } else if (e.key === "Enter") {
      e.preventDefault()
      handleExecute()
      return
    } else {
      return
    }

    setAttackType(ATTACK_TYPES[nextIndex].key)
    resetPanels()
  }

  const canExecute = attackType === "compare" ? hasEitherToken : hasToken

  return (
    <div className="attack-terminal-root">
      <style>{`
        .attack-terminal-root {
          --terminal-bg: #0a0a0b;
          --terminal-border: #1e1e22;
          --terminal-accent: #f87171;
          --terminal-secure: #34d399;
          --terminal-text: #e5e7eb;
          --terminal-muted: #4b5563;

          display: grid;
          grid-template-columns: 320px 1fr;
          height: calc(100vh - var(--navbar-height));
          background: var(--terminal-bg);
          color: var(--terminal-text);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          overflow: hidden;
          position: relative;
        }

        /* ─── Scanline Overlay ─── */
        .attack-terminal-root::after {
          content: " ";
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          right: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), 
                      linear-gradient(90deg, rgba(255, 0, 0, 0.01), rgba(0, 255, 0, 0.005), rgba(0, 0, 255, 0.01));
          z-index: 1000;
          background-size: 100% 4px, 3px 100%;
          pointer-events: none;
        }

        .mission-control {
          border-right: 1px solid var(--terminal-border);
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
          background: #0d0d0f;
        }

        .data-stream {
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          border: 1px solid transparent;
          transition: border-color 0.2s ease;
        }

        /* ─── ERROR Flash Animation ─── */
        @keyframes border-flash {
          0% { border-color: var(--terminal-accent); box-shadow: inset 0 0 20px rgba(248, 113, 113, 0.2); }
          100% { border-color: transparent; box-shadow: none; }
        }

        .error-flash {
          animation: border-flash 0.5s ease-out;
        }

        /* ─── LED Pulse Animation ─── */
        @keyframes led-pulse {
          0% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0.4; transform: scale(0.9); }
        }
        .status-led {
          animation: led-pulse 1.5s infinite ease-in-out;
        }

        @media (max-width: 899px) {
          .attack-terminal-root {
            grid-template-columns: 1fr;
            height: auto;
            overflow-y: auto;
          }
          .mission-control {
            border-right: none;
            border-bottom: 1px solid var(--terminal-border);
            position: sticky;
            top: 0;
            background: var(--terminal-bg);
            z-index: 100;
            padding: 12px 20px;
            gap: 12px;
          }
          .hide-on-mobile {
            display: none !important;
          }
        }

        .attack-listbox {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--terminal-border);
          background: rgba(0, 0, 0, 0.4);
          outline: none;
          transition: border-color 0.2s ease;
        }

        .attack-listbox:focus {
          border-color: rgba(248, 113, 113, 0.5);
        }

        .attack-item {
          padding: 10px 12px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: none;
          background: transparent;
          color: var(--terminal-text);
          font-family: inherit;
          font-size: 11px;
          text-align: left;
          transition: all 0.1s ease;
          border-bottom: 1px solid rgba(255,255,255,0.02);
        }

        .attack-item:last-child {
          border-bottom: none;
        }

        .attack-item:hover:not(.selected) {
          background: rgba(255, 255, 255, 0.03);
        }

        .attack-item.selected {
          background: var(--terminal-accent);
          color: #000;
        }

        .attack-item.selected .metadata {
          color: rgba(0, 0, 0, 0.6);
        }

        .metadata {
          font-size: 9px;
          color: var(--terminal-muted);
          text-transform: uppercase;
        }

        .terminal-button {
          background: transparent;
          border: 1px solid var(--terminal-border);
          color: var(--terminal-text);
          padding: 10px 16px;
          border-radius: 0px;
          text-align: center;
          cursor: pointer;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          transition: all 0.2s ease;
        }

        .primary-action {
          background: var(--terminal-accent);
          color: #000;
          border-color: var(--terminal-accent);
        }

        .primary-action:hover:not(:disabled) {
          background: #fca5a5;
        }

        .primary-action:disabled {
          background: transparent;
          color: var(--terminal-muted);
          border-color: var(--terminal-border);
          cursor: not-allowed;
          opacity: 0.5;
        }

        .mobile-dropdown-trigger {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border: 1px solid var(--terminal-accent);
          color: var(--terminal-accent);
          cursor: pointer;
          font-weight: 700;
          background: rgba(248, 113, 113, 0.05);
        }

        .mobile-dropdown-content {
          position: absolute;
          top: 100%;
          left: 20px;
          right: 20px;
          background: var(--terminal-bg);
          border: 1px solid var(--terminal-border);
          border-top: none;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          z-index: 110;
        }
      `}</style>

      {/* Mission Control */}
      <div className="mission-control">
        <div style={{ fontWeight: 700, fontSize: "16px", textTransform: "uppercase", color: "var(--terminal-accent)", letterSpacing: "1px" }}>
          Mission Control
        </div>

        {/* Token availability status - Hide on mobile if menu is closed to save space */}
        <div className={isMobile && !mobileMenuOpen ? "hide-on-mobile" : ""}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 700 }}>Target Status</div>
            <div style={{ padding: "8px", border: "1px solid var(--terminal-border)", background: "rgba(255,255,255,0.02)", fontSize: "10px" }}>
              <div style={{ color: oauth2HasToken ? "var(--terminal-accent)" : "var(--terminal-muted)", display: "flex", gap: "6px" }}>
                <span>[{oauth2HasToken ? "●" : " "}]</span> <span>OAUTH2_TOKEN_LOADED</span>
              </div>
              <div style={{ color: zkpHasToken ? "var(--terminal-secure)" : "var(--terminal-muted)", display: "flex", gap: "6px", marginTop: "4px" }}>
                <span>[◆]</span> <span>ZKP_PROOF_{zkpHasToken ? "LOADED" : "MISSING"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Attack type selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", position: "relative" }}>
          <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 700 }}>Select Vector</div>
          
          {isMobile ? (
            <>
              <div className="mobile-dropdown-trigger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                <span>[SELECT ATTACK {mobileMenuOpen ? "▲" : "▼"}]</span>
                <span style={{ fontSize: "11px", opacity: 0.8 }}>
                  {ATTACK_TYPES.find(a => a.key === attackType)?.label}
                </span>
              </div>
              {mobileMenuOpen && (
                <div className="mobile-dropdown-content">
                  <div 
                    className="attack-listbox" 
                    role="listbox" 
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    ref={listboxRef}
                  >
                    {ATTACK_TYPES.map(({ key, label, auth }) => (
                      <div
                        key={key}
                        role="option"
                        aria-selected={attackType === key}
                        className={`attack-item ${attackType === key ? "selected" : ""}`}
                        onClick={() => { setAttackType(key); resetPanels(); setMobileMenuOpen(false) }}
                      >
                        <div style={{ fontWeight: 600 }}>[SELECT] {label}</div>
                        <div className="metadata">
                          {auth === "both" ? "DUAL" : auth.toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div 
              className="attack-listbox" 
              role="listbox" 
              tabIndex={0}
              onKeyDown={handleKeyDown}
              ref={listboxRef}
              style={{ minHeight: "200px" }}
            >
              {ATTACK_TYPES.map(({ key, label, auth }) => (
                <div
                  key={key}
                  role="option"
                  aria-selected={attackType === key}
                  className={`attack-item ${attackType === key ? "selected" : ""}`}
                  onClick={() => { setAttackType(key); resetPanels() }}
                >
                  <div style={{ fontWeight: 600 }}>[SELECT] {label}</div>
                  <div className="metadata">
                    {auth === "both" ? "DUAL" : auth.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execute / Reset */}
        <div style={{ marginTop: isMobile ? "0" : "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            className="terminal-button primary-action"
            onClick={handleExecute}
            disabled={!canExecute || (attackPhase !== "idle" && attackPhase !== "done")}
          >
            Execute Strike
          </button>
          {attackPhase === "done" && (
            <button className="terminal-button" onClick={resetPanels}>
              Reset Terminal
            </button>
          )}
        </div>
      </div>

      {/* Data Stream (70%) */}
      <div className={`data-stream ${errorFlash ? "error-flash" : ""}`}>
        <div style={{ fontWeight: 700, fontSize: "18px", textTransform: "uppercase", color: "var(--terminal-muted)" }}>
          Data Stream
        </div>

        {/* Oscilloscope during scanning */}
        {attackPhase === "scanning" && (
          <Oscilloscope />
        )}

        {/* Initial state */}
        {attackPhase === "idle" && !attackResult && !compareResult && (
          <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--terminal-border)", color: "var(--terminal-muted)" }}>
            {">"} AWAITING MISSION PARAMETERS...
          </div>
        )}

        {/* Auth type badge & Token preview (single mode) */}
        {attackType !== "compare" && hasToken && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "inline-block", padding: "2px 8px", border: "1px solid var(--terminal-muted)", borderRadius: "0px", fontSize: "11px", width: "fit-content" }}>
              {authType.toUpperCase()} // INTERCEPTED
            </div>
            <div style={{ fontSize: "11px", color: "var(--terminal-muted)", wordBreak: "break-all" }}>
              RAW_BUFFER: {token.slice(0, 64)}...
            </div>
          </div>
        )}

        {/* Step log */}
        {attackSteps.length > 0 && (
          <ExecutionLog steps={attackSteps} />
        )}

        {/* Results */}
        {attackPhase === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ fontSize: "11px", color: "var(--terminal-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--terminal-border)", paddingBottom: "4px" }}>
              Forensic Analysis Report
            </div>
            
            {attackType !== "compare" && attackResult && (
              <ForensicsReadout result={attackResult} />
            )}

            {attackType === "compare" && compareResult && (
              <CompareCard
                oauth2Results={compareResult.oauth2}
                zkpResults={compareResult.zkp}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}