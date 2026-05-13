import { useState, useEffect, useRef } from "react";
import { useAgents } from "../context/AgentsContext.jsx";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { chatApi, setAgentConfig } from "../services/chatApi.js";
import { getAccessToken } from "../services/authApi.js";
import { demoApi } from "../services/demoApi.js";
import { generateKeyPair, signWithPrivateKeyHex } from "../lib/zkp.js";
import { generateRSAKeyPair } from "../lib/oauth2.js";
import ChatThread from "../components/ChatThread.jsx";
import ComputationSidebar from "../components/ComputationSidebar.jsx";
import AttackPanel from "../components/AttackPanel.jsx";

// ---------------------------------------------------------------------------
// Main Chat component
// ---------------------------------------------------------------------------

let _messageId = 0;
function nextId() {
  return ++_messageId;
}

export default function Chat() {
  const { agents, loading: agentsLoading } = useAgents();
  const { storeResult, latestResult, resultsByAuth } = useChatHistory();

  const [authType, setAuthType] = useState("oauth2");
  const [attackMode, setAttackMode] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [oauth2Credentials, setOauth2Credentials] = useState(null);
  const [zkpCredentials, setZkpCredentials] = useState(null);
  const [setupReady, setSetupReady] = useState(false);

  const pendingAgentIdRef = useRef(null);

  // Restore OAuth2 credentials from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("demo_oauth2_creds");
    if (stored) {
      try {
        const { id, privateKey } = JSON.parse(stored);
        window._demoOAuth2AgentId = id;
        window._demoPrivateKey = privateKey;
        setOauth2Credentials({ id, privateKey });
        setSetupReady(true);
      } catch {
        sessionStorage.removeItem("demo_oauth2_creds");
      }
    }
  }, []);

  // Seed + keypair registration (one-time)
  useEffect(() => {
    async function seedAndSetup() {
      try {
        const seedRes = await demoApi.seed();
        const oauth2Agent = seedRes?.data?.oauth2_agent || seedRes?.data;
        const agentId = oauth2Agent?.id;
        if (!agentId) return;

        const { privateKeyPem, publicKeyPem } = await generateRSAKeyPair();
        await demoApi.registerOAuth2PublicKey(agentId, publicKeyPem);

        window._demoOAuth2AgentId = agentId;
        window._demoPrivateKey = privateKeyPem;
        sessionStorage.setItem(
          "demo_oauth2_creds",
          JSON.stringify({
            id: agentId,
            privateKey: privateKeyPem,
          }),
        );
        setOauth2Credentials({ id: agentId, privateKey: privateKeyPem });
        setSetupReady(true);
      } catch (err) {
        console.warn("Seed failed (may already be seeded):", err.message);
      }
    }
    seedAndSetup();
  }, []);

  // ZKP setup: restore stored private key, or generate + register new keypair
  useEffect(() => {
    if (authType !== "zkp") return;

    async function setupZKP() {
      // Always generate fresh keypair on load to avoid stale/incorrect keys.
      // The seed endpoint returns the same agent if already seeded, but we
      // re-register with a newly generated key so the server has the matching public key.
      try {
        const seedRes = await demoApi.seed();
        const zkpAgent = seedRes?.data?.zkp_agent;
        const zkpAgentId = zkpAgent?.id;
        if (!zkpAgentId) return;

        const { privateKey, publicKey } = await generateKeyPair();
        await demoApi.registerZKPPublicKey(zkpAgentId, publicKey);

        sessionStorage.setItem(
          "demo_zkp_creds",
          JSON.stringify({
            id: zkpAgentId,
            privateKey,
          }),
        );
        setZkpCredentials({ id: zkpAgentId, privateKey });
      } catch (err) {
        console.warn("ZKP setup failed:", err.message);
      }
    }

    setupZKP();
  }, [authType]);

  // Update agent config when auth type or credentials change
  useEffect(() => {
    if (authType === "oauth2" && oauth2Credentials) {
      setAgentConfig({
        agentId: oauth2Credentials.id,
        privateKeyPem: oauth2Credentials.privateKey,
        authType: "oauth2",
      });
    } else if (authType === "zkp" && zkpCredentials) {
      setAgentConfig({
        authType: "zkp",
        privateKey: zkpCredentials.privateKey,
        agentId: zkpCredentials.id,
      });
    } else if (authType === "zkp") {
      setAgentConfig({ authType: "zkp" });
    } else {
      setAgentConfig({ authType: "oauth2" });
    }
  }, [authType, oauth2Credentials, zkpCredentials]);

  const handleSend = async () => {
    if (!message.trim() || !agents || !setupReady) return;
    if (authType === "oauth2" && !oauth2Credentials) return;
    if (authType === "zkp" && !zkpCredentials) return;

    const userMsg = {
      id: nextId(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    const amId = nextId();
    pendingAgentIdRef.current = amId;
    const agentMsg = {
      id: amId,
      role: "agent",
      thinking: true,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setMessage("");
    setSending(true);
    setChatError(null);

    try {
      const agentId =
        authType === "oauth2" ? oauth2Credentials.id : zkpCredentials.id;
      let res;

      if (authType === "oauth2") {
        res = await chatApi.intent({ message, agent_id: agentId });
      } else {
        const challengeRes = await chatApi.getZkpChallenge(agentId);
        const { zkp_token } = challengeRes.data;
        const proofJson = await signWithPrivateKeyHex(
          zkpCredentials.privateKey,
          zkp_token,
        );
        res = await chatApi.intent({
          message,
          agent_id: agentId,
          zkp_token,
          zkp_proof: proofJson,
        });
      }

      const { intent, result: execResult, timing, auth_info } = res.data;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === pendingAgentIdRef.current
            ? {
                ...msg,
                thinking: false,
                intent,
                result: execResult,
                auth_info,
                timing,
              }
            : msg,
        ),
      );
      storeResult(res.data);

      if (authType === "oauth2") {
        const bearerToken = await getAccessToken(
          oauth2Credentials.id,
          oauth2Credentials.privateKey,
        );
        setAgentConfig((prev) => ({
          ...prev,
          bearerToken: bearerToken || prev?.bearerToken || "",
          tokenExpAt: 0,
          agentId,
        }));
      }
    } catch (err) {
      setChatError(err.message);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === pendingAgentIdRef.current
            ? { ...msg, thinking: false, error: err.message }
            : msg,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  if (agentsLoading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "60vh",
        }}
      >
        <span
          style={{
            color: "var(--color-oauth2)",
            fontFamily: "var(--font-mono)",
            fontSize: "14px",
          }}
        >
          Connecting to server…
        </span>
      </div>
    );
  }

  return (
    <div className="chat-layout-grid">
      {/* Left: ChatThread */}
      <div
        style={{
          borderRight: "1px solid var(--color-border)",
          paddingRight: "var(--space-4)",
        }}
      >
        {/* Attack mode toggle + auth tabs */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "center",
            marginBottom: "var(--space-4)",
          }}
        >
          {/* Attack mode toggle */}
          <button
            onClick={() => setAttackMode((v) => !v)}
            style={{
              padding: "8px 20px",
              border: "none",
              borderBottom: attackMode
                ? "2px solid var(--color-attack)"
                : "2px solid transparent",
              background: attackMode
                ? "var(--color-attack-muted)"
                : "transparent",
              color: attackMode ? "var(--color-attack)" : "var(--color-muted)",
              fontWeight: 600,
              fontSize: "20px",
              cursor: "pointer",
              transition:
                "background 120ms var(--ease-out), color 120ms var(--ease-out), border-color 120ms var(--ease-out)",
            }}
          >
            Attack Mode
          </button>

          {/* Auth type tabs */}
          {[
            {
              key: "oauth2",
              label: "OAuth2 Agent",
              color: "var(--color-oauth2)",
              muted: "var(--color-oauth2-muted)",
            },
            {
              key: "zkp",
              label: "ZKP Agent",
              color: "var(--color-zkp)",
              muted: "var(--color-zkp-muted)",
            },
          ].map(({ key, label, color, muted }) => (
            <button
              key={key}
              onClick={() => setAuthType(key)}
              style={{
                padding: "9px var(--space-5)",
                border: "none",
                borderBottom:
                  authType === key
                    ? `3px solid ${color}`
                    : "2px solid transparent",
                background: authType === key ? muted : "transparent",
                color: authType === key ? color : "var(--color-muted)",
                fontWeight: 600,
                fontSize: "20px",
                cursor: "pointer",
                transition:
                  "background 120ms var(--ease-out), color 120ms var(--ease-out), border-color 120ms var(--ease-out)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <ChatThread
          authType={authType}
          messages={messages}
          sending={sending}
          onSend={handleSend}
          message={message}
          setMessage={setMessage}
          disabled={!setupReady || (authType === "zkp" && !zkpCredentials)}
        />
      </div>

      {/* Right: AttackPanel or ComputationSidebar */}
      {attackMode ? (
        <AttackPanel />
      ) : (
        <ComputationSidebar
          authType={authType}
          latestResult={resultsByAuth[authType]}
          messageCount={messages.length}
          oauth2Credentials={oauth2Credentials}
          zkpCredentials={zkpCredentials}
        />
      )}
    </div>
  );
}