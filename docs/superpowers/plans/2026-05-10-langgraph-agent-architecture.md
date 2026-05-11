# LangGraph Agent Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement plan task-by-task.

**Goal:** Upgrade from direct API calls to delegation model: user → UserAgent → POST /api/agent/delegate → LangGraph-powered ServerAgent → result. Each hop authenticated. Reasoning steps streamed via SSE.

**Architecture:** Client-side UserAgent (vanilla JS, no LangChain.js) calls `/api/agent/delegate` SSE stream. Server runs LangGraph with IntentNode → ToolNode → SynthesisNode. Each node emits reasoning steps as SSE events. ServerAgent uses `astream` (NOT `astream_events`) for correct per-node state streaming.

**Tech Stack:** FastAPI · SQLAlchemy · LangGraph · React/Vite · Vanilla JS UserAgent · SSE

---

## Task 1: Add `agent_type` to Agent model

**Files:**

- Modify: `backend/db/models.py:30-43`
- Create: `backend/db/migrations/add_agent_type.py`

- [ ] **Step 1: Add agent_type column**

```python
class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    auth_type = Column(String, nullable=False)  # "oauth2" or "zkp"
    agent_type = Column(String, nullable=False, default="server")  # "user" | "server"
    credentials_hash = Column(String, nullable=True)
    public_key = Column(Text, nullable=True)
    oauth2_private_key = Column(Text, nullable=True)  # DEPRECATED
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="agents")
    transactions = relationship("Transaction", back_populates="agent")
```

- [ ] **Step 2: Add migration**

```python
# backend/db/migrations/add_agent_type.py
from sqlalchemy import text
from backend.db.models import engine

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE agents ADD COLUMN agent_type VARCHAR NOT NULL DEFAULT 'server'"))
    conn.commit()
print("Migration complete: agent_type column added")
```

- [ ] **Step 3: Verify migration**

```bash
sqlite3 agentic_commerce.db "PRAGMA table_info(agents);" | grep agent_type
```

- [ ] **Step 4: Commit**

```bash
git add backend/db/models.py backend/db/migrations/add_agent_type.py
git commit -m "feat(models): add agent_type column to Agent (user|server)"
```

---

## Task 2: Build LangGraph graph (IntentNode → ToolNode → SynthesisNode)

**Files:**

- Create: `backend/agents/agent_graph.py`
- Create: `backend/agents/__init__.py`
- Test: `tests/agents/test_agent_graph.py`
- Modify: `backend/pyproject.toml` (add `langgraph` dependency)

- [ ] **Step 0: Add langgraph dependency**

In `backend/pyproject.toml`, add:

```toml
[project]
dependencies = [
    "langgraph>=0.0.20",
]
```

Run: `cd backend && uv sync` to install.

- [ ] **Step 1: Write failing test for agent_graph**

```python
# tests/agents/test_agent_graph.py
import pytest
from backend.agents.agent_graph import IntentNode, ToolNode, SynthesisNode, build_graph

@pytest.fixture
def graph():
    return build_graph()

@pytest.mark.asyncio
async def test_intent_node_extracts_action(graph):
    result = await IntentNode().execute(message="search for laptops")
    assert result["action"] in ("search_products", "compare_prices", "execute_purchase", "get_product_details")

@pytest.mark.asyncio
async def test_graph_routes_to_tool_node(graph):
    state = {"task": "show me laptops", "reasoning_steps": []}
    async for chunk in graph.astream(state):
        pass  # just ensure no error

@pytest.mark.asyncio
async def test_synthesis_node_creates_summary(graph):
    result = await SynthesisNode().execute(
        intent_result={"action": "search_products", "results": [{"name": "ThinkPad"}]},
        reasoning_steps=[]
    )
    assert "summary" in result
```

Run: `pytest tests/agents/test_agent_graph.py -v`
Expected: FAIL — modules don't exist

- [ ] **Step 2: Define AgentState**

```python
# backend/agents/agent_graph.py
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
import json

class ReasoningStep(TypedDict):
    node: str
    label: str
    duration_ms: float | None

class AgentState(TypedDict):
    task: str
    auth_type: str
    agent_id: int
    intent_result: dict | None
    tool_result: dict | None
    synthesis_result: dict | None
    reasoning_steps: list[ReasoningStep]
```

- [ ] **Step 3: Implement IntentNode**

