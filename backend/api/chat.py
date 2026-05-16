from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import time
import uuid

from ..db.models import Agent, get_db
from ..agents.intent import intent_extractor, tool_caller
from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..utils.errors import AppError, ErrorCode
from ..utils.config import settings

router = APIRouter(prefix="/api/chat", tags=["chat"])

# --- In-memory challenge store for ZKP (token -> {agent_id, expires}) ---
# In production, use Redis with TTL. For demo, small dict with TTL check.
_CHALLENGE_TTL_SECONDS = 60
_challenge_store: dict[str, dict] = {}  # token -> {agent_id, expires}


def _cleanup_expired_challenges():
    """Remove expired challenge tokens from _challenge_store to prevent memory leak."""
    now = time.time()
    for k in list(_challenge_store.keys()):
        if _challenge_store[k]["expires"] < now:
            del _challenge_store[k]


# Clean up on module load
_cleanup_expired_challenges()


class ChatRequest(BaseModel):
    message: str
    agent_id: int
    # ZKP flow: if zkp_token + zkp_proof are provided, password is IGNORED.
    # Password was used in the old demo flow; ZKP proves knowledge of secret
    # without the server ever seeing the password.
    password: Optional[str] = None
    zkp_token: Optional[str] = None  # Server-provided challenge token
    zkp_proof: Optional[str] = None  # Client-computed proof (commitment:response)


class ChatResponse(BaseModel):
    intent: dict
    result: dict
    timing: dict
    auth_info: dict


# GET /api/chat/zkp-challenge/{agent_id}
# Returns a challenge token the client uses to compute a ZKP proof locally.
@router.get("/zkp-challenge/{agent_id}")
async def zkp_get_challenge(agent_id: int, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise AppError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            message=f"Agent {agent_id} not found",
            status_code=404
        )
    if agent.auth_type != "zkp":
        raise AppError(
            error_code=ErrorCode.INVALID_PARAMETER,
            message="This endpoint is only for ZKP agents",
            status_code=400
        )

    # Generate challenge token: UUID v4, unique per challenge
    if settings.vulnerable_rng:
        token = f"predictable-token-{int(time.time())}"
    else:
        token = str(uuid.uuid4())
    _challenge_store[token] = {"agent_id": agent_id, "expires": time.time() + _CHALLENGE_TTL_SECONDS}

    # Clean up expired tokens
    _cleanup_expired_challenges()

    return {"zkp_token": token, "agent_id": agent_id}


@router.post("/intent", response_model=ChatResponse)
async def extract_and_execute(request: ChatRequest, http_request: Request = None, db: Session = Depends(get_db)):
    timing = {}
    auth_info = {}

    # Look up agent
    agent = db.query(Agent).filter(Agent.id == request.agent_id).first()
    if not agent:
        raise AppError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            message=f"Agent {request.agent_id} not found",
            status_code=404
        )

    # Step 1: Extract intent
    intent_start = time.time()
    intent = await intent_extractor.extract_intent(request.message)
    timing["intent_extraction"] = time.time() - intent_start

    # Step 2: Authenticate based on agent.auth_type
    auth_start = time.time()

    # SIMULATE VULNERABLE LOGGING: Capture all headers including secrets
    if http_request:
        settings.log_buffer.append({
            "timestamp": time.time(),
            "path": "/api/chat/intent",
            "headers": dict(http_request.headers),
            "body_summary": f"agent_id={request.agent_id}"
        })
        # Keep buffer small
        if len(settings.log_buffer) > 20:
            settings.log_buffer.pop(0)

        # SIMULATE MITM INTERCEPTION — populate when tls_downgrade_active=False (vulnerable)
        # When tls_downgrade_active=True, mTLS/pinning prevents proxy from reading traffic
        if not settings.tls_downgrade_active:
            settings.proxy_buffer.append({
                "timestamp": time.time(),
                "path": "/api/chat/intent",
                "headers": dict(http_request.headers),
                "body": request.dict()
            })
            if len(settings.proxy_buffer) > 20:
                settings.proxy_buffer.pop(0)

    if agent.auth_type == "oauth2":
        # OAuth2 PKJWT: verify incoming Bearer token from Authorization header
        auth_header = http_request.headers.get("Authorization", "") if http_request else ""
        if not auth_header.startswith("Bearer "):
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="OAuth2 requires Bearer token: Authorization: Bearer <access_token>",
                status_code=401
            )
        bearer_token = auth_header[7:]  # strip "Bearer "
        payload = oauth2_auth.verify_token(bearer_token)
        token_info = oauth2_auth.get_token_info(bearer_token)
        auth_info = {
            "type": "oauth2",
            "token": bearer_token,
            "token_info": token_info,
            "verification_time": payload.get("verification_time", 0),
            "token_size": len(bearer_token),
            "agent_id": request.agent_id,
        }
    elif agent.auth_type == "zkp":
        # ZKP authentication: server stores only the public key (ZKSignature).
        # Client computes the proof locally using their secret password.
        # Server verifies the proof — never sees the password.
        if not agent.public_key:
            raise AppError(
                error_code=ErrorCode.INVALID_OPERATION,
                message="ZKP agent has no public key stored",
                status_code=500
            )
        if not request.zkp_token or not request.zkp_proof:
            raise AppError(
                error_code=ErrorCode.MISSING_PARAMETER,
                message="zkp_token and zkp_proof required for ZKP authentication",
                status_code=400
            )
        # Validate challenge token: must exist, not expired, belong to this agent
        now = time.time()
        challenge = _challenge_store.get(request.zkp_token)
        if not challenge or challenge.get("expires", 0) < now:
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="Invalid or expired ZKP challenge token",
                status_code=401
            )
        if challenge["agent_id"] != agent.id:
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="ZKP challenge token not for this agent",
                status_code=401
            )
        # Consume the token (single-use)
        del _challenge_store[request.zkp_token]

        # Verify the proof against the stored public key
        is_valid, verify_time = zkp_auth.verify_proof(
            request.zkp_proof, agent.public_key, request.zkp_token
        )
        if not is_valid:
            raise AppError(
                error_code=ErrorCode.AUTH_FAILED,
                message="ZKP proof verification failed",
                status_code=401
            )
        proof_info = zkp_auth.get_proof_info(request.zkp_proof)
        auth_info = {
            "type": "zkp",
            "proof": request.zkp_proof,
            "proof_info": proof_info,
            "verification_time": verify_time,
            "token_size": proof_info.get("proof_size", 0),
            "agent_id": request.agent_id,
        }
    else:
        raise AppError(
            error_code=ErrorCode.INVALID_PARAMETER,
            message=f"Unsupported auth_type: {agent.auth_type}",
            status_code=400
        )
    timing["authentication"] = time.time() - auth_start

    # Step 3: Execute tool call
    execution_start = time.time()
    result = await tool_caller.call_tool(intent, agent.auth_type, request.agent_id, db=db)
    timing["execution"] = time.time() - execution_start

    timing["total"] = sum(timing.values())

    return ChatResponse(
        intent=intent.dict(),
        result=result,
        timing=timing,
        auth_info=auth_info
    )