import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db.models import Agent


def test_zkp_register_stores_public_key(client, db):
    public_key_json = json.dumps({
        "y": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890",
        "p": "1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff",
        "g": "4",
        "q": "e798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff",
    })
    # Seed first so agents exist
    client.post("/api/demo/seed")
    response = client.post("/api/auth/zkp/register", data={
        "agent_id": "2",
        "public_key": public_key_json,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "ZKP public key registered. Server NEVER stores the private key."
    assert data["agent_id"] == 2


def test_zkp_register_rejects_invalid_json(client, db):
    client.post("/api/demo/seed")
    response = client.post("/api/auth/zkp/register", data={
        "agent_id": "2",
        "public_key": "not valid json",
    })
    assert response.status_code == 400
    assert "public_key must be JSON" in response.json()["detail"]["message"]


def test_zkp_register_rejects_missing_fields(client, db):
    client.post("/api/demo/seed")
    response = client.post("/api/auth/zkp/register", data={
        "agent_id": "2",
        "public_key": json.dumps({"y": "abc", "p": "def"}),  # missing g, q
    })
    assert response.status_code == 400


def test_zkp_register_rejects_nonexistent_agent(client, db):
    response = client.post("/api/auth/zkp/register", data={
        "agent_id": "9999",
        "public_key": json.dumps({"y": "abc", "p": "def", "g": "4", "q": "123"}),
    })
    assert response.status_code == 404


def test_zkp_register_rejects_oauth2_agent(client, db):
    client.post("/api/demo/seed")
    response = client.post("/api/auth/zkp/register", data={
        "agent_id": "1",
        "public_key": json.dumps({"y": "abc", "p": "def", "g": "4", "q": "123"}),
    })
    assert response.status_code == 400
    assert "Only ZKP agents" in response.json()["detail"]["message"]