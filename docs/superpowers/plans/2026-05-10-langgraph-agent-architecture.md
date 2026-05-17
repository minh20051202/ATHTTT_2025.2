# LangGraph Agent Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation, or `superpowers:executing-plans` if working serially.

## Goal

Upgrade chat execution from a direct client-to-tool API call into an explicit delegation model:

```text
User -> browser UserAgent -> POST /api/agent/delegate
     -> authenticated backend delegate endpoint
     -> LangGraph ServerAgent
     -> SSE reasoning/result stream
     -> browser UserAgent -> chat UI
```

Each network hop is authenticated. The backend verifies the caller is a `user` agent, verifies the target is a `server` agent, then runs a LangGraph graph:

```text
IntentNode -> ToolNode -> SynthesisNode -> END
```

The browser UserAgent is plain JavaScript. Do not add LangChain.js to the frontend.

## Current Repo Facts This Plan Must Preserve

- Backend tests live in `backend/tests`, not repo-root `tests`.
- Existing chat API is `backend/api/chat.py` and uses:
  - `oauth2_auth.verify_token(bearer_token)` for OAuth2 Bearer access tokens.
  - ZKP challenge state in `_challenge_store`.
  - `zkp_auth.verify_proof(proof, public_key, token)` returning `(is_valid, verify_time)`.
- Existing `ToolCaller.call_tool(...)` accepts `db`; the LangGraph ToolNode must pass the DB session or product search/purchases fall back to mock data.
- `create_agent` already avoids per-agent RSA private-key generation. Do not reintroduce server-side private-key storage.
- Existing seeded OAuth2/ZKP demo agents are user agents. `agent_type` must therefore default to `"user"`, not `"server"`.
- `frontend/src/services/api.js` uses Axios with `baseURL = "/api"`. Native `fetch` must use the same base path intentionally.

## Architecture Decisions

- Use LangGraph on the backend only.
- Use `graph.astream(..., stream_mode="updates")` so each chunk is the node update that just ran. Do not assume each chunk is a full accumulated state unless `stream_mode="values"` is explicitly used.
- Use a reducer for `reasoning_steps`, otherwise each node update can replace prior steps instead of accumulating them.
- Keep graph execution single-pass for this implementation. No conditional back-edge from ToolNode to IntentNode until there is a loop budget and explicit termination rule.
- Reuse the existing auth semantics instead of inventing a separate proof format for `/delegate`.
- Stream typed SSE events:
  - `event: reasoning`
  - `event: intent_result`
  - `event: tool_result`
  - `event: done`
  - `event: error`

## Task 1: Add `agent_type` to Agent model and operations

**Files**

- Modify: `backend/db/models.py`
- Modify: `backend/db/operations.py`
- Create: `backend/db/migrations/add_agent_type.py`
- Modify tests/fixtures only if needed: `backend/tests/conftest.py`

### Steps

- [ ] Add the column with a user-safe default:

```python
agent_type = Column(String, nullable=False, default="user")  # "user" | "server"
```

- [ ] Update `DatabaseOperations.create_agent`:

```python
def create_agent(
    self,
    db: Session,
    user_id: int,
    name: str,
    auth_type: str,
    public_key: Optional[str] = None,
    credentials_hash: Optional[str] = None,
    agent_type: str = "user",
) -> Agent:
    if agent_type not in ("user", "server"):
        raise ValueError("create_agent: agent_type must be 'user' or 'server'.")
```

Pass `agent_type=agent_type` into every `Agent(...)` construction.

- [ ] Update `DatabaseOperations.upsert_agent` with the same optional `agent_type: str = "user"` argument. Include `Agent.agent_type == agent_type` in the lookup so a user agent and server agent can share an auth type without colliding.

- [ ] Add an idempotent migration:

