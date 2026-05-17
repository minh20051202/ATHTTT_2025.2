import pytest
from fastapi import Request

from backend.api.agent_auth import verify_oauth2_agent_request, verify_zkp_agent_request
from backend.api.chat import _challenge_store
from backend.auth.oauth2 import oauth2_auth


def _request_with_bearer(token: str) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/test",
        "headers": [(b"authorization", f"Bearer {token}".encode("utf-8"))],
    }
    return Request(scope)


def test_oauth2_agent_request_rejects_token_agent_mismatch(oauth2_pkjwt_agent, db, demo_user):
    from backend.db.models import Agent

    other_agent = Agent(
        user_id=demo_user.id,
        name="Other OAuth2 Agent",
        auth_type="oauth2",
        credentials_hash=None,
        public_key=None,
        agent_type="user",
    )
    db.add(other_agent)
    db.commit()
    db.refresh(other_agent)

    token = oauth2_auth.create_access_token({"sub": str(other_agent.id), "type": "oauth2"})

    with pytest.raises(Exception) as exc_info:
        verify_oauth2_agent_request(oauth2_pkjwt_agent, _request_with_bearer(token))

    assert exc_info.value.status_code == 401
    assert "mismatch" in exc_info.value.detail["message"]


def test_zkp_agent_request_consumes_challenge_once(client, zkp_agent):
    challenge_resp = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
    assert challenge_resp.status_code == 200
    zkp_token = challenge_resp.json()["zkp_token"]

    from backend.auth.zkp import zkp_auth

    proof, _ = zkp_auth.sign_data(
        zkp_agent._test_private_key,
        zkp_agent.public_key,
        zkp_token,
    )

    auth_info = verify_zkp_agent_request(zkp_agent, zkp_token, proof)
    assert auth_info["type"] == "zkp"
    assert zkp_token not in _challenge_store

    with pytest.raises(Exception) as exc_info:
        verify_zkp_agent_request(zkp_agent, zkp_token, proof)

    assert exc_info.value.status_code == 401
