import json
import pytest


class TestAttackSimulations:
    """Test attack simulation endpoints to demonstrate OAuth2 vs ZKP security."""

    def _get_oauth2_bearer_token(self, client, agent):
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

    def _get_zkp_proof(self, client, agent):
        """Helper: get ZKP challenge + generate proof."""
        challenge_resp = client.get(f"/api/chat/zkp-challenge/{agent.id}")
        assert challenge_resp.status_code == 200
        zkp_token = challenge_resp.json()["zkp_token"]

        from backend.auth.zkp import zkp_auth
        proof, _ = zkp_auth.sign_data(agent._test_private_key, agent.public_key, zkp_token)
        return zkp_token, proof

    def test_replay_attack_on_oauth2_succeeds(self, client, oauth2_pkjwt_agent):
        """Replaying a valid OAuth2 Bearer token succeeds -- OAuth2 is vulnerable."""
        # Get a valid Bearer token
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        # Launch replay attack
        attack_response = client.post(
            "/api/attacks/replay",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "replay",
                "agent_id": oauth2_pkjwt_agent.id
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["auth_type"] == "oauth2"
        assert data["attack_type"] == "replay"
        assert "tokens are reusable" in data["details"]["vulnerability"]

    def test_replay_attack_on_zkp_fails(self, client, zkp_agent):
        """Replaying a ZKP proof fails -- ZKP is protected against replay."""
        # First: get a valid proof from chat
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)

        # Launch replay attack
        attack_response = client.post(
            "/api/attacks/replay",
            json={
                "auth_type": "zkp",
                "token": proof,
                "attack_type": "replay"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is False
        assert data["auth_type"] == "zkp"
        assert "vulnerability" in data["details"]
        assert "replay is blocked" in data["details"]["vulnerability"]

    def test_credential_theft_on_oauth2_exposes_data(self, client, oauth2_pkjwt_agent):
        """Credential theft on OAuth2 exposes credential data."""
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        attack_response = client.post(
            "/api/attacks/credential-theft",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "credential-theft"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["attack_type"] == "credential-theft"
        assert "exposed_data" in data["details"]
        assert "Credential Theft" in data["details"]["vulnerability"]

    def test_credential_theft_from_logs(self, client, oauth2_pkjwt_agent):
        from backend.auth.oauth2 import oauth2_auth
        token = oauth2_auth.create_access_token(data={"sub": str(oauth2_pkjwt_agent.id)})
        
        # 1. Make a real chat call
        client.post("/api/chat/intent", 
                    json={"message": "buy milk", "agent_id": oauth2_pkjwt_agent.id},
                    headers={"Authorization": f"Bearer {token}"})
        
        # 2. Attack simulation should "find" this token in the mock log buffer
        attack_resp = client.post("/api/attacks/credential-theft", json={
            "auth_type": "oauth2",
            "token": "LOG_SEARCH_MODE",
            "attack_type": "credential-theft"
        })
        assert attack_resp.json()["success"] == True
        # Implementation should have found the token used above
        assert attack_resp.json()["details"]["exposed_data"]["stolen_token"] == token

    def test_credential_theft_on_zkp_exposes_simulated_password(self, client, zkp_agent):
        """Credential theft on ZKP succeeds in simulation to match matrix 'Vulnerable' status."""
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)

        attack_response = client.post(
            "/api/attacks/credential-theft",
            json={
                "auth_type": "zkp",
                "token": proof,
                "attack_type": "credential-theft"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["auth_type"] == "zkp"
        assert data["details"]["attack_successful"] is True
        assert "stolen_secret" in data["details"]["exposed_data"]

    def test_mitm_on_oauth2_intercepts_token(self, client, oauth2_pkjwt_agent):
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)
        resp = client.post("/api/attacks/mitm", json={"auth_type": "oauth2", "token": token, "attack_type": "mitm"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "Authorization" in data["details"]["intercepted_data"]["header_name"]

    def test_mitm_on_zkp_succeeds_in_simulation(self, client, zkp_agent):
        """MITM on ZKP succeeds in simulation to match matrix 'Vulnerable' status."""
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)
        resp = client.post("/api/attacks/mitm", json={"auth_type": "zkp", "token": proof, "attack_type": "mitm"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "captured_password" in data["details"]["intercepted_data"]

    def test_client_assertion_sub_oauth2_vulnerable(self, client, oauth2_pkjwt_agent):
        from backend.utils.config import settings
        settings.strict_assertion_check = False
        resp = client.post("/api/attacks/client-assertion-sub", 
            json={"auth_type": "oauth2", "token": "dummy", "attack_type": "client-assertion-sub", "agent_id": oauth2_pkjwt_agent.id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "vulnerability" in data["details"]

    def test_client_assertion_sub_oauth2_strict(self, client, oauth2_pkjwt_agent):
        from backend.utils.config import settings
        settings.strict_assertion_check = True
        resp = client.post("/api/attacks/client-assertion-sub", 
            json={"auth_type": "oauth2", "token": "dummy", "attack_type": "client-assertion-sub", "agent_id": oauth2_pkjwt_agent.id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False

    def test_proof_correlation_zkp_succeeds(self, client, zkp_agent):
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)
        resp = client.post("/api/attacks/proof-correlation", 
            json={"auth_type": "zkp", "token": proof, "attack_type": "proof-correlation"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "leaked_metadata" in data["details"]

    def test_challenge_predictability_zkp_vulnerable(self, client, zkp_agent):
        """Challenge predictability succeeds when vulnerable_rng is True."""
        from backend.utils.config import settings
        settings.vulnerable_rng = True
        
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)
        resp = client.post("/api/attacks/challenge-predictability", 
            json={"auth_type": "zkp", "token": zkp_token, "attack_type": "challenge-predictability"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "predicted_challenge_n_plus_1" in data["details"]["observation"]

    def test_challenge_predictability_zkp_secure(self, client, zkp_agent):
        """Challenge predictability fails when vulnerable_rng is False."""
        from backend.utils.config import settings
        settings.vulnerable_rng = False
        
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)
        resp = client.post("/api/attacks/challenge-predictability", 
            json={"auth_type": "zkp", "token": zkp_token, "attack_type": "challenge-predictability"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert "entropy" in data["details"]["observation"]

    def test_active_replay_attack_oauth2(self, client, oauth2_pkjwt_agent):
        """Replaying a valid OAuth2 Bearer token succeeds and exfiltrates real data."""
        # 1. Get a valid Bearer token
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        # 2. Launch replay attack
        attack_response = client.post(
            "/api/attacks/replay",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "replay",
                "agent_id": oauth2_pkjwt_agent.id
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["auth_type"] == "oauth2"
        # Verify that it contains "exfiltrated_data" with real-looking transactions
        assert "exfiltrated_data" in data["details"]
        assert "recent_transactions" in data["details"]["exfiltrated_data"]
        # It should have at least the transactions seeded for this agent
        assert isinstance(data["details"]["exfiltrated_data"]["recent_transactions"], list)

    def test_invalid_auth_type_returns_error(self, client, oauth2_pkjwt_agent):
        """Invalid auth_type in attack endpoints returns 400."""
        attack_response = client.post(
            "/api/attacks/replay",
            json={
                "auth_type": "invalid",
                "token": "some_token",
                "attack_type": "replay"
            }
        )
        assert attack_response.status_code == 400
