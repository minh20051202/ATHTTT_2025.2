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

        # Verify the access token via OAuth2 auth module (HS256 symmetric — server's own secret)
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
    pytestmark = pytest.mark.usefixtures("mock_intent_extractor")

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


class TestOAuth2PerAgentKeyStorage:
    """Test that server never stores per-agent private key in OAuth2 PKJWT flow.

    Client generates its own RSA keypair and sends only the public key to the server.
    Server uses the public key to verify client_assertion (RS256), and issues access
    tokens signed with the server's symmetric HS256 secret.
    """

    def test_oauth2_agent_never_stores_private_key(self):
        """OAuth2 agent record must NOT store any per-agent private key in the DB."""
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

            db_ops = DatabaseOperations()
            user = db_ops.create_user(db=db, username="test_pkjwt_task25", email="test_task25@pkj.com", password="pw")
            agent = db_ops.create_agent(db=db, user_id=user.id, name="Test PKJWT Agent Task25", auth_type="oauth2")

            # Server NEVER stores any per-agent private key
            assert agent.oauth2_private_key is None, "oauth2_private_key must be None — server never stores it"
            # public_key is NULL at creation; client registers their public key later via /register
            assert agent.public_key is None, "public_key is NULL at creation (client registers later)"

            # Verify: server can mint an access token (HS256) and verify it (HS256)
            from backend.auth.oauth2 import oauth2_auth
            token = oauth2_auth.create_access_token({"sub": str(agent.id), "type": "oauth2"})
            payload = oauth2_auth.verify_token(token)
            assert payload["sub"] == str(agent.id)

            # The client_assertion verification still uses RS256 — but the per-agent private key
            # is held by the client, not stored in the DB
        finally:
            db.close()
            if os.path.exists(test_db_path):
                os.remove(test_db_path)

    def test_client_registers_public_key_and_server_verifies_assertion(self, client, db, demo_user):
        """Client registers RSA public key, server verifies client_assertion (RS256)."""
        from backend.db.models import Agent
        from backend.auth.oauth2 import oauth2_auth

        # 1. Create agent (no public key yet)
        db_ops_anon = __import__('backend.db.operations', fromlist=['DatabaseOperations']).DatabaseOperations()
        agent = db_ops_anon.create_agent(db=db, user_id=demo_user.id, name="Test Register Agent", auth_type="oauth2")

        # Agent has no public key yet
        assert agent.public_key is None

        # 2. Register public key
        public_pem, private_pem = oauth2_auth.create_rsa_keypair()
        register_resp = client.post(
            "/api/auth/oauth2/register",
            data={"client_id": str(agent.id), "public_key_pem": public_pem}
        )
        assert register_resp.status_code == 200
        assert "Public key registered" in register_resp.json()["message"]

        # 3. Verify public key is stored
        db.refresh(agent)
        assert agent.public_key == public_pem

        # 4. Client can now authenticate via client_assertion
        assertion, _ = oauth2_auth.create_client_assertion(str(agent.id), private_pem)
        token_resp = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": str(agent.id), "client_assertion": assertion}
        )
        assert token_resp.status_code == 200
        access_token = token_resp.json()["access_token"]

        # 5. Access token verifies with server's HS256 secret
        payload = oauth2_auth.verify_token(access_token)
        assert payload["sub"] == str(agent.id)
