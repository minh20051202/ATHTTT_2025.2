import json
import pytest
import time


class TestZKPTokenStoreCleanup:
    """Tests for _token_store memory leak prevention."""

    def test_zkp_token_store_cleanup(self):
        """Expired tokens must be removed from _token_store to prevent memory leak."""
        from backend.auth.zkp import _token_store, generate_token, cleanup_expired_tokens

        original_keys = set(_token_store.keys())

        # Inject an expired token
        expired = "test_expired_zkp_token_xyz"
        _token_store[expired] = {"agent_id": 1, "expires": time.time() - 60}

        # Verify it's there
        assert expired in _token_store

        # Call cleanup
        cleanup_expired_tokens()

        # Expired token must be gone
        assert expired not in _token_store, f"Expired token still present: {expired}"
        # Original tokens must not be touched
        assert all(k in _token_store for k in original_keys)


class TestZKPAuth:
    """Tests for ZKP authentication flow using the two-step proof."""

    def test_create_client_public_key(self):
        """zkp_auth creates a public key from password (client-side operation)."""
        from backend.auth.zkp import zkp_auth

        public_key, sig_time = zkp_auth.create_client_signature("my_secret_password")
        assert public_key is not None
        assert isinstance(public_key, str)
        assert '"y":' in public_key  # JSON format with y field
        assert sig_time > 0

    def test_sign_data_produces_valid_proof(self):
        """zkp_auth.sign_data produces a proof valid for a server-issued token."""
        from backend.auth.zkp import zkp_auth

        password = "my_secret_password"
        public_key, _ = zkp_auth.create_client_signature(password)

        # Server issues a challenge token
        token, _ = zkp_auth.create_token()

        # Client creates proof for this token
        proof, sign_time = zkp_auth.sign_data(password, public_key, token)
        assert proof is not None
        assert sign_time > 0

        # Proof can be verified
        is_valid, verify_time = zkp_auth.verify_proof(proof, public_key, token)
        assert is_valid is True
        assert verify_time > 0

    def test_token_is_single_use(self):
        """A consumed token cannot be reused (single-use, via consume_token)."""
        from backend.auth.zkp import zkp_auth, generate_token, consume_token

        password = "replay_test_password"
        public_key, _ = zkp_auth.create_client_signature(password)

        # Issue a challenge token (stored in _token_store)
        token = generate_token(agent_id=1)

        proof, _ = zkp_auth.sign_data(password, public_key, token)

        # consume_token removes from store — first consume succeeds
        consumed1 = consume_token(token, expected_agent_id=1)
        assert consumed1 is True

        # Second consume: token already gone → False
        consumed2 = consume_token(token, expected_agent_id=1)
        assert consumed2 is False

    def test_wrong_password_fails_verification(self):
        """Proof created with wrong password fails verification."""
        from backend.auth.zkp import zkp_auth

        correct_password = "correct_password"
        wrong_password = "wrong_password"

        public_key, _ = zkp_auth.create_client_signature(correct_password)
        token, _ = zkp_auth.create_token()

        # Proof created with wrong password
        proof, _ = zkp_auth.sign_data(wrong_password, public_key, token)
        is_valid, _ = zkp_auth.verify_proof(proof, public_key, token)
        assert is_valid is False


class TestZKPChallengeEndpoint:
    """Tests for GET /api/chat/zkp-challenge/{agent_id}."""

    def test_zkp_challenge_returns_token(self, client, zkp_agent):
        """Challenge endpoint returns a valid zkp_token for the agent."""
        response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        assert response.status_code == 200
        data = response.json()
        assert "zkp_token" in data
        assert "agent_id" in data
        assert data["agent_id"] == zkp_agent.id

    def test_zkp_challenge_rejects_oauth2_agent(self, client, oauth2_agent):
        """Challenge endpoint rejects OAuth2 agents (not a ZKP agent)."""
        response = client.get(f"/api/chat/zkp-challenge/{oauth2_agent.id}")
        assert response.status_code == 400
        assert "ZKP agent" in response.json()["detail"]["message"]

    def test_zkp_challenge_rejects_unknown_agent(self, client):
        """Challenge endpoint returns 404 for unknown agent."""
        response = client.get("/api/chat/zkp-challenge/99999")
        assert response.status_code == 404


