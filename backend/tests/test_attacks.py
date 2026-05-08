import pytest


class TestAttackSimulations:
    """Test attack simulation endpoints to demonstrate OAuth2 vs ZKP security."""

    def test_replay_attack_on_oauth2_succeeds(self, client, oauth2_agent):
        """Replaying a valid OAuth2 token succeeds — OAuth2 is vulnerable."""
        # Get a valid token
        chat_response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_agent.id}
        )
        token = chat_response.json()["auth_info"]["token"]

        # Launch replay attack
        attack_response = client.post(
            "/api/attacks/replay",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "replay"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["auth_type"] == "oauth2"
        assert data["attack_type"] == "replay"
        assert data["details"]["vulnerability"] == "OAuth2 tokens are reusable"

    def test_replay_attack_on_zkp_fails(self, client, zkp_agent):
        """Replaying a ZKP proof fails — ZKP is protected against replay."""
        password = zkp_agent._test_password

        # First: get a valid proof from chat
        chat_response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "password": password
            }
        )
        proof = chat_response.json()["auth_info"]["proof"]

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

    def test_token_theft_on_oauth2_exposes_data(self, client, oauth2_agent):
        """Token theft on OAuth2 exposes credential data."""
        chat_response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_agent.id}
        )
        token = chat_response.json()["auth_info"]["token"]

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
        password = zkp_agent._test_password

        chat_response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "password": password
            }
        )
        proof = chat_response.json()["auth_info"]["proof"]

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

    def test_credential_stuffing_on_oauth2_succeeds(self, client, oauth2_agent):
        """Credential stuffing on OAuth2 succeeds with stolen token."""
        chat_response = client.post(
            "/api/chat/intent",
            json={"message": "search for Laptop", "agent_id": oauth2_agent.id}
        )
        token = chat_response.json()["auth_info"]["token"]

        attack_response = client.post(
            "/api/attacks/credential-stuffing",
            json={
                "auth_type": "oauth2",
                "token": token,
                "attack_type": "credential_stuffing"
            }
        )

        assert attack_response.status_code == 200
        data = attack_response.json()
        assert data["success"] is True
        assert data["attack_type"] == "credential_stuffing"

    def test_credential_stuffing_on_zkp_fails(self, client, zkp_agent):
        """Credential stuffing on ZKP fails without the password."""
        password = zkp_agent._test_password

        chat_response = client.post(
            "/api/chat/intent",
            json={
                "message": "search for Laptop",
                "agent_id": zkp_agent.id,
                "password": password
            }
        )
        proof = chat_response.json()["auth_info"]["proof"]

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

    def test_invalid_auth_type_returns_error(self, client, oauth2_agent):
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