"""
Backend integration tests for ChatTrace API contracts.

These tests verify that /intent and related endpoints return data in the
exact shape that the ChatTrace frontend components (ActionLog, MetricsPanel)
depend on.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.auth.oauth2 import oauth2_auth
from backend.auth.zkp import zkp_auth


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_oauth2_bearer_token(client: TestClient, agent) -> str:
    """Get a valid HS256 access token via the RFC 7523 client_assertion flow."""
    client_id = str(agent.id)
    assertion, _ = oauth2_auth.create_client_assertion(
        client_id, agent._test_private_key
    )
    resp = client.post(
        "/api/auth/oauth2/token",
        data={"client_id": client_id, "client_assertion": assertion}
    )
    assert resp.status_code == 200, f"Token endpoint failed: {resp.json()}"
    return resp.json()["access_token"]


def get_zkp_token_and_proof(client: TestClient, agent) -> tuple[str, str]:
    """Get a fresh ZKP challenge token and compute the proof."""
    challenge_resp = client.get(f"/api/chat/zkp-challenge/{agent.id}")
    assert challenge_resp.status_code == 200, f"Challenge endpoint failed: {challenge_resp.json()}"
    zkp_token = challenge_resp.json()["zkp_token"]

    # sign_data mirrors what frontend/src/lib/zkp.js does
    proof, _ = zkp_auth.sign_data(agent._test_private_key, agent.public_key, zkp_token)
    return zkp_token, proof


# ---------------------------------------------------------------------------
# OAuth2 tests
# ---------------------------------------------------------------------------

class TestOAuth2ChatTrace:
    """Verify OAuth2 /intent response shape for ChatTrace components."""
    pytestmark = pytest.mark.usefixtures("mock_intent_extractor")

    def test_intent_response_auth_info_shape_oauth2(self, client, oauth2_pkjwt_agent):
        """OAuth2 /intent response includes all fields ActionLog/MetricsPanel need."""
        token = get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        resp = client.post(
            "/api/chat/intent",
            json={
                "message": "show me laptops",
                "agent_id": oauth2_pkjwt_agent.id,
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.json()}"
        data = resp.json()

        # auth_info shape
        assert "auth_info" in data
        auth_info = data["auth_info"]
        assert auth_info["type"] == "oauth2"

        # token_info present (used by ActionLog token display)
        assert "token_info" in auth_info
        token_info = auth_info["token_info"]
        assert "header" in token_info
        assert "payload" in token_info
        assert token_info["header"]["alg"] == "HS256"

        # token_size (used by MetricsPanel)
        assert "token_size" in auth_info
        assert isinstance(auth_info["token_size"], int)
        assert auth_info["token_size"] > 0

        # verification_time (used by MetricsPanel)
        assert "verification_time" in auth_info
        assert isinstance(auth_info["verification_time"], (int, float))
        assert auth_info["verification_time"] >= 0

    def test_intent_response_timing_fields(self, client, oauth2_pkjwt_agent):
        """Response includes timing object with intent_extraction, authentication, execution, total."""
        token = get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        resp = client.post(
            "/api/chat/intent",
            json={
                "message": "show me laptops",
                "agent_id": oauth2_pkjwt_agent.id,
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert resp.status_code == 200
        data = resp.json()

        assert "timing" in data
        timing = data["timing"]
        assert "intent_extraction" in timing
        assert "authentication" in timing
        assert "execution" in timing
        assert "total" in timing

        # All timing values should be positive floats (seconds)
        for key in ["intent_extraction", "authentication", "execution", "total"]:
            assert isinstance(timing[key], (int, float)), f"{key} should be numeric"
            assert timing[key] >= 0, f"{key} should be non-negative"

    def test_oauth2_token_endpoint_returns_hs256_token(self, client, oauth2_pkjwt_agent):
        """Token endpoint issues HS256 access tokens (server-side symmetric secret)."""
        token = get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        token_info = oauth2_auth.get_token_info(token)

        assert token_info["header"]["alg"] == "HS256"
        assert token_info["payload"]["sub"] == str(oauth2_pkjwt_agent.id)
        assert token_info["payload"]["type"] == "oauth2"


# ---------------------------------------------------------------------------
# ZKP tests
# ---------------------------------------------------------------------------

class TestZKPChatTrace:
    """Verify ZKP /intent response shape for ChatTrace components."""
    pytestmark = pytest.mark.usefixtures("mock_intent_extractor")

    def test_intent_response_auth_info_shape_zkp(self, client, zkp_agent):
        """ZKP /intent response includes proof_info needed for ActionLog display."""
        zkp_token, proof = get_zkp_token_and_proof(client, zkp_agent)

        resp = client.post(
            "/api/chat/intent",
            json={
                "message": "show me laptops",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            },
        )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.json()}"
        data = resp.json()

        # auth_info shape
        assert "auth_info" in data
        auth_info = data["auth_info"]
        assert auth_info["type"] == "zkp"

        # proof_info present (used by ActionLog proof accordion)
        assert "proof_info" in auth_info
        proof_info = auth_info["proof_info"]
        assert "commitment" in proof_info or "has_commitment" in proof_info or "type" in proof_info

        # proof_size used by MetricsPanel
        assert "proof_info" in auth_info and "proof_size" in auth_info["proof_info"]

        # verification_time used by MetricsPanel
        assert "verification_time" in auth_info
        assert isinstance(auth_info["verification_time"], (int, float))
        assert auth_info["verification_time"] >= 0

    def test_intent_response_timing_fields_zkp(self, client, zkp_agent):
        """ZKP response also includes complete timing object."""
        zkp_token, proof = get_zkp_token_and_proof(client, zkp_agent)

        resp = client.post(
            "/api/chat/intent",
            json={
                "message": "show me laptops",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            },
        )

        assert resp.status_code == 200
        data = resp.json()

        assert "timing" in data
        timing = data["timing"]
        for key in ["intent_extraction", "authentication", "execution", "total"]:
            assert key in timing, f"{key} missing from timing"
            assert isinstance(timing[key], (int, float))
            assert timing[key] >= 0

    def test_zkp_verify_response_shape(self, client, zkp_agent):
        """ZKP verify returns verification_time for MetricsPanel."""
        zkp_token, proof = get_zkp_token_and_proof(client, zkp_agent)

        resp = client.post(
            "/api/chat/intent",
            json={
                "message": "show me laptops",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            },
        )

        assert resp.status_code == 200
        data = resp.json()

        # Top-level auth_info has verification_time (total ZKP verification time)
        assert "auth_info" in data
        assert "verification_time" in data["auth_info"]

        # verification_time should be small but measurable (ZKP math takes time)
        verify_time = data["auth_info"]["verification_time"]
        assert isinstance(verify_time, (int, float))
        assert verify_time >= 0