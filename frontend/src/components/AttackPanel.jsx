import { useState, useCallback, useEffect, useRef } from "react";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { attackApi } from "../services/attackApi.js";

const ATTACK_TYPES = [
  { key: "credential-theft", label: "1. Credential Theft via Logs", auth: "both", desc: "Bearer tokens or secrets stolen from AI agent conversation logs or context" },
  { key: "mitm",             label: "2. TLS Interception / MITM",   auth: "both", desc: "Proxy intercepts credentials in transit via TLS downgrade or inspection" },
  { key: "replay",           label: "3. Token Replay",               auth: "oauth2", desc: "Reuse captured bearer token until expiry" },
  { key: "client-assertion-sub", label: "4. Client Assertion Substitution", auth: "oauth2", desc: "Forge assertions impersonating another agent by modifying JWT claims" },
  { key: "proof-correlation", label: "5. Traffic Analysis / Fingerprinting", auth: "zkp", desc: "Observer links ZKP authentications via proof metadata fingerprint" },
  { key: "nonce-reuse", label: "6. Nonce Reuse Attack", auth: "zkp", desc: "Schnorr signature broken if nonce r is reused — secret key x algebraically recovered" },
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
      background: "rgba(0,0,0,0.04)",
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
function ForensicsReadout({ result, capturedOauth2Token, capturedZkpProof }) {
  if (!result) return null;

  const vulnerability = result.details?.vulnerability || result.message;
  const payload = result.details?.exposed_data ||
                 result.details?.leaked_metadata ||
                 result.details?.intercepted_data ||
                 result.details?.server_validation ||
                 result.details?.math ||
                 result.details?.mathematical_proof ||
                 result.details?.stolen_identity ||
                 result.details?.attack_phases;

  const exfiltrated = result.details?.exfiltrated_data;
  const exposedPrivateKey = result.details?.exposed_private_key;
  const hasStolenCredential = !!(
    result.details?.exposed_data?.stolen_token ||
    result.details?.intercepted_data ||
    result.details?.stolen_identity ||
    // nonce-reuse: match proves x was recovered
    result.details?.match  // nonce-reuse: match = recovered x === actual x
  );

  const status = result.success ? "vulnerable" : "protected";

  return (
    <div style={{ 
      border: "1px solid var(--terminal-border)",
      background: "rgba(0,0,0,0.03)",
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
              background: "rgba(80,0,0,0.08)", 
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

        {result.auth_type === "zkp" && result.details?.attack_logic && result.details?.attack_logic?.nonce_r_reused && (
          <div>
            <div style={{ color: "var(--terminal-accent)", fontWeight: 800, fontSize: "9px", marginBottom: "6px", textTransform: "uppercase" }}>[NONCE_REUSE_ARTIFACT]</div>
            <pre style={{
              margin: 0,
              padding: "10px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "var(--terminal-accent)",
              fontSize: "10px",
              overflowX: "auto",
              fontFamily: "var(--font-mono)",
              borderRadius: "2px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {JSON.stringify({
                nonce_r: result.details.attack_logic.nonce_r_reused,
                proof1_c1: result.details.attack_logic.proof1?.c1,
                proof1_s1: result.details.attack_logic.proof1?.s1,
                proof2_c2: result.details.attack_logic.proof2?.c2,
                proof2_s2: result.details.attack_logic.proof2?.s2,
                recovered_secret: result.details.recovered_secret,
                match: result.details.match,
              }, null, 2)}
            </pre>
          </div>
        )}

        {(result.auth_type === "oauth2"
            ? (capturedOauth2Token && hasStolenCredential)
            : capturedZkpProof) && (
          <div>
            <div style={{ color: "var(--terminal-accent)", fontWeight: 800, fontSize: "9px", marginBottom: "6px", textTransform: "uppercase" }}>[CAPTURED_CREDENTIAL]</div>
            <pre style={{
              margin: 0,
              padding: "10px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "var(--terminal-accent)",
              fontSize: "10px",
              overflowX: "auto",
              fontFamily: "var(--font-mono)",
              borderRadius: "2px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {result.auth_type === "oauth2"
                ? `BEARER_TOKEN:\n${capturedOauth2Token}`
                : `ZKP_PROOF:\n${capturedZkpProof}`}
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
              background: "rgba(0,0,0,0.04)", 
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
function CompareCard({ oauth2Results, zkpResults, capturedOauth2Token, capturedZkpProof }) {
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
                <ForensicsReadout result={result} capturedOauth2Token={capturedOauth2Token} capturedZkpProof={capturedZkpProof} />
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
                <ForensicsReadout result={result} capturedOauth2Token={capturedOauth2Token} capturedZkpProof={capturedZkpProof} />
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

  const oauth2Token = resultsByAuth?.oauth2?.auth_info?.token
  const zkpToken    = resultsByAuth?.zkp?.auth_info?.proof
  const oauth2HasToken = !!oauth2Token
  const zkpHasToken    = !!zkpToken

  const resetPanels = useCallback(() => {
    setAttackPhase("idle")
    setAttackSteps([])
    setAttackResult(null)
    setCompareResult(null)
  }, [])

  const executeAttack = useCallback(async () => {
    const selectedAttack = ATTACK_TYPES.find(a => a.key === attackType)
    const targetAuth = selectedAttack?.auth || "oauth2"

    if (targetAuth === "oauth2" && !oauth2HasToken) return;
    if (targetAuth === "zkp" && attackType !== "nonce-reuse" && !zkpHasToken) return;
    if (targetAuth === "both" && !oauth2HasToken && !zkpHasToken) return;

    setAttackPhase("scanning")
    setAttackResult(null)
    setCompareResult(null)
    setAttackSteps([])
    setAttackSteps([{ label: "SCANNING_TRAFFIC", detail: "Sniffing auth channels...", success: true }])
    await new Promise(r => setTimeout(r, 600))
    setAttackPhase("exploiting")
    setAttackSteps(prev => [...prev, { label: "INJECTING_EXPLOIT", detail: `${selectedAttack?.label}`, success: true }])
    await new Promise(r => setTimeout(r, 800))

    try {
      const apiFn = {
        "replay":                   attackApi.replay,
        "credential-theft":         attackApi.credentialTheft,
        "mitm":                     attackApi.mitm,
        "client-assertion-sub":    attackApi.clientAssertionSub,
        "proof-correlation":        attackApi.proofCorrelation,
        "nonce-reuse": attackApi.nonceReuse,
      }[attackType]

      let oauth2Res = null;
      let zkpRes = null;

      if (targetAuth === "oauth2" || targetAuth === "both") {
        if (oauth2HasToken) {
          const agentId = resultsByAuth?.oauth2?.auth_info?.agent_id;
          oauth2Res = await apiFn("oauth2", oauth2Token, agentId)
        } else if (targetAuth === "both") {
          oauth2Res = {
            success: false,
            message: "SKIPPED — OAuth2 agent has not sent a request yet. Chat with OAuth2 Agent first to capture token.",
            details: { vulnerability: "Missing Token" }
          }
        }
      }

      if (targetAuth === "zkp" || targetAuth === "both") {
        if (attackType === "nonce-reuse") {
          // Standalone: hits /api/attacks/nonce-reuse directly, no prior ZKP token needed
          zkpRes = await apiFn()
        } else if (zkpHasToken) {
          const agentId = resultsByAuth?.zkp?.auth_info?.agent_id;
          zkpRes = await apiFn("zkp", zkpToken, agentId)
        } else if (targetAuth === "both") {
          zkpRes = {
            success: false,
            message: "SKIPPED — ZKP agent has not sent a request yet. Chat with ZKP Agent first to capture proof.",
            details: { vulnerability: "Missing Proof" }
          }
        }
      }

      setAttackPhase("extracting")
      await new Promise(r => setTimeout(r, 500))

      if (targetAuth === "both") {
        setAttackSteps(prev => [...prev, {
          label: "EXPLOIT_COMPLETE",
          detail: "Dual attack execution finished",
          success: true,
        }])
        setCompareResult({
           oauth2: { [attackType]: oauth2Res },
           zkp: { [attackType]: zkpRes }
        });
      } else if (targetAuth === "oauth2") {
        setAttackSteps(prev => [...prev, {
          label: oauth2Res.success ? "EXPLOIT_SUCCESS" : "EXPLOIT_BLOCKED",
          detail: oauth2Res.message,
          success: oauth2Res.success,
        }])
        setAttackResult(oauth2Res)
      } else if (targetAuth === "zkp") {
        setAttackSteps(prev => [...prev, {
          label: zkpRes.success ? "EXPLOIT_SUCCESS" : "EXPLOIT_BLOCKED",
          detail: zkpRes.message,
          success: zkpRes.success,
        }])
        setAttackResult(zkpRes)
      }

      setAttackPhase("done")
    } catch (err) {
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 500)
      setAttackSteps(prev => [...prev, { label: "INTERNAL_ERROR", detail: err.message, success: false }])
      setAttackPhase("done")
    }
  }, [attackType, oauth2Token, zkpToken, oauth2HasToken, zkpHasToken, resultsByAuth])

  const handleExecute = useCallback(() => {
    resetPanels()
    executeAttack()
  }, [executeAttack, resetPanels])

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

  const selectedTargetAuth = ATTACK_TYPES.find(a => a.key === attackType)?.auth || "oauth2"
  const canExecute = selectedTargetAuth === "both"
    ? (oauth2HasToken || zkpHasToken)
    : selectedTargetAuth === "oauth2" ? oauth2HasToken
    : attackType === "nonce-reuse" ? true  // standalone demo with own vulnerable token
    : zkpHasToken

  return (
    <div className="attack-terminal-root">
      <style>{`
        .attack-terminal-root {
          --terminal-bg: #f4f4f5;
          --terminal-border: #d4d4d8;
          --terminal-accent: #ef4444;
          --terminal-secure: #10b981;
          --terminal-text: #18181b;
          --terminal-muted: #a1a1aa;
          --terminal-card-bg: #ffffff;
          --terminal-led-bg: rgba(239,68,68,0.08);
          --terminal-led-secure-bg: rgba(16,185,129,0.08);
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
        .mission-control {
          border-right: 1px solid var(--terminal-border); padding: 24px;
          overflow-y: auto; display: flex; flex-direction: column; gap: 24px; background: var(--terminal-card-bg);
        }
        .data-stream {
          padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px;
          border: 1px solid transparent; transition: border-color 0.2s ease;
          background: var(--terminal-bg);
        }
        @keyframes border-flash {
          0% { border-color: var(--terminal-accent); box-shadow: inset 0 0 30px rgba(239, 68, 68, 0.15); }
          100% { border-color: transparent; box-shadow: none; }
        }
        .error-flash { animation: border-flash 0.6s var(--ease-out); }
        .status-led { animation: led-pulse 2s infinite var(--ease-in-out); }
        @keyframes led-pulse { 0%, 100% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
        .attack-listbox { display: flex; flex-direction: column; border: 1px solid var(--terminal-border); background: rgba(0,0,0,0.03); outline: none; transition: border-color 0.2s ease; border-radius: 4px; overflow: hidden; }
        .attack-listbox:focus { border-color: var(--terminal-accent); }
        .attack-item { padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: none; background: transparent; color: var(--terminal-text); font-family: inherit; font-size: 11px; text-align: left; transition: all 0.15s var(--ease-out); border-bottom: 1px solid rgba(0,0,0,0.04); }
        .attack-item.selected { background: var(--terminal-accent); color: #fff; }
        .terminal-button { background: transparent; border: 1px solid var(--terminal-border); color: var(--terminal-text); padding: 12px 20px; text-align: center; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 800; text-transform: uppercase; transition: all 0.2s var(--ease-spring); border-radius: 4px; letter-spacing: 1px; }
        .primary-action { background: var(--terminal-accent); color: #fff; border-color: var(--terminal-accent); }
        .primary-action:disabled { color: var(--terminal-muted); border-color: var(--terminal-border); cursor: not-allowed; opacity: 0.4; background: transparent; }
      `}</style>

      <div className="mission-control">
        <div style={{ fontWeight: 800, fontSize: "18px", textTransform: "uppercase", color: "var(--terminal-accent)", letterSpacing: "2px" }}>
          Target HUD
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>Signal Lock</div>
          <div style={{ padding: "12px", border: "1px solid var(--terminal-border)", background: "rgba(0,0,0,0.03)", fontSize: "10px", borderRadius: "4px" }}>
            <div style={{ color: oauth2HasToken ? "var(--terminal-accent)" : "var(--terminal-muted)", display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px" }}>{oauth2HasToken ? "●" : "○"}</span> <span>OAUTH2_LINK_ACTIVE</span>
            </div>
            <div style={{ color: zkpHasToken ? "var(--terminal-secure)" : "var(--terminal-muted)", display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "12px" }}>{zkpHasToken ? "◆" : "◇"}</span> <span>ZKP_VAULT_ENCRYPTED</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
          <div style={{ padding: "60px 40px", textAlign: "center", border: "1px dashed var(--terminal-border)", color: "var(--terminal-muted)", fontSize: "12px", borderRadius: "4px", background: "rgba(0,0,0,0.02)" }}>
            {">"} STANDBY... SELECT VECTOR TO BEGIN PENETRATION TEST
          </div>
        )}

        {attackSteps.length > 0 && <ExecutionLog steps={attackSteps} />}

        {attackPhase === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ fontSize: "10px", color: "var(--terminal-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--terminal-border)", paddingBottom: "6px", fontWeight: 800, letterSpacing: "1px" }}>
              Post-Exploitation Analysis
            </div>
            {attackResult && <ForensicsReadout result={attackResult} capturedOauth2Token={oauth2Token} capturedZkpProof={zkpToken} />}
            {compareResult && (
               <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                 <div>
                   <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "6px", textTransform: "uppercase" }}>[OAUTH2_SUBSYSTEM]</div>
                   {compareResult.oauth2 && <ForensicsReadout result={compareResult.oauth2[attackType]} capturedOauth2Token={oauth2Token} capturedZkpProof={zkpToken} />}
                 </div>
                 <div>
                   <div style={{ fontSize: "9px", fontWeight: 800, color: "var(--terminal-muted)", marginBottom: "6px", textTransform: "uppercase" }}>[ZKP_SUBSYSTEM]</div>
                   {compareResult.zkp && <ForensicsReadout result={compareResult.zkp[attackType]} capturedOauth2Token={oauth2Token} capturedZkpProof={zkpToken} />}
                 </div>
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