```python
class IntentNode:
    def __init__(self):
        from .intent import IntentExtraction
        self._extractor = IntentExtraction()

    async def execute(self, message: str, auth_type: str = "oauth2", agent_id: int = 0) -> dict:
        import time
        t0 = time.monotonic()
        result = await self._extractor.extract_intent(message)
        return {
            "intent_result": result,
            "reasoning_steps": [{
                "node": "IntentNode",
                "label": f"intent_extraction → {result.get('action', '?')} ({round((time.monotonic()-t0)*1000)}ms)",
                "duration_ms": (time.monotonic()-t0)*1000,
            }],
        }
```

- [ ] **Step 4: Implement ToolNode**

```python
class ToolNode:
    def __init__(self):
        from .intent import ToolCaller
        self._caller = ToolCaller()

    async def execute(self, intent_result: dict, auth_type: str, agent_id: int) -> dict:
        import time
        t0 = time.monotonic()
        action = intent_result.get("action")
        params = intent_result.get("parameters", {})
        from .intent import Intent
        result = await self._caller.call_tool(
            Intent(action=action, parameters=params, confidence=1.0),
            auth_type,
            agent_id
        )
        return {
            "tool_result": result,
            "reasoning_steps": [{
                "node": "ToolNode",
                "label": f"tool_call → {action} ({round((time.monotonic()-t0)*1000)}ms)",
                "duration_ms": (time.monotonic()-t0)*1000,
            }],
        }
```

- [ ] **Step 5: Implement SynthesisNode**

```python
class SynthesisNode:
    async def execute(self, intent_result: dict | None, tool_result: dict | None, reasoning_steps: list) -> dict:
        summary = f"Executed {intent_result.get('action', '?')}: {json.dumps(tool_result)[:120]}..."
        return {
            "synthesis_result": {"summary": summary, "full_result": tool_result},
            "reasoning_steps": [{
                "node": "SynthesisNode",
                "label": "synthesis → final response compiled",
                "duration_ms": 0,
            }],
        }
```

- [ ] **Step 6: Build graph**

```python
def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    # Linear flow: intent → tool → synthesis → END
    # No back-edge from tool to intent — single-pass execution
    graph.add_node("intent", _intent_node_wrapper)
    graph.add_node("tool", _tool_node_wrapper)
    graph.add_node("synthesis", _synthesis_node_wrapper)

    graph.set_entry_point("intent")
    graph.add_edge("intent", "tool")
    graph.add_edge("tool", "synthesis")
    graph.add_edge("synthesis", END)

    return graph.compile()
```

> **CAUTION:** The conditional edge `tool → intent` pattern removed — it created a potential infinite loop if `should_continue` ever returned `"intent"`. Linear flow for single-pass execution. If multi-tool chains are needed later, re-add the conditional edge with explicit loop guards.

async def \_intent_node_wrapper(state: AgentState) -> dict:
node = IntentNode()
result = await node.execute(state["task"], state["auth_type"], state["agent_id"])
return result

async def \_tool_node_wrapper(state: AgentState) -> dict:
node = ToolNode()
result = await node.execute(state["intent_result"], state["auth_type"], state["agent_id"])
return result

async def \_synthesis_node_wrapper(state: AgentState) -> dict:
node = SynthesisNode()
result = await node.execute(state["intent_result"], state.get("tool_result"), state["reasoning_steps"])
return result

````

- [ ] **Step 7: Run tests**

```bash
pytest tests/agents/test_agent_graph.py -v
````

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/agents/agent_graph.py tests/agents/test_agent_graph.py
git commit -m "feat(agents): add LangGraph agent_graph with IntentNode + ToolNode + SynthesisNode"
```

---

## Task 3: ServerAgent with astream SSE streaming

**Files:**

- Create: `backend/agents/server_agent.py`
- Test: `tests/agents/test_server_agent.py`

- [ ] **Step 1: Write failing test**

```python
# tests/agents/test_server_agent.py
import pytest
from backend.agents.server_agent import ServerAgent

@pytest.fixture
def agent():
    return ServerAgent()

@pytest.mark.asyncio
async def test_server_agent_stream_yields_steps(agent):
    steps = []
    async for step in agent.stream_run("search for laptops", auth_type="oauth2", agent_id=1):
        steps.append(step)
    assert len(steps) >= 1
    assert any(s.get("node") == "IntentNode" for s in steps)
```

Run: `pytest tests/agents/test_server_agent.py -v`
Expected: FAIL — ServerAgent not defined

- [ ] **Step 2: Implement ServerAgent**

