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

router = APIRouter(prefix="/api/chat", tags=["chat"])

# --- In-memory challenge store for ZKP (token -> {agent_id, expires}) ---
# In production, use Redis with TTL. For demo, small dict with TTL check.
_CHALLENGE_TTL_SECONDS = 60
_challenge_store: dict[str, dict] = {}  # token -> {agent_id, expires}


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
    token = str(uuid.uuid4())
    _challenge_store[token] = {"agent_id": agent_id, "expires": time.time() + _CHALLENGE_TTL_SECONDS}

    # Clean up expired tokens
    now = time.time()
    for k, v in list(_challenge_store.items()):
        if v["expires"] < now:
            del _challenge_store[k]

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
        auth_info = {
            "type": "oauth2",
            "token": bearer_token[:20] + "..." if len(bearer_token) > 20 else bearer_token,
            "token_info": oauth2_auth.get_token_info(bearer_token)
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
        auth_info = {
            "type": "zkp",
            "proof": request.zkp_proof,
            "proof_info": zkp_auth.get_proof_info(request.zkp_proof),
            "verification_time": verify_time,
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
    result = await tool_caller.call_tool(intent, agent.auth_type, request.agent_id)
    timing["execution"] = time.time() - execution_start

    timing["total"] = sum(timing.values())

    return ChatResponse(
        intent=intent.dict(),
        result=result,
        timing=timing,
        auth_info=auth_info
    )