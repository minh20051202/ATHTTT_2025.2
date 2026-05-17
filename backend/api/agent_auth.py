import time

from fastapi import Request

from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..db.models import Agent
from ..utils.errors import AppError, ErrorCode


def consume_zkp_challenge(agent_id: int, zkp_token: str) -> None:
    from .chat import _challenge_store

    now = time.time()
    challenge = _challenge_store.get(zkp_token)
    if not challenge or challenge.get("expires", 0) < now:
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="Invalid or expired ZKP challenge token",
            status_code=401,
        )
    if challenge["agent_id"] != agent_id:
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="ZKP challenge token not for this agent",
            status_code=401,
        )
    del _challenge_store[zkp_token]


def verify_oauth2_agent_request(agent: Agent, http_request: Request) -> dict:
    auth_header = http_request.headers.get("Authorization", "") if http_request else ""
    if not auth_header.startswith("Bearer "):
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="OAuth2 requires Bearer token: Authorization: Bearer <access_token>",
            status_code=401,
        )

    bearer_token = auth_header[7:]
    payload = oauth2_auth.verify_token(bearer_token)
    try:
        token_agent_id = int(payload.get("sub") or payload.get("client_id") or 0)
    except (TypeError, ValueError):
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="Bearer token agent id is invalid",
            status_code=401,
        )

    if token_agent_id != agent.id:
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="Bearer token agent mismatch",
            status_code=401,
        )

    token_info = oauth2_auth.get_token_info(bearer_token)
    return {
        "type": "oauth2",
        "token": bearer_token,
        "token_info": token_info,
        "verification_time": payload.get("verification_time", 0),
        "token_size": len(bearer_token),
        "agent_id": agent.id,
    }


def verify_zkp_agent_request(
    agent: Agent,
    zkp_token: str | None,
    zkp_proof: str | None,
) -> dict:
    if not agent.public_key:
        raise AppError(
            error_code=ErrorCode.INVALID_OPERATION,
            message="ZKP agent has no public key stored",
            status_code=500,
        )
    if not zkp_token or not zkp_proof:
        raise AppError(
            error_code=ErrorCode.MISSING_PARAMETER,
            message="zkp_token and zkp_proof required for ZKP authentication",
            status_code=400,
        )

    consume_zkp_challenge(agent.id, zkp_token)
    is_valid, verify_time = zkp_auth.verify_proof(zkp_proof, agent.public_key, zkp_token)
    if not is_valid:
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="ZKP proof verification failed",
            status_code=401,
        )

    proof_info = zkp_auth.get_proof_info(zkp_proof)
    return {
        "type": "zkp",
        "proof": zkp_proof,
        "proof_info": proof_info,
        "verification_time": verify_time,
        "token_size": proof_info.get("proof_size", 0),
        "agent_id": agent.id,
    }


def verify_agent_request(
    agent: Agent,
    http_request: Request,
    zkp_token: str | None = None,
    zkp_proof: str | None = None,
) -> dict:
    if agent.auth_type == "oauth2":
        return verify_oauth2_agent_request(agent, http_request)
    if agent.auth_type == "zkp":
        return verify_zkp_agent_request(agent, zkp_token, zkp_proof)
    raise AppError(
        error_code=ErrorCode.INVALID_PARAMETER,
        message=f"Unsupported auth_type: {agent.auth_type}",
        status_code=400,
    )