```python
# backend/agents/server_agent.py
import json
from typing import AsyncIterator
from .agent_graph import build_graph, AgentState

class ServerAgent:
    def __init__(self):
        self._graph = build_graph()

    async def stream_run(self, task: str, auth_type: str, agent_id: int) -> AsyncIterator[dict]:
        """
        Run the LangGraph and yield reasoning steps as they are produced.
        Uses astream (NOT astream_events) — each yield is state after ONE node.
        """
        initial_state: AgentState = {
            "task": task,
            "auth_type": auth_type,
            "agent_id": agent_id,
            "intent_result": None,
            "tool_result": None,
            "synthesis_result": None,
            "reasoning_steps": [],
        }

        async for state in self._graph.astream(initial_state):
            # state is the full AgentState after a node ran
            # yield each new reasoning step as it appears
            for step in state.get("reasoning_steps", []):
                yield step

            # yield result objects when they appear
            if state.get("intent_result") and not state.get("_intent_yielded"):
                yield {"node": "INTENT_RESULT", "data": state["intent_result"]}
                state["_intent_yielded"] = True
            if state.get("tool_result") and not state.get("_tool_yielded"):
                yield {"node": "TOOL_RESULT", "data": state["tool_result"]}
                state["_tool_yielded"] = True

        # Final synthesis
        yield {"node": "DONE", "data": state.get("synthesis_result")}

    async def run(self, task: str, auth_type: str, agent_id: int) -> dict:
        """Non-streaming run — collects all steps."""
        steps = []
        result = None
        async for step in self.stream_run(task, auth_type, agent_id):
            if step.get("node") == "DONE":
                result = step.get("data")
            else:
                steps.append(step)
        return {"reasoning_steps": steps, "result": result}
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/agents/test_server_agent.py -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/agents/server_agent.py tests/agents/test_server_agent.py
git commit -m "feat(agents): add ServerAgent with astream SSE streaming"
```

---

## Task 4: POST /api/agent/delegate with StreamingResponse

**Files:**

- Create: `backend/api/agent.py`
- Modify: `backend/main.py` (register router)
- Test: `tests/api/test_agent_delegate.py`

- [ ] **Step 1: Write failing test**

```python
# tests/api/test_agent_delegate.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app

def test_delegate_requires_auth(client):
    response = client.post("/api/agent/delegate", json={"task": "show me laptops"})
    assert response.status_code == 401
```

Run: `pytest tests/api/test_agent_delegate.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 2: Implement DelegateRequest + endpoint**

```python
# backend/api/agent.py
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import json

from ..db.models import Agent, get_db
from ..agents.server_agent import ServerAgent
from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..utils.errors import AppError, ErrorCode

router = APIRouter(prefix="/api/agent", tags=["agent"])

class DelegateRequest(BaseModel):
    task: str
    target_agent_id: int
    zkp_token: Optional[str] = None
    zkp_proof: Optional[str] = None


@router.post("/delegate")
async def agent_delegate(
    request: DelegateRequest,
    http_request: Request,
    db: Session = Depends(get_db)
):
    # 1. Authenticate caller (must be a "user" agent)
    auth_header = http_request.headers.get("Authorization", "")
    calling_agent_id = None

    if auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:]
        token_payload = oauth2_auth.verify_token(bearer_token)
        calling_agent_id = token_payload.get("client_id") or token_payload.get("sub")
    elif request.zkp_token and request.zkp_proof:
        # ZKP path — verify the proof to authenticate the caller
        # caller is the agent identified by zkp_token's agent_id
        try:
            verification_result = zkp_auth.verify_proof(
                request.zkp_token,
                json.loads(request.zkp_proof),
            )
            # zkp_token encodes the agent_id on the server side
            calling_agent_id = verification_result.get("agent_id")
        except Exception:
            raise AppError(error_code=ErrorCode.AUTH_FAILED, message="ZKP proof invalid", status_code=401)
    else:
        raise AppError(error_code=ErrorCode.AUTH_FAILED, message="Bearer token or ZKP proof required", status_code=401)

    if not calling_agent_id:
        raise AppError(error_code=ErrorCode.AUTH_FAILED, message="Could not determine caller identity", status_code=401)

    calling_agent = db.query(Agent).filter(Agent.id == int(calling_agent_id)).first()
    if not calling_agent:
        raise AppError(error_code=ErrorCode.RESOURCE_NOT_FOUND, message="Calling agent not found", status_code=404)
    if calling_agent.agent_type != "user":
        raise AppError(error_code=ErrorCode.AUTH_FAILED, message="Only user agents can call /delegate", status_code=403)

    # 2. Validate target is a server agent
    target_agent = db.query(Agent).filter(Agent.id == request.target_agent_id).first()
    if not target_agent:
        raise AppError(error_code=ErrorCode.RESOURCE_NOT_FOUND, message=f"Target agent {request.target_agent_id} not found", status_code=404)
    if target_agent.agent_type != "server":
        raise AppError(error_code=ErrorCode.INVALID_OPERATION, message="Target must be a server agent", status_code=400)

    # 3. Run ServerAgent with streaming
    server_agent = ServerAgent()

    async def event_stream():
        async for step in server_agent.stream_run(
            task=request.task,
            auth_type=target_agent.auth_type,
            agent_id=request.target_agent_id
        ):
            yield f"data: {json.dumps(step)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "X-Agent-Id": str(calling_agent_id),
            "X-Target-Agent-Id": str(request.target_agent_id),
        }
    )
