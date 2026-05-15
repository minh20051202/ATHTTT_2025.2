import { useState, useCallback, useEffect, useRef } from "react";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { attackApi } from "../services/attackApi.js";
import { signWithFixedNonce, generatePrivateKey } from "../lib/zkp.js";

const ATTACK_TYPES = [
  { key: "credential-theft", label: "1. Credential Theft via Context/Logs", auth: "both", desc: "Credentials stolen from AI agent conversation logs or context" },
  { key: "mitm",             label: "2. MITM / TLS Downgrade",           auth: "both", desc: "Intercept credentials in transit via TLS downgrade or proxy" },
  { key: "replay",           label: "3. Token Replay / Long-Lived Token", auth: "oauth2", desc: "Reuse captured bearer token until expiry" },
  { key: "client-assertion-sub", label: "4. Client Assertion Substitution", auth: "oauth2", desc: "Forge assertions impersonating another agent" },
  { key: "proof-correlation", label: "5. Proof Correlation / Fingerprinting", auth: "zkp", desc: "Traffic analysis reveals identity patterns via ZKP metadata" },
  { key: "challenge-predictability", label: "6. Challenge Token Predictability", auth: "zkp", desc: "Predict server challenge to pre-compute valid proof" },
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
      boxShadow: `0 0 8px ${color}`,
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
      fontFamily: "var(--font-mono)", 
      fontSize: "10px", 
      color: "var(--terminal-secure)",
      opacity: 0.5,
      padding: "16px",
      border: "1px solid rgba(52, 211, 153, 0.1)",
      background: "rgba(0,0,0,0.5)",
      height: "160px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      marginBottom: "20px",
      borderRadius: "4px"
    }}>
      <div style={{ fontSize: "9px", marginBottom: "12px", borderBottom: "1px solid rgba(52, 211, 153, 0.1)", paddingBottom: "6px", letterSpacing: "1px", fontWeight: 700 }}>
        [LIVE_INTERCEPT_STREAM]
      </div>
      {chunks.map((chunk, i) => (
        <div key={i} style={{ whiteSpace: "nowrap", opacity: (i + 1) / 10 }}>
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
                 result.details?.math ||
                 result.details?.mathematical_proof ||
                 result.details?.stolen_identity;
  
  const exfiltrated = result.details?.exfiltrated_data;
  const mitigation = result.details?.countermeasure || result.details?.countermeasure_in_place;
  const exposedPrivateKey = result.details?.exposed_private_key;

  const status = result.success ? "vulnerable" : "protected";

  return (
    <div style={{ 
      border: "1px solid var(--terminal-border)",
      background: "rgba(255,255,255,0.02)",
      display: "flex",
      flexDirection: "column",
      fontSize: "11px",
      marginBottom: "16px",
      borderRadius: "4px"
    }}>
      <div style={{ 
        background: result.success ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
        padding: "8px 12px",
        borderBottom: "1px solid var(--terminal-border)",
        fontWeight: 800,
        display: "flex",
        justifyContent: "space-between",
        color: result.success ? "var(--terminal-accent)" : "var(--terminal-secure)",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}>
        <span><StatusLED status={status} />Forensic Trace</span>
        <span>{result.success ? "[VULNERABLE]" : "[SECURE]"}</span>
      </div>

      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {exposedPrivateKey && (
          <div style={{ 
            padding: "16px", 
            background: "rgba(220, 38, 38, 0.05)", 
            border: "1px solid var(--terminal-accent)",
            borderRadius: "4px"
          }}>
            <div style={{ color: "var(--terminal-accent)", fontWeight: 900, fontSize: "14px", marginBottom: "10px", textAlign: "center", letterSpacing: "1px" }}>
              !!! CRITICAL_IDENTITY_LEAK !!!
            </div>
            <pre style={{ 
              margin: 0, 
              padding: "12px", 
              background: "#000", 
              color: "#ff4444", 
              fontSize: "10px", 
              wordBreak: "break-all",
              whiteSpace: "pre-wrap",
              border: "1px solid rgba(220, 38, 38, 0.2)",
              fontFamily: "var(--font-mono)"
            }}>
              {exposedPrivateKey}
            </pre>
          </div>
        )}

        {exfiltrated && (
          <div>
            <div style={{ color: "var(--terminal-accent)", fontWeight: 800, fontSize: "9px", marginBottom: "6px", textTransform: "uppercase" }}>[BUFFER_EXFILTRATION]</div>
            <pre style={{ margin: 0, fontSize: "10px", color: "var(--terminal-text)", opacity: 0.8, fontFamily: "var(--font-mono)" }}>
              {JSON.stringify(exfiltrated, null, 2)}
            </pre>
          </div>
        )}

        <div>
          <div style={{ color: "var(--terminal-muted)", marginBottom: "4px", fontWeight: 800, fontSize: "9px", textTransform: "uppercase" }}>[VULNERABILITY_ID]</div>
          <div style={{ color: "var(--terminal-text)", fontSize: "12px" }}>{vulnerability}</div>
        </div>

        {payload && (
          <div>
            <div style={{ color: "var(--terminal-muted)", marginBottom: "4px", fontWeight: 800, fontSize: "9px", textTransform: "uppercase" }}>[NETWORK_CAPTURE]</div>
            <pre style={{ 
              margin: 0, 
              padding: "10px", 
              background: "rgba(0,0,0,0.3)", 
              border: "1px solid var(--terminal-border)",
              color: "var(--terminal-secure)",
              overflowX: "auto",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              borderRadius: "2px"
            }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        {mitigation && (
          <div style={{ borderTop: "1px solid var(--terminal-border)", paddingTop: "12px" }}>
            <div style={{ color: "var(--terminal-secure)", marginBottom: "4px", fontWeight: 800, fontSize: "9px", textTransform: "uppercase" }}>[REMEDIATION_PROTOCOL]</div>
            <div style={{ color: "var(--terminal-secure)", fontSize: "11px", opacity: 0.9 }}>{mitigation}</div>
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
        height: "180px",
        overflowY: "auto",
        background: "var(--terminal-bg)",
        border: "1px solid var(--terminal-border)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontFamily: "var(--font-mono)",
        borderRadius: "4px"
      }}
    >
      {steps.map((step, i) => (
        <div key={i} style={{ fontSize: "11px", display: "flex", gap: "10px" }}>
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
  const oauth2Vulnerable = oauth2Results && Object.values(oauth2Results).some(r => r?.success)
  const zkpVulnerable    = zkpResults && Object.values(zkpResults).some(r => r?.success)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", gap: "0", border: "1px solid var(--terminal-border)", borderRadius: "4px", overflow: "hidden" }}>
        <div
          style={{
            flex: 1,
            padding: "12px 20px",
            borderRight: "1px solid var(--terminal-border)",
            background: oauth2Vulnerable ? "rgba(248,113,113,0.03)" : "rgba(52,211,153,0.03)",
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
            [OAUTH2_SUBSYSTEM]
          </div>
          <div style={{ fontSize: "16px", fontWeight: 900, color: oauth2Vulnerable ? "var(--terminal-accent)" : "var(--terminal-secure)", display: "flex", alignItems: "center" }}>
            {oauth2Results ? (
              <>
                <StatusLED status={oauth2Vulnerable ? "vulnerable" : "protected"} />
                {oauth2Vulnerable ? "VULNERABLE" : "SECURE"}
              </>
            ) : "OFFLINE"}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            padding: "12px 20px",
            background: zkpVulnerable ? "rgba(248,113,113,0.03)" : "rgba(52,211,153,0.03)",
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
            [ZKP_SUBSYSTEM]
          </div>
          <div style={{ fontSize: "16px", fontWeight: 900, color: zkpVulnerable ? "var(--terminal-accent)" : "var(--terminal-secure)", display: "flex", alignItems: "center" }}>
            {zkpResults ? (
              <>
                <StatusLED status={zkpVulnerable ? "vulnerable" : "protected"} />
                {zkpVulnerable ? "VULNERABLE" : "SECURE"}
              </>
            ) : "OFFLINE"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {oauth2Results ? (
            Object.entries(oauth2Results).map(([key, result]) => result && (
              <div key={key}>
                <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "6px", textTransform: "uppercase" }}>
                  {key.replace(/_/g, " ")}
                </div>
                <ForensicsReadout result={result} />
              </div>
            ))
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {zkpResults ? (
            Object.entries(zkpResults).map(([key, result]) => result && (
              <div key={key}>
                <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "6px", textTransform: "uppercase" }}>
                  {key.replace(/_/g, " ")}
                </div>
                <ForensicsReadout result={result} />
              </div>
            ))
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ─── Main AttackPanel ─── */
export default function AttackPanel() {
  const { latestResult, resultsByAuth } = useChatHistory()

  const [attackType, setAttackType]     = useState("replay")
  const [analysisMode, setAnalysisMode] = useState("single")
  const [attackPhase, setAttackPhase]   = useState("idle")
  const [attackSteps, setAttackSteps]   = useState([])
  const [attackResult, setAttackResult] = useState(null)
  const [compareResult, setCompareResult] = useState(null)
  const [errorFlash, setErrorFlash] = useState(false)

  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 900 : false)
  const listboxRef = useRef(null)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const authInfo = latestResult?.auth_info
  const authType = authInfo?.type || "oauth2"
  const token = authInfo?.type === "oauth2"
    ? authInfo.token
    : authInfo?.type === "zkp"
      ? authInfo.proof
      : null
  const agentId = authInfo?.agent_id

  const oauth2Token = resultsByAuth?.oauth2?.auth_info?.token
  const zkpToken    = resultsByAuth?.zkp?.auth_info?.proof
  const oauth2HasToken = !!oauth2Token
  const zkpHasToken    = !!zkpToken
  const hasEitherToken = oauth2HasToken || zkpHasToken
  const hasToken        = !!token

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
    setAttackSteps([{ label: "SCANNING_TRAFFIC", detail: "Sniffing auth channel...", success: true }])
    await new Promise(r => setTimeout(r, 600))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, { label: "INJECTING_EXPLOIT", detail: `${ATTACK_TYPES.find(a => a.key === attackType)?.label}`, success: true }])
    await new Promise(r => setTimeout(r, 800))

    try {
      let attackResp;
      
      const apiFn = {
        "replay":                   attackApi.replay,
        "credential-theft":         attackApi.credentialTheft,
        "mitm":                     attackApi.mitm,
        "client-assertion-sub":    attackApi.clientAssertionSub,
        "proof-correlation":        attackApi.proofCorrelation,
        "challenge-predictability": attackApi.challengePredictability,
      }[attackType]
      const type = ATTACK_TYPES.find(a => a.key === attackType)?.auth || authType
      const targetAuthType = type === "both" ? authType : type
      attackResp = await apiFn(targetAuthType, token, agentId)

      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 500))
      setAttackSteps(prev => [...prev, {
        label: attackResp.success ? "EXPLOIT_SUCCESS" : "EXPLOIT_BLOCKED",
        detail: attackResp.message,
        success: attackResp.success,
      }])
      setAttackResult(attackResp)
      setAttackPhase("done")
    } catch (err) {
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 500)
      setAttackSteps(prev => [...prev, { label: "INTERNAL_ERROR", detail: err.message, success: false }])
      setAttackPhase("done")
    }
  }, [attackType, authType, token, agentId, hasToken])

  const executeCompareAttack = useCallback(async () => {
    const oauth2 = resultsByAuth?.oauth2?.auth_info?.token || null
    const zkp    = resultsByAuth?.zkp?.auth_info?.proof    || null
    if (!oauth2 && !zkp) return

    setAttackPhase("scanning")
    setCompareResult(null)
    setAttackSteps([])
    setAttackSteps([{ label: "DUAL_CHANNEL_LOCK", detail: "Intercepting OAuth2 & ZKP...", success: true }])
    await new Promise(r => setTimeout(r, 600))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, {
      label: "BATCH_VULNERABILITY_TEST",
      detail: "Mass testing across captured tokens...",
      success: true,
    }])
    await new Promise(r => setTimeout(r, 1000))

    try {
      const resp = await attackApi.compare(oauth2, zkp)
      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 400))
      setCompareResult(resp.data)
      setAttackPhase("done")
    } catch (err) {
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 500)
      setAttackSteps(prev => [...prev, { label: "ANALYSIS_FAILED", detail: err.message, success: false }])
      setAttackPhase("done")
    }
  }, [resultsByAuth])

  const handleExecute = useCallback(() => {
    resetPanels()
    if (analysisMode === "compare") {
      executeCompareAttack()
    } else {
      executeSingleAttack()
    }
  }, [analysisMode, executeSingleAttack, executeCompareAttack, resetPanels])

  const handleKeyDown = (e) => {
    if (attackPhase !== "idle" && attackPhase !== "done") return
    const currentIndex = ATTACK_TYPES.findIndex(a => a.key === attackType)
    let nextIndex = currentIndex
    if (e.key === "ArrowDown") {
      e.preventDefault(); nextIndex = (currentIndex + 1) % ATTACK_TYPES.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); nextIndex = (currentIndex - 1 + ATTACK_TYPES.length) % ATTACK_TYPES.length;
    } else if (e.key === "Enter") {
      e.preventDefault(); handleExecute(); return;
    } else return;
    setAttackType(ATTACK_TYPES[nextIndex].key); resetPanels();
  }

  const canExecute = analysisMode === "compare" ? hasEitherToken : hasToken

  return (
    <div className="attack-terminal-root">
      <style>{`
        .attack-terminal-root {
          --terminal-bg: #09090b;
          --terminal-border: #18181b;
          --terminal-accent: #ef4444;
          --terminal-secure: #10b981;
          --terminal-text: #f4f4f5;
          --terminal-muted: #52525b;
          display: grid;
          grid-template-columns: 320px 1fr;
          height: calc(100dvh - var(--navbar-height));
          background: var(--terminal-bg);
          color: var(--terminal-text);
          font-family: var(--font-mono);
          font-size: 12px;
          overflow: hidden;
          position: relative;
        }
        .attack-terminal-root::after {
          content: " "; display: block; position: absolute; top: 0; left: 0; bottom: 0; right: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.05) 50%), 
                      linear-gradient(90deg, rgba(255, 0, 0, 0.005), rgba(0, 255, 0, 0.002), rgba(0, 0, 255, 0.005));
          z-index: 1000; background-size: 100% 4px, 3px 100%; pointer-events: none;
        }
        .mission-control {
          border-right: 1px solid var(--terminal-border); padding: 24px;
          overflow-y: auto; display: flex; flex-direction: column; gap: 24px; background: #0c0c0e;
        }
        .data-stream {
          padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px;
          border: 1px solid transparent; transition: border-color 0.2s ease;
        }
        @keyframes border-flash {
          0% { border-color: var(--terminal-accent); box-shadow: inset 0 0 30px rgba(239, 68, 68, 0.1); }
          100% { border-color: transparent; box-shadow: none; }
        }
        .error-flash { animation: border-flash 0.6s var(--ease-out); }
        .status-led { animation: led-pulse 2s infinite var(--ease-in-out); }
        @keyframes led-pulse { 0%, 100% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
        .attack-listbox { display: flex; flex-direction: column; border: 1px solid var(--terminal-border); background: rgba(0, 0, 0, 0.3); outline: none; transition: border-color 0.2s ease; border-radius: 4px; overflow: hidden; }
        .attack-listbox:focus { border-color: var(--terminal-accent); }
        .attack-item { padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: none; background: transparent; color: var(--terminal-text); font-family: inherit; font-size: 11px; text-align: left; transition: all 0.15s var(--ease-out); border-bottom: 1px solid rgba(255,255,255,0.02); }
        .attack-item.selected { background: var(--terminal-accent); color: #000; }
        .terminal-button { background: transparent; border: 1px solid var(--terminal-border); color: var(--terminal-text); padding: 12px 20px; text-align: center; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 800; text-transform: uppercase; transition: all 0.2s var(--ease-spring); border-radius: 4px; letter-spacing: 1px; }
        .primary-action { background: var(--terminal-accent); color: #000; border-color: var(--terminal-accent); }
        .primary-action:disabled { color: var(--terminal-muted); border-color: var(--terminal-border); cursor: not-allowed; opacity: 0.3; background: transparent; }
      `}</style>

      <div className="mission-control">
        <div style={{ fontWeight: 800, fontSize: "18px", textTransform: "uppercase", color: "var(--terminal-accent)", letterSpacing: "2px" }}>
          Target HUD
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>Signal Lock</div>
          <div style={{ padding: "12px", border: "1px solid var(--terminal-border)", background: "rgba(255,255,255,0.01)", fontSize: "10px", borderRadius: "4px" }}>
            <div style={{ color: oauth2HasToken ? "var(--terminal-accent)" : "var(--terminal-muted)", display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px" }}>{oauth2HasToken ? "●" : "○"}</span> <span>OAUTH2_LINK_ACTIVE</span>
            </div>
            <div style={{ color: zkpHasToken ? "var(--terminal-secure)" : "var(--terminal-muted)", display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "12px" }}>{zkpHasToken ? "◆" : "◇"}</span> <span>ZKP_VAULT_ENCRYPTED</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>Analysis Mode</div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button 
              className={`terminal-button ${analysisMode === 'single' ? 'primary-action' : ''}`}
              style={{ flex: 1, fontSize: '10px', padding: '8px' }}
              onClick={() => { setAnalysisMode('single'); resetPanels(); }}
            >
              Single
            </button>
            <button 
              className={`terminal-button ${analysisMode === 'compare' ? 'primary-action' : ''}`}
              style={{ flex: 1, fontSize: '10px', padding: '8px' }}
              onClick={() => { setAnalysisMode('compare'); resetPanels(); }}
            >
              Side-by-Side
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", opacity: analysisMode === 'compare' ? 0.3 : 1, pointerEvents: analysisMode === 'compare' ? 'none' : 'auto' }}>
          <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>Vector Select</div>
          <div className="attack-listbox" role="listbox" tabIndex={0} onKeyDown={handleKeyDown} ref={listboxRef} style={{ minHeight: "220px" }}>
            {ATTACK_TYPES.map(({ key, label, auth }) => (
              <div key={key} role="option" aria-selected={attackType === key} className={`attack-item ${attackType === key ? "selected" : ""}`} onClick={() => { setAttackType(key); resetPanels() }}>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: "9px", opacity: 0.7, fontWeight: 800 }}>{auth === "both" ? "DUAL" : auth.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
          <button className="terminal-button primary-action" onClick={handleExecute} disabled={!canExecute || (attackPhase !== "idle" && attackPhase !== "done")}>
            Initialize Strike
          </button>
          {(attackPhase === "done" || attackResult || compareResult) && (
            <button className="terminal-button" onClick={resetPanels}>
              Reset Buffer
            </button>
          )}
        </div>
      </div>

      <div className={`data-stream ${errorFlash ? "error-flash" : ""}`}>
        <div style={{ fontWeight: 800, fontSize: "14px", textTransform: "uppercase", color: "var(--terminal-muted)", letterSpacing: "1px" }}>
          Live Execution Stream
        </div>

        {attackPhase === "scanning" && <Oscilloscope />}

        {attackPhase === "idle" && !attackResult && !compareResult && (
          <div style={{ padding: "60px 40px", textAlign: "center", border: "1px dashed var(--terminal-border)", color: "var(--terminal-muted)", fontSize: "12px", borderRadius: "4px", background: "rgba(0,0,0,0.1)" }}>
            {">"} STANDBY... SELECT VECTOR TO BEGIN PENETRATION TEST
          </div>
        )}

        {analysisMode !== "compare" && hasToken && attackPhase === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(255,255,255,0.01)", padding: "12px", border: "1px solid var(--terminal-border)", borderRadius: "4px" }}>
            <div style={{ display: "inline-block", padding: "2px 8px", background: "var(--terminal-muted)", borderRadius: "2px", fontSize: "9px", width: "fit-content", color: "#000", fontWeight: 900 }}>
              {authType.toUpperCase()}_SNIFFED
            </div>
            <div style={{ fontSize: "10px", color: "var(--terminal-muted)", wordBreak: "break-all", opacity: 0.6, fontFamily: "var(--font-mono)" }}>
              {token.slice(0, 160)}...
            </div>
          </div>
        )}

        {analysisMode === "compare" && hasEitherToken && attackPhase === "idle" && (
          <div style={{ padding: "60px 40px", textAlign: "center", border: "1px dashed var(--terminal-border)", color: "var(--terminal-secure)", fontSize: "12px", borderRadius: "4px", background: "rgba(0,0,0,0.1)" }}>
            {">"} MULTI_CHANNEL_SIGNAL_LOCKED... READY FOR FULL COMPARISON TEST
          </div>
        )}

        {attackSteps.length > 0 && <ExecutionLog steps={attackSteps} />}

        {attackPhase === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--terminal-border)", paddingBottom: "6px", fontWeight: 800, letterSpacing: "1px" }}>
              Post-Exploitation Analysis
            </div>
            {analysisMode !== "compare" && attackResult && <ForensicsReadout result={attackResult} />}
            {analysisMode === "compare" && compareResult && <CompareCard oauth2Results={compareResult.oauth2} zkpResults={compareResult.zkp} />}
          </div>
        )}
      </div>
    </div>
  )
}