```python
# backend/db/migrations/add_agent_type.py
from sqlalchemy import inspect, text
from backend.db.models import engine

with engine.begin() as conn:
    columns = {col["name"] for col in inspect(conn).get_columns("agents")}
    if "agent_type" not in columns:
        conn.execute(
            text("ALTER TABLE agents ADD COLUMN agent_type VARCHAR NOT NULL DEFAULT 'user'")
        )

print("Migration complete: agents.agent_type is present")
```

- [ ] Verify:

```bash
uv run --project backend python backend/db/migrations/add_agent_type.py
sqlite3 agentic_commerce.db "PRAGMA table_info(agents);" | grep agent_type
uv run --project backend pytest backend/tests/test_chat.py backend/tests/test_oauth2.py backend/tests/test_zkp.py
```

## Task 2: Extract reusable agent-auth helpers

**Files**

- Create: `backend/api/agent_auth.py`
- Modify: `backend/api/chat.py`
- Test: `backend/tests/api/test_agent_auth.py`

### Rationale

`/api/chat/intent` and `/api/agent/delegate` must authenticate the same user-agent credentials. If `/delegate` implements a separate ZKP path, it will likely skip `_challenge_store`, single-use token consumption, or public-key verification.

### Steps

- [ ] Move challenge validation into a reusable function in `backend/api/chat.py` or `backend/api/agent_auth.py`. Keep `_challenge_store` single-use behavior.

- [ ] Create helpers with this shape:

```python
def verify_oauth2_agent_request(agent: Agent, http_request: Request) -> dict:
    auth_header = http_request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AppError(ErrorCode.AUTH_FAILED, "OAuth2 requires Bearer token", status_code=401)
    bearer_token = auth_header[7:]
    payload = oauth2_auth.verify_token(bearer_token)
    token_agent_id = int(payload.get("sub") or payload.get("client_id") or 0)
    if token_agent_id != agent.id:
        raise AppError(ErrorCode.AUTH_FAILED, "Bearer token agent mismatch", status_code=401)
    return {"type": "oauth2", "agent_id": agent.id, "token_info": oauth2_auth.get_token_info(bearer_token)}


def verify_zkp_agent_request(agent: Agent, zkp_token: str | None, zkp_proof: str | None) -> dict:
    if not agent.public_key:
        raise AppError(ErrorCode.INVALID_OPERATION, "ZKP agent has no public key stored", status_code=500)
    if not zkp_token or not zkp_proof:
        raise AppError(ErrorCode.MISSING_PARAMETER, "zkp_token and zkp_proof required", status_code=400)
    # Validate challenge exists, is unexpired, belongs to agent, and consume it.
    consume_zkp_challenge(agent.id, zkp_token)
    is_valid, verify_time = zkp_auth.verify_proof(zkp_proof, agent.public_key, zkp_token)
    if not is_valid:
        raise AppError(ErrorCode.AUTH_FAILED, "ZKP proof verification failed", status_code=401)
    return {"type": "zkp", "agent_id": agent.id, "verification_time": verify_time}
```

- [ ] Refactor `/api/chat/intent` to call these helpers, preserving the current response fields (`auth_info`, `timing`) so existing tests keep passing.

- [ ] Add tests for token-agent mismatch and ZKP single-use challenge behavior.

## Task 3: Build LangGraph graph

**Files**

- Create: `backend/agents/agent_graph.py`
- Modify: `backend/pyproject.toml` (add `langgraph`)
- Test: `backend/tests/agents/test_agent_graph.py`

### Steps

- [ ] Add dependency:

```toml
"langgraph",
```

Then run:

```bash
uv sync --project backend
```

- [ ] Define state with an accumulating reducer:

```python
from operator import add
from typing import Annotated, Any, TypedDict

class ReasoningStep(TypedDict):
    node: str
    label: str
    duration_ms: float

class AgentState(TypedDict):
    task: str
    auth_type: str
    agent_id: int
    db: Any
    intent_result: dict | None
    tool_result: dict | None
    synthesis_result: dict | None
    reasoning_steps: Annotated[list[ReasoningStep], add]
```

- [ ] Implement nodes against existing `backend/agents/intent.py`.