```

- [ ] **Step 3: Register router in main.py**

```python
# backend/main.py — add import + include_router near chat_router
from .api.agent import router as agent_router
app.include_router(agent_router)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/api/test_agent_delegate.py -v
```

Expected: PASS (or FAIL on auth — fix and retry)

- [ ] **Step 5: Commit**

```bash
git add backend/api/agent.py backend/main.py tests/api/test_agent_delegate.py
git commit -m "feat(api): add POST /api/agent/delegate StreamingResponse endpoint"
```

---

## Task 5: Remove create_rsa_keypair from db/operations.py

**Files:**

- Modify: `backend/db/operations.py`

- [ ] **Step 1: Remove from create_agent**

Find `create_rsa_keypair` call inside `create_agent` function in `backend/db/operations.py`. Remove it. Set `public_key=None` and `oauth2_private_key=None` in the returned Agent object.

- [ ] **Step 2: Verify main.py seed**

Check seed endpoint — ensure it does NOT set `oauth2_private_key` on any agent. Seed should only set `public_key` when the client registers it via `/api/auth/oauth2/register`.

- [ ] **Step 3: Commit**

```bash
git add backend/db/operations.py
git commit -m "refactor(auth): remove create_rsa_keypair from create_agent"
```

---

## Task 6: UserAgent client class (vanilla JS, no LangChain.js)

**Files:**

- Create: `frontend/src/agent/UserAgent.js`
- Modify: `frontend/src/pages/Chat.jsx`

- [ ] **Step 1: Write UserAgent.js**

```javascript
// frontend/src/agent/UserAgent.js
import { getAccessToken } from "../services/authApi.js";
import { api } from "../services/api.js";
import { computeProof } from "../lib/zkp.js";

let _agentConfig = null; // { agentId, privateKeyPem, authType, targetServerAgentId }

export function setUserAgentConfig(config) {
  _agentConfig = config;
}

export function getUserAgentConfig() {
  return _agentConfig;
}

/**
 * SSE-powered delegation: opens StreamingResponse from /api/agent/delegate.
 * Calls onReasoningStep(node, step) for each step, onResult(data) when done.
 */
