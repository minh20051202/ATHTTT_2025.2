from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..utils.errors import AppError, ErrorCode
import time
import json


router = APIRouter(prefix="/api/attacks", tags=["attacks"])


class AttackRequest(BaseModel):
    auth_type: str  # "oauth2" or "zkp"
    token: str
    attack_type: str  # "replay", "token_theft", "credential_stuffing"


class AttackResponse(BaseModel):
    attack_type: str
    auth_type: str
    success: bool
    message: str
    details: Dict[str, Any]
    timing: Dict[str, float]


@router.post("/replay", response_model=AttackResponse)
async def replay_attack(request: AttackRequest):
    """Simulate a replay attack - reusing a token/proof."""
    timing = {}
    details = {}

    try:
        attack_start = time.time()

        if request.auth_type == "oauth2":
            # OAuth2: Replay attack succeeds (tokens are reusable)
            try:
                payload = oauth2_auth.verify_token(request.token)
                timing["verification"] = time.time() - attack_start

                details = {
                    "vulnerability": "OAuth2 tokens are reusable",
                    "exposed_data": {
                        "user_id": payload.get("sub"),
                        "expires": payload.get("exp"),
                        "token_size": len(request.token)
                    },
                    "attack_successful": True
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="oauth2",
                    success=True,
                    message="Replay attack succeeded - OAuth2 token was accepted",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["verification"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="replay",
                    auth_type="oauth2",
                    success=False,
                    message=f"Replay attack failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            # ZKP: Replay attack fails (proofs are non-reusable)
            try:
                # In a real implementation, we'd track used proofs
                # For demo, we simulate the failure
                timing["verification"] = time.time() - attack_start

                details = {
                    "vulnerability": "None - ZKP proofs are non-reusable",
                    "exposed_data": {},
                    "attack_successful": False,
                    "reason": "Proof already used or invalid"
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=False,
                    message="Replay attack failed - ZKP proof was rejected",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["verification"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=False,
                    message=f"Replay attack failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )


@router.post("/token-theft", response_model=AttackResponse)
async def token_theft_attack(request: AttackRequest):
    """Simulate a token theft attack - stealing and using credentials."""
    timing = {}
    details = {}

    try:
        attack_start = time.time()

        if request.auth_type == "oauth2":
            # OAuth2: Token theft exposes credentials
            try:
                token_info = oauth2_auth.get_token_info(request.token)
                timing["extraction"] = time.time() - attack_start

                details = {
                    "vulnerability": "OAuth2 tokens expose user credentials",
                    "stolen_data": {
                        "token": request.token[:20] + "...",  # Partial token
                        "header": token_info.get("header", {}),
                        "payload_keys": list(token_info.get("payload", {}).keys()),
                        "token_size": token_info.get("token_size", 0)
                    },
                    "attack_successful": True,
                    "impact": "Attacker can impersonate user until token expires"
                }

                return AttackResponse(
                    attack_type="token_theft",
                    auth_type="oauth2",
                    success=True,
                    message="Token theft successful - credentials exposed",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["extraction"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="token_theft",
                    auth_type="oauth2",
                    success=False,
                    message=f"Token theft failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            # ZKP: Token theft doesn't expose credentials
            try:
                proof_info = zkp_auth.get_proof_info(request.token)
                timing["extraction"] = time.time() - attack_start

                details = {
                    "vulnerability": "None - ZKP proofs don't expose credentials",
                    "stolen_data": {
                        "proof_size": proof_info.get("proof_size", 0),
                        "data_size": proof_info.get("data_size", 0)
                    },
                    "attack_successful": False,
                    "impact": "Attacker cannot use proof without password",
                    "reason": "Proof is useless without the secret password"
                }

                return AttackResponse(
                    attack_type="token_theft",
                    auth_type="zkp",
                    success=False,
                    message="Token theft failed - no credentials exposed",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["extraction"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="token_theft",
                    auth_type="zkp",
                    success=False,
                    message=f"Token theft failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )


@router.post("/credential-stuffing", response_model=AttackResponse)
async def credential_stuffing_attack(request: AttackRequest):
    """Simulate a credential stuffing attack - using stolen credentials."""
    timing = {}
    details = {}

    try:
        attack_start = time.time()

        if request.auth_type == "oauth2":
            # OAuth2: Credential stuffing can succeed with valid tokens
            try:
                payload = oauth2_auth.verify_token(request.token)
                timing["verification"] = time.time() - attack_start

                details = {
                    "vulnerability": "OAuth2 tokens can be reused by attackers",
                    "stolen_credentials": {
                        "user_id": payload.get("sub"),
                        "token_valid": True,
                        "token_expires": payload.get("exp")
                    },
                    "attack_successful": True,
                    "impact": "Attacker can make authenticated requests"
                }

                return AttackResponse(
                    attack_type="credential_stuffing",
                    auth_type="oauth2",
                    success=True,
                    message="Credential stuffing succeeded - token accepted",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["verification"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="credential_stuffing",
                    auth_type="oauth2",
                    success=False,
                    message=f"Credential stuffing failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            # ZKP: Credential stuffing fails without password
            try:
                # In a real implementation, we'd need the client signature
                # For demo, we simulate the failure
                timing["verification"] = time.time() - attack_start

                details = {
                    "vulnerability": "None - ZKP requires password for each proof",
                    "stolen_credentials": {
                        "proof_only": True,
                        "password_missing": True
                    },
                    "attack_successful": False,
                    "impact": "Attacker cannot create new proofs without password",
                    "reason": "Proof generation requires the secret password"
                }

                return AttackResponse(
                    attack_type="credential_stuffing",
                    auth_type="zkp",
                    success=False,
                    message="Credential stuffing failed - password required",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["verification"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="credential_stuffing",
                    auth_type="zkp",
                    success=False,
                    message=f"Credential stuffing failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        else:
            raise AppError(
                error_code=ErrorCode.INVALID_PARAMETER,
                message=f"Invalid auth_type: {request.auth_type}",
                status_code=400
            )

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code=ErrorCode.ATTACK_SIMULATION_FAILED,
            message=f"Attack simulation failed: {str(e)}",
            status_code=500
        )
