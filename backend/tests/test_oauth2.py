import pytest
import time


class TestOAuth2Auth:
    """Tests for OAuth2 authentication flow."""

    def test_create_access_token(self, client):
        """OAuth2 token endpoint generates a valid JWT."""
        response = client.post(
            "/api/auth/oauth2/token",
            params={
                "client_id": "test_oauth2_client",
                "client_secret": "test_oauth2_secret"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "Bearer"
        assert "expires_in" in data
        assert "token_info" in data

    def test_create_access_token_wrong_credentials(self, client):
        """OAuth2 token endpoint rejects invalid credentials."""
        response = client.post(
            "/api/auth/oauth2/token",
            params={
                "client_id": "wrong_client",
                "client_secret": "wrong_secret"
            }
        )
        assert response.status_code == 401
        assert "error_code" in response.json()["detail"]

    def test_token_info_structure(self, client):
        """Token info contains expected JWT parts."""
        response = client.post(
            "/api/auth/oauth2/token",
            params={
                "client_id": "test_oauth2_client",
                "client_secret": "test_oauth2_secret"
            }
        )
        data = response.json()
        token_info = data["token_info"]
        assert "header" in token_info
        assert "payload" in token_info
        assert token_info["header"]["alg"] == "HS256"
        assert token_info["payload"]["sub"] == "test_oauth2_client"
        assert token_info["payload"]["type"] == "oauth2"

    def test_token_verification_succeeds(self, client):
        """A valid OAuth2 token can be verified successfully."""
        response = client.post(
            "/api/auth/oauth2/token",
            params={
                "client_id": "test_oauth2_client",
                "client_secret": "test_oauth2_secret"
            }
        )
        token = response.json()["access_token"]

        # Token is verified inside the chat endpoint
        # We can check by calling the chat endpoint with OAuth2 auth_type and token
        # For unit test, we verify the token directly via OAuth2 auth module
        from backend.auth.oauth2 import oauth2_auth
        payload = oauth2_auth.verify_token(token)
        assert payload["sub"] == "test_oauth2_client"
        assert payload["type"] == "oauth2"

    def test_tampered_token_fails_verification(self, client):
        """A tampered token is rejected during verification."""
        response = client.post(
            "/api/auth/oauth2/token",
            params={
                "client_id": "test_oauth2_client",
                "client_secret": "test_oauth2_secret"
            }
        )
        token = response.json()["access_token"]
        # Tamper with the token
        tampered_token = token + "tampered"

        from backend.auth.oauth2 import oauth2_auth
        with pytest.raises(Exception):
            oauth2_auth.verify_token(tampered_token)


class TestOAuth2Chat:
    """Test OAuth2 authentication within the chat endpoint."""

    def test_chat_oauth2_generates_and_verifies_token(self, client, oauth2_agent, sample_products):
        """Chat with OAuth2 agent generates a token and executes the intent."""
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": oauth2_agent.id
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "intent" in data
        assert "result" in data
        assert "timing" in data
        assert "auth_info" in data

        # Auth info should contain OAuth2 token
        assert data["auth_info"]["type"] == "oauth2"
        assert "token" in data["auth_info"]
        assert "token_info" in data["auth_info"]

        # JWT parts should be present
        token_info = data["auth_info"]["token_info"]
        assert token_info["header"]["alg"] == "HS256"
        assert token_info["payload"]["type"] == "oauth2"

    def test_chat_oauth2_timing_metrics(self, client, oauth2_agent, sample_products):
        """OAuth2 chat returns timing metrics for auth operations."""
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": oauth2_agent.id
            }
        )
        assert response.status_code == 200
        data = response.json()
        timing = data["timing"]

        assert "intent_extraction" in timing
        assert "authentication" in timing
        assert "execution" in timing
        assert "total" in timing
        # OAuth2 token gen + verify is fast
        assert timing["authentication"] < 1.0  # Should be very fast

    def test_chat_oauth2_token_is_reusable(self, client, oauth2_agent, sample_products):
        """OAuth2 tokens can be reused (vulnerable to replay)."""
        response1 = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_agent.id}
        )
        token1 = response1.json()["auth_info"]["token"]

        # Same request generates same token (deterministic with same payload/sub)
        response2 = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_agent.id}
        )
        token2 = response2.json()["auth_info"]["token"]

        # Both tokens are valid (replay vulnerability demonstration)
        assert token1 == token2

    def test_chat_agent_not_found(self, client):
        """Chat returns 404 for non-existent agent."""
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": 99999}
        )
        assert response.status_code == 404