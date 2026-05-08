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
        assert token_info["header"]["alg"] == "RS256"
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

        # Verify the access token directly via OAuth2 auth module (asymmetric — uses agent's public key)
        payload = oauth2_auth.verify_token_with_public_key(token, oauth2_pkjwt_agent.public_key)
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
            oauth2_auth.verify_token_with_public_key(tampered_token, oauth2_pkjwt_agent.public_key)

    def test_token_endpoint_signs_with_agent_private_key(self, client, oauth2_pkjwt_agent):
        """Access tokens must be signed with per-agent RS256 key, not shared HS256 secret."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)
        assertion, _ = oauth2_auth.create_client_assertion(
            client_id, oauth2_pkjwt_agent._test_private_key
        )

        token_resp = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        assert token_resp.status_code == 200, f"Token failed: {token_resp.status_code}: {token_resp.text}"
        access_token = token_resp.json()["access_token"]

        # Must be RS256, not HS256
        header = jwt.get_unverified_header(access_token)
        assert header["alg"] == "RS256", f"Expected RS256, got {header['alg']}"


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
        assert token_info["header"]["alg"] == "RS256"
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


class TestOAuth2PerAgentKeyStorage:
    """Test per-agent key storage for RS256 token signing (Task 25)."""

    def test_oauth2_agent_stores_per_agent_signing_key(self):
        """OAuth2 agent must store per-agent RSA signing key and public verification key."""
        import os
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from backend.db.models import Base

        test_db_path = "/tmp/test_task25_per_agent_key.db"
        if os.path.exists(test_db_path):
            os.remove(test_db_path)

        engine = create_engine(f"sqlite:///{test_db_path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        db = TestSession()

        try:
            from backend.db.operations import DatabaseOperations
            from backend.auth.oauth2 import OAuth2Auth

            db_ops = DatabaseOperations()
            user = db_ops.create_user(db=db, username="test_pkjwt_task25", email="test_task25@pkj.com", password="pw")
            agent = db_ops.create_agent(db=db, user_id=user.id, name="Test PKJWT Agent Task25", auth_type="oauth2")

            assert agent.oauth2_private_key is not None, "oauth2_private_key must be stored"
            assert "-----BEGIN PRIVATE KEY-----" in agent.oauth2_private_key, "Must be PKCS8 PEM"

            # The agent should also have a public key stored (this was already working)
            assert agent.public_key is not None, "public_key must also be stored"
            assert "-----BEGIN PUBLIC KEY-----" in agent.public_key, "Must be RSA public PEM"

            # Use the new methods to verify we can sign and verify with the stored key pair
            oauth2_instance = OAuth2Auth()
            token, _ = oauth2_instance.create_access_token_with_key(
                {"sub": str(agent.id)}, agent.oauth2_private_key
            )
            payload = oauth2_instance.verify_token_with_public_key(token, agent.public_key)
            assert payload["sub"] == str(agent.id), "Token must verify with stored public key"

            # Token signed with RS256 (check header)
            header = jwt.get_unverified_header(token)
            assert header["alg"] == "RS256", f"Expected RS256, got {header['alg']}"
        finally:
            db.close()
            if os.path.exists(test_db_path):
                os.remove(test_db_path)