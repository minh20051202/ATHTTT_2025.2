import { useState, useEffect, useRef } from "react";
import { useAgents } from "../context/AgentsContext.jsx";
import { useChatHistory } from "../context/ChatHistoryContext.jsx";
import { setAgentConfig } from "../services/chatApi.js";
import { demoApi } from "../services/demoApi.js";
import { generateKeyPair } from "../lib/zkp.js";
import { generateRSAKeyPair } from "../lib/oauth2.js";
import UserAgent from "../agent/UserAgent.js";
import ChatThread from "../components/ChatThread.jsx";
import ComputationSidebar from "../components/ComputationSidebar.jsx";

// ---------------------------------------------------------------------------
// Main Chat component
// ---------------------------------------------------------------------------

let _messageId = (() => {
  try {
    return parseInt(sessionStorage.getItem("chat_message_id") || "0", 10);
  } catch {
    return 0;
  }
})();
function nextId() {
  const id = ++_messageId;
  try { sessionStorage.setItem("chat_message_id", String(id)); } catch {}
  return id;
}

export default function Chat() {
  const { agents, loading: agentsLoading } = useAgents();
  const { storeResult, resultsByAuth } = useChatHistory();

  const [authType, setAuthType] = useState("oauth2");
  const [attackMode, setAttackMode] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [messages, setMessages] = useState(() => {
    try {
      // Hard reload clears messages (sessionStorage dies with the tab)
      // Back/forward navigation restores them (bfcache restores sessionStorage)
      const stored = sessionStorage.getItem("chat_messages");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [oauth2Credentials, setOauth2Credentials] = useState(null);
  const [zkpCredentials, setZkpCredentials] = useState(null);
  const [liveReasoningSteps, setLiveReasoningSteps] = useState([]);
  const [setupReady, setSetupReady] = useState(false);

  // Persist messages to sessionStorage so they survive navigation
  useEffect(() => {
    try {
      sessionStorage.setItem("chat_messages", JSON.stringify(messages));
    } catch {}
  }, [messages]);

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
        const serverAgent = seedRes?.data?.server_agent;
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
        if (serverAgent?.id) {
          sessionStorage.setItem(
            "demo_agents",
            JSON.stringify({
              oauth2AgentId: agentId,
              zkpAgentId: seedRes?.data?.zkp_agent?.id,
              serverAgentId: serverAgent.id,
            }),
          );
        }
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
        const serverAgent = seedRes?.data?.server_agent;
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
        if (serverAgent?.id) {
          sessionStorage.setItem(
            "demo_agents",
            JSON.stringify({
              oauth2AgentId: seedRes?.data?.oauth2_agent?.id,
              zkpAgentId,
              serverAgentId: serverAgent.id,
            }),
          );
        }
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
        targetServerAgentId: agents?.serverAgentId,
      });
    } else if (authType === "zkp" && zkpCredentials) {
      setAgentConfig({
        authType: "zkp",
        privateKey: zkpCredentials.privateKey,
        agentId: zkpCredentials.id,
        targetServerAgentId: agents?.serverAgentId,
      });
    } else if (authType === "zkp") {
      setAgentConfig({ authType: "zkp" });
    } else {
      setAgentConfig({ authType: "oauth2" });
    }
  }, [authType, oauth2Credentials, zkpCredentials, agents?.serverAgentId]);

  const handleSend = async () => {
    if (!message.trim() || !agents || !setupReady) return;
    if (authType === "oauth2" && !oauth2Credentials) return;
    if (authType === "zkp" && !zkpCredentials) return;
    if (!agents.serverAgentId) {
      setChatError("Missing target server agent id. Re-seed the demo data after backend support is available.");
      return;
    }

    const task = message.trim();
    const userMsg = {
      id: nextId(),
      role: "user",
      content: task,
      timestamp: Date.now(),
    };
    const amId = nextId();
    pendingAgentIdRef.current = amId;
    const agentMsg = {
      id: amId,
      role: "agent",
      thinking: true,
      status: "Preparing agent request",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setMessage("");
    setSending(true);
    setChatError(null);
    setLiveReasoningSteps([]);

    try {
      const agentId =
        authType === "oauth2" ? oauth2Credentials.id : zkpCredentials.id;
      const userAgent = new UserAgent({
        agentId,
        authType,
        privateKeyPem: oauth2Credentials?.privateKey,
        privateKey: zkpCredentials?.privateKey,
        targetServerAgentId: agents.serverAgentId,
      });

      const res = await userAgent.delegate(task, {
        onEvent: ({ event, data }) => {
          if (event === "processing") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, status: data?.label || "Processing request" }
                  : msg,
              ),
            );
          } else if (event === "auth") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, status: "Authenticated. Processing request" }
                  : msg,
              ),
            );
          } else if (event === "reasoning") {
            setLiveReasoningSteps((prev) => [...prev.slice(-49), data]);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, status: data?.label || "Processing" }
                  : msg,
              ),
            );
          } else if (event === "intent_result") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, intent: data, status: "Intent resolved. Running tool" }
                  : msg,
              ),
            );
          } else if (event === "tool_result") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, result: data, status: "Tool returned. Finalizing" }
                  : msg,
              ),
            );
          } else if (event === "done") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === pendingAgentIdRef.current
                  ? { ...msg, thinking: false }
                  : msg,
              ),
            );
          }
        },
      });

      const { intent, result: execResult, timing, auth_info } = res;
      const resultData = {
        intent,
        result: execResult,
        auth_info,
        timing,
      };
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
      storeResult(resultData);
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
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%' }}>
        <div className="auth-tabs">
          {[
            {
              key: "oauth2",
              label: "OAuth2 Agent",
            },
            {
              key: "zkp",
              label: "ZKP Agent",
            },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setAuthType(key)}
              className={`auth-tab ${authType === key ? 'active' : ''}`}
              style={{
                color: authType === key 
                  ? (key === 'zkp' ? 'var(--color-zkp)' : 'var(--color-oauth2)') 
                  : 'var(--color-muted)'
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

      <ComputationSidebar
        authType={authType}
        latestResult={resultsByAuth?.[authType] ?? null}
        messageCount={messages.length}
        oauth2Credentials={oauth2Credentials}
        zkpCredentials={zkpCredentials}
        liveReasoningSteps={liveReasoningSteps}
      />
    </div>
  );
}
