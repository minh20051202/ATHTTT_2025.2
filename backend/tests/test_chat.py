import pytest


class TestChatEndpoint:
    """Integration tests for the /api/chat/intent endpoint."""
    pytestmark = pytest.mark.usefixtures("mock_intent_extractor")

    def _get_oauth2_token(self, client, agent):
        """Helper: get OAuth2 access token via client_assertion flow."""
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

    def test_chat_returns_intent_result_timing_auth(self, client, oauth2_pkjwt_agent, sample_products, db):
        """Chat endpoint returns intent, result, timing, and auth info."""
        access_token = self._get_oauth2_token(client, oauth2_pkjwt_agent)

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        data = response.json()

        # All required fields present
        assert "intent" in data
        assert "result" in data
        assert "timing" in data
        assert "auth_info" in data

    def test_chat_oauth2_auth_info_format(self, client, oauth2_pkjwt_agent, sample_products):
        """OAuth2 chat auth_info contains JWT token and metadata."""
        access_token = self._get_oauth2_token(client, oauth2_pkjwt_agent)

        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 200
        auth_info = response.json()["auth_info"]

        assert auth_info["type"] == "oauth2"
        assert "token" in auth_info
        assert "token_info" in auth_info
        # Should NOT have proof fields
        assert "proof" not in auth_info

    def test_chat_zkp_auth_info_format(self, client, zkp_agent, sample_products):
        """ZKP chat auth_info contains proof and timing breakdown."""
        # Step 1: Get challenge token
        hex_private_key = zkp_agent._test_private_key
        challenge_resp = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        assert challenge_resp.status_code == 200
        zkp_token = challenge_resp.json()["zkp_token"]

        # Step 2: Generate proof client-side using sign_data (hex private key)
        from backend.auth.zkp import zkp_auth
        proof, _ = zkp_auth.sign_data(hex_private_key, zkp_agent.public_key, zkp_token)

        # Step 3: Call intent with token + proof
        response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof
            }
        )
        assert response.status_code == 200
        auth_info = response.json()["auth_info"]

        assert auth_info["type"] == "zkp"
        assert "proof" in auth_info
        assert "proof_info" in auth_info
        assert "verification_time" in auth_info
        assert "token" not in auth_info  # No JWT for ZKP

    def test_chat_oauth2_vs_zkp_timing_comparison(self, client, oauth2_pkjwt_agent, zkp_agent, sample_products):
        """ZKP auth has measurable overhead compared to OAuth2 due to crypto."""
        # OAuth2: get token, then call intent
        access_token = self._get_oauth2_token(client, oauth2_pkjwt_agent)
        oauth_response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_pkjwt_agent.id},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        oauth_auth_time = oauth_response.json()["timing"]["authentication"]

        # ZKP: get challenge, generate proof, call intent
        challenge_resp = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
        assert challenge_resp.status_code == 200
        zkp_token = challenge_resp.json()["zkp_token"]

        from backend.auth.zkp import zkp_auth
        proof, _ = zkp_auth.sign_data(zkp_agent._test_private_key, zkp_agent.public_key, zkp_token)

        zkp_response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "zkp_token": zkp_token,
                "zkp_proof": proof
            }
        )
        zkp_auth_time = zkp_response.json()["timing"]["authentication"]

        # ZKP should have measurable overhead compared to OAuth2
        assert oauth_response.status_code == 200
        assert zkp_response.status_code == 200
        assert zkp_auth_time > 0
        assert oauth_auth_time > 0

    def test_chat_seed_endpoint_creates_both_agents(self, client):
        """Seed endpoint creates both OAuth2 and ZKP agents."""
        response = client.post("/api/demo/seed")
        assert response.status_code == 200
        data = response.json()

        assert "oauth2_agent" in data
        assert "zkp_agent" in data
        assert "user" in data
        assert "products" in data

        assert data["oauth2_agent"]["auth_type"] == "oauth2"
        assert data["zkp_agent"]["auth_type"] == "zkp"
        assert len(data["products"]) == 4

    def test_chat_unknown_agent_returns_404(self, client):
        """Chat returns 404 when agent_id doesn't exist."""
        response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": 999999}
        )
        assert response.status_code == 404