class TestZKPAuthenticate:
    """Tests for POST /api/chat/intent with ZKP authentication (two-step flow)."""

    def test_zkp_requires_token_and_proof(self, client, zkp_agent, sample_products):
        """Intent endpoint rejects ZKP requests missing token or proof."""
        # No token, no proof
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": zkp_agent.id}
        )
        assert response.status_code == 400
        assert "zkp_token and zkp_proof required" in response.json()["detail"]["message"]

        # Token but no proof
        token_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        token = token_response.json()["zkp_token"]
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": token,
            }
        )
        assert response.status_code == 400

    def test_zkp_chat_full_flow(self, client, zkp_agent, sample_products):
        """Full two-step ZKP flow: challenge → proof → intent."""
        from backend.auth.zkp import zkp_auth

        password = zkp_agent._test_password
        public_key = zkp_agent.public_key

        # Step 1: get challenge token
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        assert challenge_response.status_code == 200
        zkp_token = challenge_response.json()["zkp_token"]

        # Step 2: compute proof client-side (simulates what frontend zkp.js does)
        proof, _ = zkp_auth.sign_data(password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        # Step 3: send intent with token + proof
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response.status_code == 200
        data = response.json()

        assert data["auth_info"]["type"] == "zkp"
        assert "proof" in data["auth_info"]
        assert "proof_info" in data["auth_info"]
        assert "verification_time" in data["auth_info"]

    def test_zkp_wrong_proof_fails(self, client, zkp_agent, sample_products):
        """ZKP verification fails when proof is tampered or wrong password."""
        from backend.auth.zkp import zkp_auth

        password = zkp_agent._test_password
        public_key = zkp_agent.public_key

        # Get challenge token
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        # Create proof with WRONG password
        wrong_password = "wrong_password"
        proof, _ = zkp_auth.sign_data(wrong_password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response.status_code == 401
        assert "failed" in response.json()["detail"]["message"].lower()

    def test_zkp_token_expired(self, client, zkp_agent, sample_products):
        """ZKP verification fails with an expired token (simulated by clearing store)."""
        from backend.auth.zkp import zkp_auth
        from backend.api.chat import _challenge_store as challenge_store

        password = zkp_agent._test_password
        public_key = zkp_agent.public_key

        # Get challenge token
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        # Manually expire the token in the store (used by chat.py endpoint)
        challenge_store[zkp_token]["expires"] = 0

        # Create proof (still valid format-wise)
        proof, _ = zkp_auth.sign_data(password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response.status_code == 401
        assert "expired" in response.json()["detail"]["message"].lower()

    def test_zkp_proof_replay_rejected(self, client, zkp_agent, sample_products):
        """Same proof cannot be used twice (single-use token)."""
        from backend.auth.zkp import zkp_auth

        password = zkp_agent._test_password
        public_key = zkp_agent.public_key

        # Get challenge token
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        # Create proof
        proof, _ = zkp_auth.sign_data(password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        # First request succeeds
        response1 = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response1.status_code == 200

        # Second request with same token fails (consumed)
        response2 = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response2.status_code == 401
        assert "expired" in response2.json()["detail"]["message"].lower() or \
               "invalid" in response2.json()["detail"]["message"].lower()

    def test_zkp_timing_metrics(self, client, zkp_agent, sample_products):
        """ZKP auth returns timing breakdown (intent, auth, execution)."""
        from backend.auth.zkp import zkp_auth

        password = zkp_agent._test_password
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        proof, _ = zkp_auth.sign_data(password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response.status_code == 200
        data = response.json()

        timing = data["timing"]
        assert "intent_extraction" in timing
        assert "authentication" in timing
        assert "execution" in timing

        auth_info = data["auth_info"]
        assert "verification_time" in auth_info


class TestZKPDataIntegrity:
    """Tests that ZKP agent stores only public key, never password."""

    def test_zkp_agent_has_public_key_not_password(self, client, db):
        """Seeded ZKP agent has public_key stored; no plain password anywhere."""
        seed_response = client.post("/api/demo/seed")
        assert seed_response.status_code == 200
        seed_data = seed_response.json()
        zkp_agent_id = seed_data["zkp_agent"]["id"]

        from backend.db.models import Agent
        agent = db.query(Agent).filter(Agent.id == zkp_agent_id).first()

        assert agent.public_key is not None
        assert len(agent.public_key) > 0
        # Agent model has no secret_plain column
        assert not hasattr(agent, "secret_plain")

    def test_server_never_receives_password(self, client, zkp_agent, sample_products):
        """The /api/chat/intent endpoint never receives the client's password.

        Password stays in the browser. Server only gets zkp_token + zkp_proof.
        """
        from backend.auth.zkp import zkp_auth

        password = zkp_agent._test_password

        # Full flow — password used only to compute proof locally
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]
        public_key = zkp_agent.public_key

        proof, _ = zkp_auth.sign_data(password, public_key, zkp_token)
        proof_obj = json.loads(proof)
        proof_data = f'{{"commitment": {proof_obj["commitment"]}, "response": {proof_obj["response"]}}}'

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof_data,
            }
        )
        assert response.status_code == 200
        # Server response contains no password
        assert "password" not in response.json().get("auth_info", {}).get("proof", "")