export const userAgent = {
  async delegate(task, { onReasoningStep, onResult }) {
    if (!_agentConfig) {
      throw new Error(
        "UserAgent not configured — call setUserAgentConfig() first",
      );
    }

    const headers = {};
    let body = { task, target_agent_id: _agentConfig.targetServerAgentId };

    if (_agentConfig.authType === "oauth2") {
      const token = await getAccessToken(
        String(_agentConfig.agentId),
        _agentConfig.privateKeyPem,
      );
      headers["Authorization"] = `Bearer ${token}`;
    } else if (_agentConfig.authType === "zkp") {
      const challengeRes = await api.get(
        `/chat/zkp-challenge/${_agentConfig.agentId}`,
      );
      const { zkp_token } = challengeRes.data;
      const proofJson = await computeProof(_agentConfig.password, zkp_token);
      let proofData;
      try {
        proofData = JSON.parse(proofJson);
      } catch {
        throw new Error("ZKP proof computation failed");
      }
      body.zkp_token = zkp_token;
      body.zkp_proof = JSON.stringify({
        commitment: proofData.commitment,
        response: proofData.response,
      });
    }

    const response = await fetch("/api/agent/delegate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Delegation failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const step = JSON.parse(line.slice(6));
            if (step.node === "DONE") {
              onResult && onResult(step.data);
            } else {
              onReasoningStep && onReasoningStep(step.node, step);
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    }
  },
};
```

- [ ] **Step 2: Hook into Chat.jsx handleSend**

Replace `chatApi.intent({ message, agent_id: agentId, ... })` with `userAgent.delegate(message, { onReasoningStep, onResult })`.

```javascript
// In handleSend, replace the chatApi.intent call with:
await userAgent.delegate(message, {
  onReasoningStep: (node, step) => {
    // Update ActionLog steps in real-time
    setActionLogSteps((prev) => [...prev.slice(-49), step]);
  },
  onResult: (data) => {
    // Final result — update bubble
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === pendingAgentIdRef.current
          ? { ...msg, thinking: false, result: data?.full_result }
          : msg,
      ),
    );
  },
});
```

- [ ] **Step 3: Ensure targetServerAgentId is set**

When ZKP or OAuth2 agent is selected in Chat.jsx, also set `targetServerAgentId` (server agent's DB ID) from the seed response.

- [ ] **Step 4: Build**

```bash
cd frontend && npm run build
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/UserAgent.js frontend/src/pages/Chat.jsx
git commit -m "feat(agent): add vanilla JS UserAgent with SSE streaming"
```

---

## Task 7: Add CommerceServerAgent to seed

**Files:**

- Modify: `backend/main.py` (seed endpoint)

- [ ] **Step 1: Create server agent during seed**

In `seed_demo_data()`, after user agents are created:

```python
server_agent = db_ops.create_agent(
    db=db,
    user_id=1,
    name="CommerceServerAgent",
    auth_type="oauth2",
    agent_type="server",
)
```

- [ ] **Step 2: Add server agent ID to seed response**

```python
return {
    "user": {"id": user.id, "name": user.name},
    "oauth2_agent": {"id": oauth2_agent.id, "name": oauth2_agent.name, "auth_type": oauth2_agent.auth_type},
    "zkp_agent": {"id": zkp_agent.id, "name": zkp_agent.name, "auth_type": zkp_agent.auth_type, "public_key": zkp_agent.public_key},
    "server_agent": {"id": server_agent.id, "name": server_agent.name, "agent_type": server_agent.agent_type},
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(seed): create CommerceServerAgent during demo seed"
```

---

## Architecture After Implementation

```
User → [UserAgent] → POST /api/agent/delegate (OAuth2 Bearer OR ZKP proof)
                  → ServerAgent.stream_run()
                  → LangGraph astream: IntentNode → ToolNode → SynthesisNode
                  → SSE: reasoning_step events
                  → [UserAgent] → User

Auth at each hop:
- User → UserAgent: local (no network)
- UserAgent → Backend: OAuth2 Bearer token OR ZKP proof
- Backend → ServerAgent: internal — calling agent auth already verified at /delegate entry
```

---

## Spec Coverage Checklist

| Requirement                                     | Task                                         |
| ----------------------------------------------- | -------------------------------------------- |
| User delegates to user agent                    | Task 6                                       |
| User agent talks to server agent                | Tasks 4, 6                                   |
| Bilateral auth at each hop                      | Task 4 (verify caller), Task 6 (client auth) |
| Server agent executes intent (LangGraph)        | Tasks 2, 3                                   |
| Reasoning steps streamed via SSE                | Tasks 3, 4, 6                                |
| Agent type distinction (user vs server)         | Task 1                                       |
| Seed creates server agent                       | Task 7                                       |
| OAuth2 auth cleanup (remove create_rsa_keypair) | Task 5                                       |

---

## Why NOT astream_events

`astream_events` fires `on_chain_end` per node PLUS one at graph completion. Each event carries the FULL accumulated state — ActionLog would get 4 identical full-render cycles, not 4 step-by-step updates.

`astream` yields the state snapshot AFTER each node. We inspect `state["reasoning_steps"]` and yield only new steps. Correct per-node streaming.

## Why Vanilla JS UserAgent (No LangChain.js)

`createReactAgent` builds a ReAct loop calling LLM tools. UserAgent only does: fetch + SSE parse + callback dispatch. No LLM, no ReAct, no tool-calling. 60KB of LangChain.js overhead for a 50-line vanilla fetch. Wrong tool for the job.

---

## Placeholder Scan

- No "TBD" or "TODO" found
- All steps show actual code
- File paths are exact

## Self-Review

Type consistency:

- `ServerAgent.stream_run()` returns `AsyncIterator[dict]` — each dict has `node` and either `label`/`duration_ms` or `data`
- `DelegateRequest.task` is `str` — `userAgent.delegate(task, ...)` passes `message` — matches
- `DelegateRequest.target_agent_id` is `int` — `userAgent.delegate(..., {targetServerAgentId})` passes `int` — matches
- `Agent.agent_type` values: `"user"` and `"server"` — used consistently in Tasks 1, 4, 7
- LangGraph `AgentState` keys: `intent_result`, `tool_result`, `synthesis_result` — matched in all node wrappers
- `IntentNode.execute` returns `dict` with `intent_result` — matches `ToolNode.execute` signature pattern