Important details:

- `IntentExtraction.extract_intent(...)` returns an `Intent` Pydantic model, not a dict.
- `ToolCaller.call_tool(...)` must receive `db=state["db"]`.
- Tool action names are `compare_products`, not `compare_prices`.
- Import `time` in `backend/agents/agent_graph.py`.

```python
class IntentNode:
    def __init__(self, extractor=None):
        from .intent import intent_extractor
        self._extractor = extractor or intent_extractor

    async def execute(self, state: AgentState) -> dict:
        start = time.perf_counter()
        intent = await self._extractor.extract_intent(state["task"])
        duration = (time.perf_counter() - start) * 1000
        return {
            "intent_result": intent.model_dump(),
            "reasoning_steps": [{
                "node": "IntentNode",
                "label": f"intent_extraction -> {intent.action}",
                "duration_ms": duration,
            }],
        }
```

```python
class ToolNode:
    def __init__(self, caller=None):
        from .intent import tool_caller
        self._caller = caller or tool_caller

    async def execute(self, state: AgentState) -> dict:
        from .intent import Intent
        start = time.perf_counter()
        intent = Intent(**state["intent_result"])
        result = await self._caller.call_tool(
            intent,
            state["auth_type"],
            state["agent_id"],
            db=state["db"],
        )
        duration = (time.perf_counter() - start) * 1000
        return {
            "tool_result": result,
            "reasoning_steps": [{
                "node": "ToolNode",
                "label": f"tool_call -> {intent.action}",
                "duration_ms": duration,
            }],
        }
```

- [ ] Add `SynthesisNode`:

```python
class SynthesisNode:
    async def execute(self, state: AgentState) -> dict:
        start = time.perf_counter()
        intent_result = state.get("intent_result") or {}
        tool_result = state.get("tool_result") or {}
        summary = f"Executed {intent_result.get('action', 'unknown')}"
        duration = (time.perf_counter() - start) * 1000
        return {
            "synthesis_result": {
                "summary": summary,
                "full_result": tool_result,
            },
            "reasoning_steps": [{
                "node": "SynthesisNode",
                "label": "synthesis -> final response compiled",
                "duration_ms": duration,
            }],
        }
```

- [ ] Build a linear graph:

```python
from langgraph.graph import END, StateGraph

def build_graph():
    graph = StateGraph(AgentState)
    intent_node = IntentNode()
    tool_node = ToolNode()
    synthesis_node = SynthesisNode()

    graph.add_node("intent", intent_node.execute)
    graph.add_node("tool", tool_node.execute)
    graph.add_node("synthesis", synthesis_node.execute)
    graph.set_entry_point("intent")
    graph.add_edge("intent", "tool")
    graph.add_edge("tool", "synthesis")
    graph.add_edge("synthesis", END)
    return graph.compile()
```

- [ ] Test with mocks so tests do not call NVIDIA NIM:

```bash
uv run --project backend pytest backend/tests/agents/test_agent_graph.py
```

## Task 4: Add ServerAgent streaming wrapper

**Files**

- Create: `backend/agents/server_agent.py`
- Test: `backend/tests/agents/test_server_agent.py`

### Steps

- [ ] Implement `ServerAgent.stream_run(...)`.

Use `stream_mode="updates"` and yield only the update produced by the node that just completed:

```python
class ServerAgent:
    def __init__(self, graph=None):
        self._graph = graph or build_graph()

    async def stream_run(self, task: str, auth_type: str, agent_id: int, db) -> AsyncIterator[dict]:
        initial_state = {
            "task": task,
            "auth_type": auth_type,
            "agent_id": agent_id,
            "db": db,
            "intent_result": None,
            "tool_result": None,
            "synthesis_result": None,
            "reasoning_steps": [],
        }

        final_result = None
        async for chunk in self._graph.astream(initial_state, stream_mode="updates"):
            for _node_name, update in chunk.items():
                for step in update.get("reasoning_steps", []):
                    yield {"event": "reasoning", "data": step}
                if update.get("intent_result") is not None:
                    yield {"event": "intent_result", "data": update["intent_result"]}
                if update.get("tool_result") is not None:
                    yield {"event": "tool_result", "data": update["tool_result"]}
                if update.get("synthesis_result") is not None:
                    final_result = update["synthesis_result"]

        yield {"event": "done", "data": final_result}
```

