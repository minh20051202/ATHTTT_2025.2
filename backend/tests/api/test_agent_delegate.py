from backend.auth.oauth2 import oauth2_auth
from backend.auth.zkp import zkp_auth
from backend.db.models import Agent


def _access_token(agent):
    return oauth2_auth.create_access_token(
        {"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
    )


def _zkp_credentials(client, agent):
    challenge_response = client.get(f"/api/chat/zkp-challenge/{agent.id}")
    assert challenge_response.status_code == 200
    zkp_token = challenge_response.json()["zkp_token"]
    proof, _ = zkp_auth.sign_data(agent._test_private_key, agent.public_key, zkp_token)
    return zkp_token, proof


def _server_agent(db, demo_user):
    agent = Agent(
        user_id=demo_user.id,
        name="CommerceServerAgent",
        auth_type="oauth2",
        credentials_hash=None,
        public_key=None,
        agent_type="server",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def test_delegate_streams_sse_events(client, db, oauth2_pkjwt_agent, demo_user, monkeypatch):
    target_agent = _server_agent(db, demo_user)

    class FakeServerAgent:
        async def stream_run(self, task, auth_type, agent_id, db):
            assert task == "search laptops"
            assert auth_type == "oauth2"
            assert agent_id == oauth2_pkjwt_agent.id
            yield {"event": "reasoning", "data": {"node": "IntentNode"}}
            yield {"event": "done", "data": {"summary": "ok"}}

    monkeypatch.setattr("backend.api.agent.ServerAgent", FakeServerAgent)

    response = client.post(
        "/api/agent/delegate",
        json={
            "task": "search laptops",
            "calling_agent_id": oauth2_pkjwt_agent.id,
            "target_agent_id": target_agent.id,
        },
        headers={"Authorization": f"Bearer {_access_token(oauth2_pkjwt_agent)}"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: auth" in body
    assert "event: reasoning" in body
    assert "event: done" in body


def test_delegate_uses_calling_agent_auth_type_for_tool_execution(client, db, zkp_agent, demo_user, monkeypatch):
    target_agent = _server_agent(db, demo_user)

    class FakeServerAgent:
        async def stream_run(self, task, auth_type, agent_id, db):
            assert task == "buy product 2"
            assert auth_type == "zkp"
            assert agent_id == zkp_agent.id
            yield {
                "event": "tool_result",
                "data": {
                    "action": "execute_purchase",
                    "auth_type_used": auth_type,
                },
            }
            yield {"event": "done", "data": {"summary": "ok"}}

    monkeypatch.setattr("backend.api.agent.ServerAgent", FakeServerAgent)
    zkp_token, proof = _zkp_credentials(client, zkp_agent)

    response = client.post(
        "/api/agent/delegate",
        json={
            "task": "buy product 2",
            "calling_agent_id": zkp_agent.id,
            "target_agent_id": target_agent.id,
            "zkp_token": zkp_token,
            "zkp_proof": proof,
        },
    )

    assert response.status_code == 200
    assert '"auth_type_used": "zkp"' in response.text


def test_delegate_purchase_is_visible_in_calling_agent_order_history(
    client,
    db,
    zkp_agent,
    demo_user,
    sample_products,
    monkeypatch,
):
    from backend.agents.intent import Intent, tool_caller

    target_agent = _server_agent(db, demo_user)

    class FakeExtractor:
        async def extract_intent(self, task):
            if "history" in task:
                return Intent(action="get_order_history", parameters={})
            return Intent(action="execute_purchase", parameters={"product_id": sample_products[1].id})

    class RealToolServerAgent:
        def __init__(self):
            self._extractor = FakeExtractor()

        async def stream_run(self, task, auth_type, agent_id, db):
            intent = await self._extractor.extract_intent(task)
            yield {"event": "intent_result", "data": intent.model_dump()}
            result = await tool_caller.call_tool(intent, auth_type, agent_id, db)
            yield {"event": "tool_result", "data": result}
            yield {"event": "done", "data": {"summary": "ok", "full_result": result}}

    monkeypatch.setattr("backend.api.agent.ServerAgent", RealToolServerAgent)

    zkp_token, proof = _zkp_credentials(client, zkp_agent)
    purchase_response = client.post(
        "/api/agent/delegate",
        json={
            "task": "buy product 2",
            "calling_agent_id": zkp_agent.id,
            "target_agent_id": target_agent.id,
            "zkp_token": zkp_token,
            "zkp_proof": proof,
        },
    )

    assert purchase_response.status_code == 200
    assert '"action": "execute_purchase"' in purchase_response.text

    zkp_token, proof = _zkp_credentials(client, zkp_agent)
    history_response = client.post(
        "/api/agent/delegate",
        json={
            "task": "show my order history",
            "calling_agent_id": zkp_agent.id,
            "target_agent_id": target_agent.id,
            "zkp_token": zkp_token,
            "zkp_proof": proof,
        },
    )

    assert history_response.status_code == 200
    assert '"action": "get_order_history"' in history_response.text
    assert f'"transaction_id": 1' in history_response.text
    assert f'"product_id": {sample_products[1].id}' in history_response.text


def test_delegate_requires_user_calling_agent(client, db, demo_user):
    calling_agent = _server_agent(db, demo_user)
    target_agent = _server_agent(db, demo_user)

    response = client.post(
        "/api/agent/delegate",
        json={
            "task": "search laptops",
            "calling_agent_id": calling_agent.id,
            "target_agent_id": target_agent.id,
        },
        headers={"Authorization": f"Bearer {_access_token(calling_agent)}"},
    )

    assert response.status_code == 403


def test_delegate_requires_server_target(client, db, oauth2_pkjwt_agent, demo_user):
    target_agent = Agent(
        user_id=demo_user.id,
        name="User Target",
        auth_type="oauth2",
        credentials_hash=None,
        public_key=None,
        agent_type="user",
    )
    db.add(target_agent)
    db.commit()
    db.refresh(target_agent)

    response = client.post(
        "/api/agent/delegate",
        json={
            "task": "search laptops",
            "calling_agent_id": oauth2_pkjwt_agent.id,
            "target_agent_id": target_agent.id,
        },
        headers={"Authorization": f"Bearer {_access_token(oauth2_pkjwt_agent)}"},
    )

    assert response.status_code == 400


def test_seed_creates_server_agent(client):
    response = client.post("/api/demo/seed")
    assert response.status_code == 200
    data = response.json()

    assert data["oauth2_agent"]["agent_type"] == "user"
    assert data["zkp_agent"]["agent_type"] == "user"
    assert data["server_agent"]["auth_type"] == "oauth2"
    assert data["server_agent"]["agent_type"] == "server"
