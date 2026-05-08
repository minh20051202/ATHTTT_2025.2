import pytest
import time
from jose import jwt


class TestOAuth2Auth:
    """Tests for OAuth2 PKJWT authentication flow."""

    def test_create_access_token(self, client, oauth2_pkjwt_agent):
        """OAuth2 token endpoint generates a valid JWT via client_assertion flow."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, oauth2_pkjwt_agent._test_private_key
        )

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "Bearer"
        assert "expires_in" in data
        assert "token_info" in data

    def test_create_access_token_wrong_assertion(self, client, oauth2_pkjwt_agent):
        """OAuth2 token endpoint rejects invalid client_assertion."""
        client_id = str(oauth2_pkjwt_agent.id)
        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": "invalid_jwt_token"}
        )
        assert response.status_code == 401
        assert "error_code" in response.json()["detail"]

    def test_token_info_structure(self, client, oauth2_pkjwt_agent):
        """Token info contains expected JWT parts."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, oauth2_pkjwt_agent._test_private_key
        )

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        data = response.json()
        token_info = data["token_info"]
        assert "header" in token_info
        assert "payload" in token_info
        assert token_info["header"]["alg"] == "HS256"
        assert token_info["payload"]["sub"] == str(oauth2_pkjwt_agent.id)
        assert token_info["payload"]["type"] == "oauth2"

    def test_token_verification_succeeds(self, client, oauth2_pkjwt_agent):
        """A valid OAuth2 access token can be verified successfully."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, oauth2_pkjwt_agent._test_private_key
        )

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        token = response.json()["access_token"]

        # Verify the access token directly via OAuth2 auth module
        payload = oauth2_auth.verify_token(token)
        assert payload["sub"] == str(oauth2_pkjwt_agent.id)
        assert payload["type"] == "oauth2"

    def test_tampered_token_fails_verification(self, client, oauth2_pkjwt_agent):
        """A tampered access token is rejected during verification."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, oauth2_pkjwt_agent._test_private_key
        )

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        token = response.json()["access_token"]
        tampered_token = token + "tampered"

        with pytest.raises(Exception):
            oauth2_auth.verify_token(tampered_token)


class TestOAuth2Chat:
    """Test OAuth2 PKJWT authentication within the chat endpoint."""

    def _get_access_token(self, client, agent):
        """Helper: exchange client_assertion for access token."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, agent._test_private_key
        )
        resp = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        assert resp.status_code == 200
        return resp.json()["access_token"]

    def test_chat_oauth2_generates_and_verifies_token(self, client, oauth2_pkjwt_agent, sample_products):
        """Chat with OAuth2 agent uses Bearer token for authorization."""
        access_token = self._get_access_token(client, oauth2_pkjwt_agent)

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "intent" in data
        assert "result" in data
        assert "timing" in data
        assert "auth_info" in data

        # Auth info should contain OAuth2 bearer token summary
        assert data["auth_info"]["type"] == "oauth2"
        assert "token" in data["auth_info"]
        assert "token_info" in data["auth_info"]

        # JWT parts should be present
        token_info = data["auth_info"]["token_info"]
        assert token_info["header"]["alg"] == "HS256"
        assert token_info["payload"]["type"] == "oauth2"

    def test_chat_oauth2_timing_metrics(self, client, oauth2_pkjwt_agent, sample_products):
        """OAuth2 chat returns timing metrics for auth operations."""
        access_token = self._get_access_token(client, oauth2_pkjwt_agent)

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        timing = data["timing"]

        assert "intent_extraction" in timing
        assert "authentication" in timing
        assert "execution" in timing
        assert "total" in timing
        # Bearer token verification is fast
        assert timing["authentication"] < 1.0

    def test_chat_oauth2_token_is_reusable(self, client, oauth2_pkjwt_agent, sample_products):
        """OAuth2 Bearer tokens can be reused (vulnerable to replay)."""
        access_token = self._get_access_token(client, oauth2_pkjwt_agent)

        response1 = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response1.status_code == 200

        # Same token reused (replay vulnerability demonstration)
        response2 = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response2.status_code == 200

    def test_chat_agent_not_found(self, client):
        """Chat returns 404 for non-existent agent."""
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": 99999}
        )
        assert response.status_code == 404


def test_create_private_key_jwt_uses_rs256():
    """create_private_key_jwt must sign with RS256, not self.algorithm (HS256)."""
    from backend.auth.oauth2 import OAuth2Auth
    auth = OAuth2Auth()
    public_pem, private_pem = auth.create_rsa_keypair()
    client_id = "agent:42"

    jwt_token, gen_time = auth.create_private_key_jwt(client_id, private_pem)

    # Verify it was signed with RS256
    header = jwt.get_unverified_header(jwt_token)
    assert header["alg"] == "RS256", f"Expected RS256, got {header['alg']}"

    # Verify the signature verifies with the public key
    payload = auth.verify_client_assertion(jwt_token, public_pem)
    assert payload["iss"] == client_id
    assert payload["sub"] == client_id
    assert gen_time > 0
