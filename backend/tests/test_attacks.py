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
        proof, _ = zkp_auth.sign_data(agent._test_password, agent.public_key, zkp_token)
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
        assert data["details"]["vulnerability"] == "OAuth2 tokens are reusable"

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
        # ZKP should have no vulnerability (or "None")
        assert data["details"]["vulnerability"] in ("None - ZKP proofs are non-reusable", "None")

    def test_token_theft_on_oauth2_exposes_data(self, client, oauth2_pkjwt_agent):
        """Token theft on OAuth2 exposes credential data."""
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        attack_response = client.post(
            "/api/attacks/token-theft",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "token_theft"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["attack_type"] == "token_theft"
        assert "stolen_data" in data["details"]
        assert "token" in data["attack_type"]
        assert data["details"]["vulnerability"] == "OAuth2 tokens expose user credentials"

    def test_token_theft_on_zkp_does_not_expose_credentials(self, client, zkp_agent):
        """Token theft on ZKP does NOT expose credentials."""
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)

        attack_response = client.post(
            "/api/attacks/token-theft",
            json={
                "auth_type": "zkp",
                "token": proof,
                "attack_type": "token_theft"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is False
        assert data["auth_type"] == "zkp"
        assert "None" in data["details"]["vulnerability"]
        assert data["details"]["attack_successful"] is False

    def test_credential_stuffing_on_oauth2_succeeds(self, client, oauth2_pkjwt_agent):
        """Credential stuffing on OAuth2 succeeds with stolen token."""
        token = self._get_oauth2_bearer_token(client, oauth2_pkjwt_agent)

        attack_response = client.post(
            "/api/attacks/credential-stuffing",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "credential_stuffing",
                "agent_id": oauth2_pkjwt_agent.id
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["attack_type"] == "credential_stuffing"

    def test_credential_stuffing_on_zkp_fails(self, client, zkp_agent):
        """Credential stuffing on ZKP fails without the password."""
        zkp_token, proof = self._get_zkp_proof(client, zkp_agent)

        attack_response = client.post(
            "/api/attacks/credential-stuffing",
            json={
                "auth_type": "zkp",
                "token": proof,
                "attack_type": "credential_stuffing"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is False
        assert data["auth_type"] == "zkp"

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