- [ ] Add a non-streaming `run(...)` helper only if tests or callers need it.

- [ ] Verify:

```bash
uv run --project backend pytest backend/tests/agents/test_server_agent.py
```

## Task 5: Add `/api/agent/delegate`

**Files**

- Create: `backend/api/agent.py`
- Modify: `backend/main.py`
- Test: `backend/tests/api/test_agent_delegate.py`

### Request model

```python
class DelegateRequest(BaseModel):
    task: str
    calling_agent_id: int
    target_agent_id: int
    zkp_token: str | None = None
    zkp_proof: str | None = None
```

The explicit `calling_agent_id` is required for ZKP, where the proof is bound to the stored public key for that agent. OAuth2 must still verify the Bearer token subject matches `calling_agent_id`.

### Endpoint behavior

- [ ] Load `calling_agent` and require `agent_type == "user"`.
- [ ] Authenticate `calling_agent` using the shared helper for its `auth_type`.
- [ ] Load `target_agent` and require `agent_type == "server"`.
- [ ] Run `ServerAgent.stream_run(task, target_agent.auth_type, target_agent.id, db)`.
- [ ] Encode proper SSE frames:

```python
def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
```

- [ ] Handle stream errors by yielding `event: error` before re-raising only if headers have not been sent. Keep implementation simple for the first pass.

