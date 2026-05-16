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
    """Tests for ZKP authentication flow using the three-pass Schnorr protocol."""

    def test_sign_data_accepts_hex_private_key(self):
        """sign_data accepts a raw hex private key (from client-side generateKeyPair)."""
        from backend.auth.zkp import zkp_auth

        # Simulate what frontend generateKeyPair() produces: a random hex private key
        hex_private_key = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
        public_key = json.dumps({
            "y": "0x123456789abcdef",
            "p": "0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff",
            "g": "0x4",
            "q": "0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff",
        })

        token, _ = zkp_auth.create_token()
        proof, sign_time = zkp_auth.sign_data(hex_private_key, public_key, token)
        assert proof is not None
        assert sign_time > 0

        # Proof must be valid JSON with hex commitment and response
        proof_obj = json.loads(proof)
        assert "commitment" in proof_obj
        assert "response" in proof_obj
        # Both must be parseable as hex integers
        assert int(proof_obj["commitment"], 16)
        assert int(proof_obj["response"], 16)

    def test_token_store_single_use(self):
        """A generate_token token can only be consumed once (consume_token removes it)."""
        from backend.auth.zkp import generate_token, consume_token

        token = generate_token(agent_id=1)
        consumed1 = consume_token(token, expected_agent_id=1)
        assert consumed1 is True

        # Second consume: token already gone
        consumed2 = consume_token(token, expected_agent_id=1)
        assert consumed2 is False

    def test_verify_proof_with_valid_hex_key(self):
        """verify_proof accepts hex-format Schnorr proofs from sign_data."""
        from backend.auth import zkp as zkp_module
        from backend.auth.zkp import zkp_auth
        import secrets

        P = zkp_module._DHP
        Q = zkp_module._DHQ
        G = zkp_module._DHG

        private_key_int = secrets.randbelow(Q)
        public_key_int = pow(G, private_key_int, P)
        public_key = json.dumps({
            "y": format(public_key_int, 'x'),
            "p": format(P, 'x'),
            "g": format(G, 'x'),
            "q": format(Q, 'x'),
        })
        hex_private_key = format(private_key_int, 'x')

        token, _ = zkp_auth.create_token()
        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, token)

        is_valid, verify_time = zkp_auth.verify_proof(proof, public_key, token)
        assert is_valid is True
        assert verify_time > 0

    def test_verify_proof_wrong_private_key_fails(self):
        """Proof created with wrong private key fails verification."""
        from backend.auth import zkp as zkp_module
        from backend.auth.zkp import zkp_auth
        import secrets

        P = zkp_module._DHP
        Q = zkp_module._DHQ
        G = zkp_module._DHG

        correct_key = secrets.randbelow(Q)
        wrong_key = secrets.randbelow(Q)
        public_key_int = pow(G, correct_key, P)
        public_key = json.dumps({
            "y": format(public_key_int, 'x'),
            "p": format(P, 'x'),
            "g": format(G, 'x'),
            "q": format(Q, 'x'),
        })

        token, _ = zkp_auth.create_token()
        proof, _ = zkp_auth.sign_data(format(wrong_key, 'x'), public_key, token)

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
    """Tests for POST /api/chat/intent with ZKP authentication (three-pass Schnorr)."""

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
        """Full three-pass Schnorr ZKP flow: challenge → proof → intent."""
        from backend.auth.zkp import zkp_auth

        hex_private_key = zkp_agent._test_private_key
        public_key = zkp_agent.public_key

        # Step 1: get challenge token
        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        assert challenge_response.status_code == 200
        zkp_token = challenge_response.json()["zkp_token"]

        # Step 2: compute proof (simulates frontend zkp.js computeProof)
        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, zkp_token)

        # Step 3: send intent with token + proof
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            }
        )
        assert response.status_code == 200
        data = response.json()

        assert data["auth_info"]["type"] == "zkp"
        assert "proof" in data["auth_info"]
        assert "proof_info" in data["auth_info"]
        assert "verification_time" in data["auth_info"]

    def test_zkp_wrong_proof_fails(self, client, zkp_agent, sample_products):
        """ZKP verification fails when proof is created with wrong private key."""
        from backend.auth.zkp import zkp_auth
        import secrets

        wrong_key = format(secrets.randbelow(0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff), 'x')
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        proof, _ = zkp_auth.sign_data(wrong_key, public_key, zkp_token)

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            }
        )
        assert response.status_code == 401

    def test_zkp_token_expired(self, client, zkp_agent, sample_products):
        """ZKP verification fails with an expired token."""
        from backend.auth.zkp import zkp_auth
        from backend.api.chat import _challenge_store

        hex_private_key = zkp_agent._test_private_key
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        # Manually expire the token in the store
        _challenge_store[zkp_token]["expires"] = 0

        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, zkp_token)

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            }
        )
        assert response.status_code == 401

    def test_zkp_proof_replay_rejected(self, client, zkp_agent, sample_products):
        """Same token+proof cannot be used twice (single-use token)."""
        from backend.auth.zkp import zkp_auth

        hex_private_key = zkp_agent._test_private_key
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, zkp_token)

        # First request succeeds
        response1 = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
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
                "zkp_proof": proof,
            }
        )
        assert response2.status_code == 401

    def test_zkp_timing_metrics(self, client, zkp_agent, sample_products):
        """ZKP auth returns timing breakdown (intent, auth, execution)."""
        from backend.auth.zkp import zkp_auth

        hex_private_key = zkp_agent._test_private_key
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, zkp_token)

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
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
    """Tests that ZKP agent stores only public key, never private key or password."""

    def test_zkp_agent_credentials_hash_is_null(self, client, db):
        """ZKP agent has credentials_hash=NULL (no shared secret stored)."""
        response = client.post("/api/demo/seed")
        assert response.status_code == 200
        seed_data = response.json()
        zkp_agent_id = seed_data["zkp_agent"]["id"]

        from backend.db.models import Agent
        agent = db.query(Agent).filter(Agent.id == zkp_agent_id).first()

        assert agent is not None
        assert agent.auth_type == "zkp"
        assert agent.credentials_hash is None

    def test_zkp_agent_public_key_registered_by_client(self, client, db, demo_user):
        """ZKP agent public_key starts NULL after seed; client registers it.

        Seed creates agent with public_key=NULL. Client generates a random keypair,
        sends only public key to /api/auth/zkp/register. Server stores it.
        """
        from backend.db.models import Agent

        # Seed creates ZKP agent with public_key=NULL
        response = client.post("/api/demo/seed")
        assert response.status_code == 200
        zkp_agent_id = response.json()["zkp_agent"]["id"]

        agent = db.query(Agent).filter(Agent.id == zkp_agent_id).first()
        assert agent.public_key is None

        # Simulate client registering public key
        import secrets, json as _json
        from backend.auth import zkp as zkp_module
        P = zkp_module._DHP
        Q = zkp_module._DHQ
        G = zkp_module._DHG
        private_key_int = secrets.randbelow(Q)
        public_key_int = pow(G, private_key_int, P)
        public_key_json = _json.dumps({
            "y": format(public_key_int, 'x'),
            "p": format(P, 'x'),
            "g": format(G, 'x'),
            "q": format(Q, 'x'),
        })

        reg_resp = client.post("/api/auth/zkp/register", data={
            "agent_id": zkp_agent_id,
            "public_key": public_key_json,
        })
        assert reg_resp.status_code == 200

        db.refresh(agent)
        assert agent.public_key is not None
        assert "y" in agent.public_key

    def test_server_never_receives_password(self, client, zkp_agent, sample_products):
        """The /api/chat/intent endpoint never receives the client's private key.

        Server gets zkp_token + zkp_proof. Private key stays in browser/client memory.
        """
        from backend.auth.zkp import zkp_auth

        hex_private_key = zkp_agent._test_private_key
        public_key = zkp_agent.public_key

        challenge_response = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        zkp_token = challenge_response.json()["zkp_token"]

        proof, _ = zkp_auth.sign_data(hex_private_key, public_key, zkp_token)

        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof,
            }
        )
        assert response.status_code == 200
        response_text = json.dumps(response.json()).lower()
        assert hex_private_key not in response_text
        assert "password" not in response_text
        assert not hasattr(zkp_agent, "secret_plain")