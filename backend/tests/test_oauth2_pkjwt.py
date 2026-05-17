# backend/tests/test_oauth2_pkjwt.py
import pytest
from jose import jwt
from datetime import datetime, timedelta


class TestOAuth2RSAKeyPair:
    """Task 1: RSA keypair generation + client assertion (RS256)."""

    def test_create_rsa_keypair_returns_pem_strings(self):
        """create_rsa_keypair() returns (public_pem, private_pem) both valid PEM."""
        from backend.auth.oauth2 import oauth2_auth

        public_key, private_key = oauth2_auth.create_rsa_keypair()
        assert public_key.startswith("-----BEGIN PUBLIC KEY-----")
        assert private_key.startswith("-----BEGIN PRIVATE KEY-----")
        assert len(public_key) > 100
        assert len(private_key) > 500

    def test_public_key_can_verify_assertion_signed_with_private_key(self):
        """A JWT signed with the private key verifies with the public key (RS256)."""
        from backend.auth.oauth2 import oauth2_auth

        public_key, private_key = oauth2_auth.create_rsa_keypair()
        client_id = "test-agent-123"

        assertion, gen_time = oauth2_auth.create_client_assertion(client_id, private_key)
        assert gen_time > 0

        # Verify the assertion with its own decoded payload (skip exp/aud checks for test speed)
        claims = jwt.decode(assertion, public_key, algorithms=["RS256"], options={"verify_exp": False, "verify_aud": False})
        assert claims["iss"] == client_id
        assert claims["sub"] == client_id
        assert claims["aud"] == "https://oauth.example.com/token"
        assert "iat" in claims
        assert "exp" in claims

        # Verify signature using the public key (RS256)
        from cryptography.hazmat.primitives import serialization
        pub_key = serialization.load_pem_public_key(public_key.encode())
        header = jwt.get_unverified_header(assertion)
        assert header["alg"] == "RS256"
        payload = jwt.decode(assertion, public_key, algorithms=["RS256"], options={"verify_exp": False, "verify_aud": False})
        assert payload["sub"] == client_id


class TestOAuth2TokenEndpoint:
    """Task 2: Token endpoint accepts client_assertion, verifies, returns Bearer token."""

    def test_token_endpoint_rejects_missing_client_assertion(self, client):
        """Without client_assertion, token endpoint returns 422."""
        response = client.post("/api/auth/oauth2/token", data={"client_id": "x", "client_secret": "y"})
        assert response.status_code == 422

    def test_token_endpoint_verifies_client_assertion_with_stored_public_key(self, client, oauth2_pkjwt_agent):
        """Token endpoint verifies client_assertion signed by the agent's private key."""
        import time
        client_id = str(oauth2_pkjwt_agent.id)

        # Client creates assertion using their private key
        from backend.auth.oauth2 import oauth2_auth
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "Bearer"
        assert "expires_in" in data

    def test_token_endpoint_rejects_tampered_assertion(self, client, oauth2_pkjwt_agent):
        """A tampered client_assertion is rejected (signature mismatch)."""
        client_id = str(oauth2_pkjwt_agent.id)
        from backend.auth.oauth2 import oauth2_auth
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)

        # Tamper: flip one character in the assertion
        tampered = assertion[:-5] + ("X" if assertion[-5] != "X" else "Y")

        response = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": tampered}
        )
        assert response.status_code in (401, 400)


class TestOAuth2IntentWithBearerToken:
    """Task 3: /intent accepts OAuth2 Bearer token (replaces server-side token mint)."""
    pytestmark = pytest.mark.usefixtures("mock_intent_extractor")

    def test_oauth2_intent_requires_bearer_token(self, client, oauth2_pkjwt_agent):
        """Without Bearer token, OAuth2 agent intent request is rejected."""
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id}
        )
        assert response.status_code == 401

    def test_oauth2_intent_with_valid_bearer_token(self, client, oauth2_pkjwt_agent, sample_products):
        """A valid Bearer token obtained via client_assertion flow grants access."""
        from backend.auth.oauth2 import oauth2_auth

        client_id = str(oauth2_pkjwt_agent.id)

        # Step 1: get access token via client_assertion
        assertion, _ = oauth2_auth.create_client_assertion(client_id, oauth2_pkjwt_agent._test_private_key)
        token_resp = client.post(
            "/api/auth/oauth2/token",
            data={"client_id": client_id, "client_assertion": assertion}
        )
        access_token = token_resp.json()["access_token"]

        # Step 2: use access token on /intent
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["auth_info"]["type"] == "oauth2"

    def test_oauth2_intent_with_expired_bearer_token(self, client, oauth2_pkjwt_agent):
        """An expired access token is rejected."""
        from backend.auth.oauth2 import oauth2_auth
        from datetime import timedelta

        client_id = str(oauth2_pkjwt_agent.id)

        # Create an already-expired token
        expired_token = oauth2_auth.create_access_token(
            data={"sub": client_id},
            expires_delta=timedelta(seconds=-10)
        )

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {expired_token}"}
        )
        assert response.status_code == 401


class TestOAuth2SeedEndpoint:
    """Seed endpoint creates agents. Client must call /register to provide its public key."""

    def test_oauth2_agent_created_with_null_public_key(self, client, db):
        """Seeded OAuth2 agent starts with NULL public_key — client registers later via /register."""
        response = client.post("/api/demo/seed")
        agent_id = response.json()["oauth2_agent"]["id"]

        from backend.db.models import Agent
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        assert agent.public_key is None, "public_key is NULL at seed time — client registers it"
        assert agent.credentials_hash is None  # No bcrypt hash
        assert agent.oauth2_private_key is None  # Server NEVER stores per-agent private key

    def test_seed_does_not_return_private_key(self, client):
        """Seed response does NOT include a private_key — client generates keypair locally."""
        response = client.post("/api/demo/seed")
        assert response.status_code == 200
        data = response.json()
        oauth2 = data["oauth2_agent"]
        assert "private_key" not in oauth2, "Seed must NOT return private key - client generates its own"
        assert "id" in oauth2
        assert oauth2["auth_type"] == "oauth2"