```python
@router.post("/delegate")
async def agent_delegate(request: DelegateRequest, http_request: Request, db: Session = Depends(get_db)):
    calling_agent = get_agent_or_404(db, request.calling_agent_id)
    if calling_agent.agent_type != "user":
        raise AppError(ErrorCode.AUTH_FAILED, "Only user agents can delegate", status_code=403)

    if calling_agent.auth_type == "oauth2":
        auth_info = verify_oauth2_agent_request(calling_agent, http_request)
    elif calling_agent.auth_type == "zkp":
        auth_info = verify_zkp_agent_request(calling_agent, request.zkp_token, request.zkp_proof)
    else:
        raise AppError(ErrorCode.INVALID_PARAMETER, f"Unsupported auth_type: {calling_agent.auth_type}", status_code=400)

    target_agent = get_agent_or_404(db, request.target_agent_id)
    if target_agent.agent_type != "server":
        raise AppError(ErrorCode.INVALID_OPERATION, "Target must be a server agent", status_code=400)

    server_agent = ServerAgent()

    async def event_stream():
        yield sse("auth", auth_info)
        async for item in server_agent.stream_run(request.task, target_agent.auth_type, target_agent.id, db):
            yield sse(item["event"], item["data"])

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] Register the router in `backend/main.py`:

```python
from .api.agent import router as agent_router
app.include_router(agent_router)
```

- [ ] Verify:

```bash
uv run --project backend pytest backend/tests/api/test_agent_delegate.py backend/tests/test_chat.py
```

## Task 6: Seed a server agent

**Files**

- Modify: `backend/main.py`
- Modify: `frontend/src/context/AgentsContext.jsx`
- Test: existing seed tests in `backend/tests/test_chat.py`, plus a focused assertion for `server_agent`.

### Steps

- [ ] Add this to `/api/demo/seed` after user agents:

```python
server_agent = db_ops.upsert_agent(
    db=db,
    user_id=user.id,
    name="CommerceServerAgent",
    auth_type="oauth2",
    public_key=None,
    agent_type="server",
)
```

- [ ] Return server agent metadata:

```python
"server_agent": {
    "id": server_agent.id,
    "name": server_agent.name,
    "auth_type": server_agent.auth_type,
    "agent_type": server_agent.agent_type,
}
```

- [ ] Update frontend agent context storage:

```javascript
const { oauth2_agent, zkp_agent, server_agent } = res.data
const agentPair = {
  oauth2AgentId: oauth2_agent.id,
  zkpAgentId: zkp_agent.id,
  serverAgentId: server_agent.id,
}
```

## Task 7: Add browser UserAgent

**Files**

- Create: `frontend/src/agent/UserAgent.js`
- Modify: `frontend/src/pages/Chat.jsx`
- Test/build: `frontend` build

### Steps

- [ ] Add a plain JS UserAgent that:
  - Stores `{ agentId, authType, privateKeyPem/privateKey, targetServerAgentId }`.
  - Uses `getAccessToken(...)` for OAuth2.
  - Uses `chatApi.getZkpChallenge(agentId)` and `signWithPrivateKeyHex(privateKey, zkp_token)` for ZKP. Do not call a non-existent `computeProof`.
  - Uses `fetch("/api/agent/delegate", ...)` because Axios is not suitable for incremental browser stream consumption.
  - Parses SSE events, not just `data:` lines.

```javascript
const response = await fetch("/api/agent/delegate", {
  method: "POST",
  headers,
  body: JSON.stringify(body),
})
```

Body shape:

```javascript
{
  task,
  calling_agent_id: _agentConfig.agentId,
  target_agent_id: _agentConfig.targetServerAgentId,
  zkp_token,
  zkp_proof
}
```

- [ ] Wire Chat setup to preserve `server_agent.id` from seed in session storage.

- [ ] Replace `chatApi.intent(...)` in `Chat.jsx` with `userAgent.delegate(...)`.

- [ ] On `reasoning` events, append to the computation/action log in the same shape current components expect.

- [ ] On `intent_result`, store the pending message `intent`.

- [ ] On `tool_result`, store the pending message `result`.

- [ ] On `done`, clear `thinking` and call `storeResult(...)` with a compatibility object:

```javascript
storeResult({
  intent: pendingIntent,
  result: pendingToolResult,
  auth_info: pendingAuthInfo,
  timing: pendingTiming,
})
```

- [ ] Verify:

```bash
cd frontend
npm run build
```

## Task 8: End-to-end verification

Run the backend suite and frontend build:

```bash
uv run --project backend pytest backend/tests

cd frontend
npm run build
```

Manual smoke test:

```bash
uv run --project backend uvicorn backend.main:app --reload --port 8000
```

In another terminal:

```bash
cd frontend
npm run dev
```

Check:

- OAuth2 chat delegates through `/api/agent/delegate`.
- ZKP chat delegates through `/api/agent/delegate`.
- Browser network response is `text/event-stream`.
- Reasoning steps appear before final result.
- Product search uses database products, not fallback mock products.
- Purchases create `Transaction` rows for the target server agent.

## Spec Coverage

| Requirement | Covered By |
| --- | --- |
| User delegates to user agent | Task 7 |
| User agent talks to server agent | Tasks 5, 7 |
| Authenticated network hop | Tasks 2, 5 |
| Distinguish user/server agents | Tasks 1, 6 |
| LangGraph server execution | Tasks 3, 4 |
| Reasoning streamed through SSE | Tasks 4, 5, 7 |
| Existing OAuth2/ZKP flows preserved | Tasks 2, 8 |
| No frontend LangChain.js | Task 7 |

## Implementation Notes

- Do not commit after each task unless the user explicitly wants that workflow. The old plan's per-task commits are optional, not part of correctness.
- Keep `oauth2_private_key` deprecated and unset.
- Do not make existing seeded user agents become server agents by default.
- Do not bypass ZKP challenge ownership or single-use token consumption.
- Do not use `astream_events` for this UI stream. It is too verbose for the intended ActionLog and requires extra filtering. Use `astream(..., stream_mode="updates")`.
- If multi-tool chains are added later, add a bounded loop counter to `AgentState` before introducing conditional graph edges.
