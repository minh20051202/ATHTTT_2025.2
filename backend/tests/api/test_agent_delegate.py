from backend.auth.oauth2 import oauth2_auth
from backend.db.models import Agent


def _access_token(agent):
    return oauth2_auth.create_access_token(
        {"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
    )


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
            assert agent_id == target_agent.id
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