@pytest.mark.usefixtures("mock_intent_extractor")
def test_chat_oauth2_verifies_with_server_secret(client):
    """OAuth2 /intent verifies access token using HS256 server symmetric secret.

    Access tokens are minted with the server's jwt_secret_key (HS256).
    Client_assertion is still RS256 (signed with client-held private key, verified with registered public key).
    """
    from backend.auth.oauth2 import oauth2_auth
    from jose import jwt

    # Seed creates agent with public_key=NULL — client must register its public key first
    seed_resp = client.post("/api/demo/seed")
    seed_data = seed_resp.json()
    oauth2_agent = seed_data.get("oauth2_agent", {})
    agent_id = oauth2_agent["id"]

    # Client (test) generates a keypair and registers the public key
    public_pem, private_pem = oauth2_auth.create_rsa_keypair()
    register_resp = client.post("/api/auth/oauth2/register", data={
        "client_id": str(agent_id),
        "public_key_pem": public_pem,
    })
    assert register_resp.status_code == 200, f"Register failed: {register_resp.text}"

    # Client signs client_assertion with private key, exchanges for access token (now HS256)
    assertion, _ = oauth2_auth.create_client_assertion(str(agent_id), private_pem)
    token_resp = client.post("/api/auth/oauth2/token", data={
        "client_id": str(agent_id),
        "client_assertion": assertion,
    })
    assert token_resp.status_code == 200, f"Token failed: {token_resp.text}"
    access_token = token_resp.json()["access_token"]

    # Access token must be HS256 (server symmetric), not RS256 per-agent
    header = jwt.get_unverified_header(access_token)
    assert header["alg"] == "HS256", f"Expected HS256, got {header['alg']}"

    # Call /intent with the HS256 access token
    resp = client.post("/api/chat/intent",
        json={"message": "what is the price of Laptop", "agent_id": agent_id},
        headers={"Authorization": f"Bearer {access_token}"}
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["auth_info"]["type"] == "oauth2"
    assert "verification_time" in data["auth_info"]
    assert "token_size" in data["auth_info"]


def test_zkp_challenge_store_cleanup(client, db, demo_user):
    """Expired challenge tokens must be removed from _challenge_store on every challenge fetch."""
    import time, secrets, json as _json
    from backend.api.chat import _challenge_store, _cleanup_expired_challenges
    from backend.db.models import Agent

    # Simulate client-side keypair generation: random private key, public key computed locally
    from backend.auth import zkp as zkp_module
    P = zkp_module._DHP
    Q = zkp_module._DHQ
    G = zkp_module._DHG
    private_key_int = secrets.randbelow(Q)
    public_key_int = pow(G, private_key_int, P)
    public_key_json = _json.dumps({
        "y": format(public_key_int, 'x'), "p": format(P, 'x'), "g": format(G, 'x'), "q": format(Q, 'x'),
    })

    zkp_agent = Agent(
        user_id=demo_user.id,
        name="Test ZKP Agent",
        auth_type="zkp",
        credentials_hash=None,
        public_key=public_key_json,
    )
    db.add(zkp_agent)
    db.commit()
    db.refresh(zkp_agent)

    # Inject an expired token directly into the store
    expired = "test_expired_token_xyz"
    _challenge_store[expired] = {"agent_id": zkp_agent.id, "expires": time.time() - 60}

    resp = client.get(f"/api/chat/zkp-challenge/{zkp_agent.id}")
    assert resp.status_code == 200

    # Expired token must be gone after get_challenge triggers cleanup
    assert expired not in _challenge_store, f"Expired token still in store: {list(_challenge_store.keys())}"
