import { useState, useEffect, useRef, useCallback } from "react";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";

const ATTACK_TYPES = [
  {
    key: "replay",
    label: "Replay Attack",
    desc: "Reuse a captured token or proof",
    icon: "↻",
  },
  {
    key: "token_theft",
    label: "Token Theft",
    desc: "Extract credentials from a valid token",
    icon: "☉",
  },
  {
    key: "credential_stuffing",
    label: "Credential Stuffing",
    desc: "Use stolen tokens to authenticate",
    icon: "📋",
  },
];

function AttackPanel() {
  const { latestResult } = useChatHistory();
  const [attackType, setAttackType] = useState("replay");
  const [oauth2Phase, setOauth2Phase] = useState("idle");
  const [zkpPhase, setZkpPhase] = useState("idle");
  const [showForensics, setShowForensics] = useState(false);
  const [blinkState, setBlinkState] = useState(false);
  const [replayDebounce, setReplayDebounce] = useState(false);

  const timeoutRefs = useRef({});
  const replayTimeoutRef = useRef(null);

  const clearAllTimeouts = useCallback(() => {
    Object.values(timeoutRefs.current).forEach((t) => {
      if (typeof t === "number" && t > 0) clearTimeout(t);
    });
    timeoutRefs.current = {};
  }, []);

  const resetPanels = useCallback(() => {
    clearAllTimeouts();
    setOauth2Phase("idle");
    setZkpPhase("idle");
    setShowForensics(false);
    setBlinkState(false);
    setReplayDebounce(false);
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current);
      replayTimeoutRef.current = null;
    }
  }, [clearAllTimeouts]);

  // OAuth2 breach animation state machine
  useEffect(() => {
    if (oauth2Phase === "idle") return;
    let t;
    if (oauth2Phase === "dim") {
      t = setTimeout(() => setOauth2Phase("flash"), 200);
    } else if (oauth2Phase === "flash") {
      t = setTimeout(() => setOauth2Phase("blink"), 400);
    } else if (oauth2Phase === "blink") {
      let blinks = 0;
      const blinkInterval = setInterval(() => {
        blinks++;
        setBlinkState((prev) => !prev);
        if (blinks >= 3) {
          clearInterval(blinkInterval);
          setOauth2Phase("exfil");
          setBlinkState(false);
        }
      }, 80);
      t = timeoutRefs.current.blinkInterval = setTimeout(
        () => clearInterval(blinkInterval),
        600,
      );
      return () => clearInterval(blinkInterval);
    } else if (oauth2Phase === "exfil") {
      t = setTimeout(() => setOauth2Phase("done"), 600);
    }
    if (t) timeoutRefs.current[oauth2Phase] = t;
    return () => clearTimeout(t);
  }, [oauth2Phase]);

  // ZKP animation runs alongside OAuth2
  useEffect(() => {
    if (oauth2Phase === "idle") return;
    if (oauth2Phase === "dim" && zkpPhase === "idle") {
      timeoutRefs.current.zkp_start = setTimeout(() => {
        setZkpPhase("pulse");
      }, 0);
    }
    return () => {};
  }, [oauth2Phase]);

  useEffect(() => {
    if (zkpPhase === "pulse") {
      const t = setTimeout(() => setZkpPhase("check"), 400);
      timeoutRefs.current.zkp_check = t;
    } else if (zkpPhase === "check") {
      const t = setTimeout(() => setZkpPhase("label"), 200);
      timeoutRefs.current.zkp_label = t;
    } else if (zkpPhase === "label") {
      const t = setTimeout(() => setZkpPhase("done"), 300);
      timeoutRefs.current.zkp_done = t;
    } else if (zkpPhase === "done" && oauth2Phase === "done") {
      const t = setTimeout(() => setShowForensics(true), 200);
      timeoutRefs.current.show_forensics = t;
    }
  }, [zkpPhase, oauth2Phase]);

  const handleExecute = () => {
    resetPanels();
    setOauth2Phase("dim");
    setZkpPhase("idle");
  };

  const handleReplay = () => {
    if (replayDebounce) return;
    setReplayDebounce(true);
    resetPanels();
    handleExecute();
    replayTimeoutRef.current = setTimeout(() => setReplayDebounce(false), 1500);
  };

  const animationDone = oauth2Phase === "done" && zkpPhase === "done";
  const authInfo = latestResult?.auth_info;
  const token = authInfo?.type === "oauth2" ? authInfo.token : authInfo?.proof;
  const hasToken = !!token;

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
              fontSize: "12px",
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
          {ATTACK_TYPES.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => {
                setAttackType(key);
              }}
              style={{
                flex: "1 1 140px",
                padding: "6px var(--space-3)",
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
                  fontSize: "11px",
                  fontWeight: 700,
                  color:
                    attackType === key
                      ? "var(--color-attack)"
                      : "var(--color-text)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{icon}</span> {label}
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
              fontSize: "12px",
              marginBottom: "var(--space-3)",
            }}
          >
            Send a message in Chat to load a token for simulation.
          </div>
        ) : (
          <div
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-muted)",
              marginBottom: "var(--space-3)",
              wordBreak: "break-all",
            }}
          >
            Token: {token.slice(0, 24)}...
          </div>
        )}

        {/* Split panels */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
            minHeight: 0,
          }}
        >
          {/* OAuth2 breach panel */}
          <div
            style={{
              borderTop: "3px solid var(--color-oauth2)",
              border:
                oauth2Phase === "done"
                  ? "1px solid var(--color-attack)"
                  : "1px solid var(--color-border)",
              borderRadius: "var(--border-radius-md)",
              background: "var(--color-surface)",
              overflow: "hidden",
              opacity: oauth2Phase === "idle" ? 1 : 0.7,
              transition: "opacity 0.15s ease",
              position: "relative",
              padding: "var(--space-3)",
              minHeight: "120px",
            }}
          >
            {oauth2Phase === "flash" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(239,68,68,0.3)",
                  animation: "fadeOut 0.15s ease forwards",
                }}
              />
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: "11px",
                color: "var(--color-oauth2)",
                marginBottom: "6px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              OAuth2
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: blinkState ? "var(--color-oauth2)" : "var(--color-text)",
                transition: "color 0.05s ease",
                wordBreak: "break-all",
              }}
            >
              {token ? `"${token.slice(0, 16)}..."` : "(no token)"}
            </div>
            {(oauth2Phase === "exfil" || oauth2Phase === "done") && (
              <div
                style={{
                  marginTop: "6px",
                  display: "inline-block",
                  background: "var(--color-attack)",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "10px",
                  letterSpacing: "0.05em",
                }}
              >
                EXFILTRATED
              </div>
            )}
            {oauth2Phase === "done" && (
              <button
                onClick={handleReplay}
                disabled={replayDebounce}
                style={{
                  marginTop: "8px",
                  padding: "4px 10px",
                  background: replayDebounce
                    ? "var(--color-muted)"
                    : "var(--color-attack)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: 600,
                  fontSize: "11px",
                  cursor: replayDebounce ? "not-allowed" : "pointer",
                  opacity: replayDebounce ? 0.7 : 1,
                }}
              >
                Replay
              </button>
            )}
          </div>

          {/* ZKP protection panel */}
          <div
            style={{
              borderTop: "3px solid var(--color-zkp)",
              border:
                zkpPhase === "done"
                  ? "1px solid var(--color-zkp)"
                  : "1px solid var(--color-border)",
              borderRadius: "var(--border-radius-md)",
              background: "var(--color-surface)",
              overflow: "hidden",
              position: "relative",
              padding: "var(--space-3)",
              minHeight: "120px",
            }}
          >
            {zkpPhase === "pulse" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "rgba(16,185,129,0.3)",
                    animation: "pulse-scale 0.4s ease forwards",
                  }}
                />
              </div>
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: "11px",
                color: "var(--color-zkp)",
                marginBottom: "6px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              ZKP
            </div>
            {(zkpPhase === "check" ||
              zkpPhase === "label" ||
              zkpPhase === "done") && (
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: "var(--color-zkp)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontWeight: 700,
                  fontSize: "13px",
                  marginBottom: "6px",
                  animation: "fadeIn 0.3s ease forwards",
                }}
              >
                &#10003;
              </div>
            )}
            {(zkpPhase === "label" || zkpPhase === "done") && (
              <div
                style={{
                  background: "var(--color-zkp-muted)",
                  border: "1px solid var(--color-zkp)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--color-zkp)",
                  letterSpacing: "0.03em",
                }}
              >
                PROOF ACCEPTED
              </div>
            )}
          </div>
        </div>

        {/* Execute / Reset */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginBottom: showForensics ? "var(--space-3)" : 0,
          }}
        >
          <button
            onClick={handleExecute}
            disabled={!hasToken || oauth2Phase !== "idle"}
            style={{
              flex: 1,
              padding: "8px",
              background:
                !hasToken || oauth2Phase !== "idle"
                  ? "var(--color-muted)"
                  : "var(--color-attack)",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: 700,
              fontSize: "13px",
              cursor:
                !hasToken || oauth2Phase !== "idle" ? "not-allowed" : "pointer",
              opacity: !hasToken || oauth2Phase !== "idle" ? 0.6 : 1,
            }}
          >
            Execute
          </button>
          {animationDone && (
            <button
              onClick={resetPanels}
              style={{
                padding: "8px 12px",
                background: "transparent",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Forensics cards */}
        {showForensics && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--space-2)",
              marginBottom: "var(--space-3)",
            }}
          >
            <div
              style={{
                border: "1px solid var(--color-attack)",
                borderRadius: "var(--border-radius-md)",
                padding: "var(--space-3)",
                background: "var(--color-attack-muted)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "11px",
                  color: "var(--color-attack)",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                DATA EXFILTRATED
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                Token replay possible until expiry
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--color-zkp)",
                borderRadius: "var(--border-radius-md)",
                padding: "var(--space-3)",
                background: "var(--color-zkp-muted)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "11px",
                  color: "var(--color-zkp)",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                NO DATA EXPOSED
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                Proof useless without password
              </div>
            </div>
          </div>
        )}

        {/* Timing bar chart */}
        {showForensics && (
          <div
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--border-radius-md)",
              padding: "var(--space-3)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "11px",
                color: "var(--color-text)",
                marginBottom: "var(--space-2)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Timing
            </div>
            <div style={{ marginBottom: "6px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-attack)",
                    fontWeight: 600,
                  }}
                >
                  OAuth2
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-muted)",
                  }}
                >
                  ~850ms
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  background: "var(--color-border)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "95%",
                    height: "100%",
                    background: "var(--color-attack)",
                    borderRadius: "3px",
                  }}
                />
              </div>
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-zkp)",
                    fontWeight: 600,
                  }}
                >
                  ZKP
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-muted)",
                  }}
                >
                  ~200ms
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  background: "var(--color-border)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "22%",
                    height: "100%",
                    background: "var(--color-zkp)",
                    borderRadius: "3px",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AttackPanel;