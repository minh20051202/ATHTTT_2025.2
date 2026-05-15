from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..utils.errors import AppError, ErrorCode
from ..utils.config import settings
import time
import json
import hashlib
import re


router = APIRouter(prefix="/api/attacks", tags=["attacks"])


class AttackRequest(BaseModel):
    auth_type: str  # "oauth2" or "zkp"
    token: str
    attack_type: str  # "replay", "token_theft", "credential_stuffing", "nonce-reuse", etc.
    agent_id: Optional[int] = None  # For RS256 verification (pass for OAuth2 attacks)
    token2: Optional[str] = None    # Second token/proof for nonce-reuse attacks


class AttackResponse(BaseModel):
    attack_type: str
    auth_type: str
    success: bool
    message: str
    details: Dict[str, Any]
    timing: Dict[str, float]


class CompareRequest(BaseModel):
    oauth2_token: Optional[str] = None
    zkp_token: Optional[str] = None


class CompareResponse(BaseModel):
    oauth2: Optional[AttackResponse] = None
    zkp: Optional[AttackResponse] = None


def _verify_oauth2_token(token: str) -> dict:
    """Verify OAuth2 access token using server's symmetric HS256 secret."""
    return oauth2_auth.verify_token(token)


@router.post("/replay", response_model=AttackResponse)
async def replay_attack(request: AttackRequest):
    """Simulate a replay attack - reusing a token/proof."""
    timing = {}
    details = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            try:
                payload = _verify_oauth2_token(request.token)
                timing["verification"] = time.time() - attack_start

                from ..db.operations import db_ops
                from ..db.models import get_db
                
                db = next(get_db())
                agent_id = payload.get("sub")
                transactions = db_ops.get_agent_transactions(db, int(agent_id)) if agent_id else []

                details = {
                    "vulnerability": "3. Token Replay: OAuth2 tokens are reusable by design until they expire",
                    "stolen_identity": {
                        "agent_id": agent_id,
                        "token_expiry": payload.get("exp"),
                        "scopes": payload.get("scopes", ["all"])
                    },
                    "replay_result": "ACCESS GRANTED — Attacker successfully re-authenticated as victim",
                    "exfiltrated_data": {
                        "recent_transactions": [
                            {"id": t.id, "product": t.product_id, "price": t.total_price} 
                            for t in transactions[:3]
                        ],
                    },
                    "attack_successful": True,
                    "countermeasure": "Use one-time tokens (JTI), shorter TTLs, and implement DPoP (Demonstrating Proof-of-Possession)."
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="oauth2",
                    success=True,
                    message="SUCCESS — Stolen bearer token used to exfiltrate private transaction history",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["verification"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="replay",
                    auth_type="oauth2",
                    success=False,
                    message=f"FAILED: {str(e)}",
                    details={"error": str(e) or "invalid or expired token"},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            try:
                from ..api.chat import _challenge_store
                timing = {}
                attack_start = time.time()
                token_present = request.token in _challenge_store
                timing["check"] = time.time() - attack_start

                details = {
                    "vulnerability": "3. Token Replay: ZKP challenge replay is blocked by server-side state",
                    "token_already_consumed": True,
                    "replay_result": "PROOF REJECTED — Challenge token consumed on first use",
                    "countermeasure": "Atomic delete-verify pattern ensures one-time challenge use. Replay is mathematically impossible even with an identical proof.",
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=False,
                    message="N/A — Challenge replay BLOCKED; token was consumed on first use",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=str(e), status_code=500)

        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=f"Attack simulation failed: {str(e)}", status_code=500)


@router.post("/credential-theft", response_model=AttackResponse)
async def credential_theft_attack(request: AttackRequest):
    """Simulate credential theft via context/logs."""
    timing = {}
    attack_start = time.time()

    try:
        # SCAN LOGS MODE: Search buffer for credentials
        stolen_token = None
        stolen_secret = None
        
        for entry in settings.log_buffer:
            headers = entry.get("headers", {})
            auth_header = headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                stolen_token = auth_header[7:]
            
            # For ZKP, we might find things in the body (simulation)
            # or if the agent logged its secret elsewhere
            if "agent_secret" in str(entry):
                # Simulated secret extraction
                stolen_secret = "VictimAgentPassword123"

        if request.auth_type == "oauth2":
            # If no token passed, try to find one in logs
            token_to_analyze = request.token if request.token and request.token != "LOG_SEARCH_MODE" else stolen_token
            
            if not token_to_analyze:
                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=False,
                    message="FAILED — No bearer tokens found in logs or provided",
                    details={"vulnerability": "Logs are clean (for now)"},
                    timing={"extraction": time.time() - attack_start}
                )

            try:
                token_info = oauth2_auth.get_token_info(token_to_analyze)
                timing["extraction"] = time.time() - attack_start

                details = {
                    "vulnerability": "1. Credential Theft: OAuth2 tokens captured from AI agent conversation logs/tool calls",
                    "exposed_data": {
                        "stolen_token": token_to_analyze,
                        "expiration": token_info.get("payload", {}).get("exp"),
                        "subject": token_info.get("payload", {}).get("sub"),
                    },
                    "source": "Captured from log_buffer (Simulated central logging sink)",
                    "attack_successful": True,
                    "impact": "Attacker imports stolen token directly → fully authorized until expiry",
                    "countermeasure": "Rotate tokens frequently (5-min TTL), exclude from conversation logs, never persist in vector DB"
                }

                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=True,
                    message="SUCCESS — Bearer token captured from log stream",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["extraction"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=False,
                    message=f"FAILED: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            timing["extraction"] = time.time() - attack_start
            details = {
                "vulnerability": "1. Credential Theft: Agent context disclosure (Password leakage in logs)",
                "exposed_data": {
                    "stolen_secret": stolen_secret or "******** (Simulated password captured from LLM system prompt)",
                    "source": "Found in log_buffer via pattern match" if stolen_secret else "LangChain tool-call history / langchain-callbacks",
                },
                "attack_successful": True,
                "impact": "CRITICAL — If password x is captured, ZKP security is bypassed entirely.",
                "reason": "AI agents often include secrets in prompts or tool logs. Even ZKP is vulnerable if the underlying secret x is logged.",
                "countermeasure": "Use hardware security modules (HSM) so the agent never 'sees' the private key, or use short-lived sub-keys."
            }

            return AttackResponse(
                attack_type="credential-theft",
                auth_type="zkp",
                success=True,
                message="SUCCESS — Agent secret password discovered in conversation logs",
                details=details,
                timing=timing
            )

        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=f"Attack simulation failed: {str(e)}", status_code=500)


@router.post("/mitm", response_model=AttackResponse)
async def mitm_attack(request: AttackRequest):
    """Simulate MITM / TLS Downgrade."""
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            timing["interception"] = time.time() - attack_start
            details = {
                "vulnerability": "2. MITM: Intercepted via corporate proxy TLS termination",
                "intercepted_data": {
                    "header_name": "Authorization",
                    "header_value_prefix": request.token[:30] + "..." if request.token else "",
                },
                "attack_successful": True,
                "impact": "Attacker extracts bearer token from intercepted request, reuses directly",
                "countermeasure": "Certificate pinning, mTLS, TLS 1.3 only"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="oauth2",
                success=True,
                message="SUCCESS — MITM captured Authorization: Bearer token",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["interception"] = time.time() - attack_start
            details = {
                "vulnerability": "2. MITM: TLS inspection captures proof + potentially plaintext password",
                "intercepted_data": {
                    "captured_proof": {"commitment": "t", "response": "s"},
                    "captured_password": "VictimAgentPassword123 (Captured during initial register call)",
                },
                "attack_successful": True,
                "impact": "MITM proxy captures the agent's password if sent during unencrypted registration or config synchronization.",
                "reason": "While proofs are ZK, agent lifecycle calls (registration/updates) often send secrets if mTLS is not used.",
                "countermeasure": "Certificate pinning + mTLS prevents traffic inspection by intermediaries"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="zkp",
                success=True,
                message="SUCCESS — Intercepted registration call revealed agent password",
                details=details,
                timing=timing
            )

        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)

    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=f"Attack simulation failed: {str(e)}", status_code=500)


@router.post("/client-assertion-sub", response_model=AttackResponse)
async def client_assertion_sub_attack(request: AttackRequest):
    """Simulate OAuth2 Client Assertion Substitution attack."""
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            victim_id = "agent_VIP_99"
            attacker_id = request.agent_id or "agent_attacker"
            
            details = {
                "vulnerability": "4. Client Assertion Substitution: Missing identity-to-key cross-check",
                "attack_sequence": [
                    f"1. Attacker (ID: {attacker_id}) generates a valid signed JWT",
                    f"2. Attacker modifies 'sub' and 'iss' claims to: {victim_id}",
                    "3. Attacker signs with their OWN private key",
                    "4. Vulnerable server only checks if the signature is valid for ANY known user"
                ],
                "forged_claims": {
                    "iss": victim_id,
                    "sub": victim_id,
                    "aud": "https://auth.example.com/token",
                },
                "attack_successful": True,
                "impact": "SUCCESS — Attacker successfully impersonated victim agent via assertion substitution",
                "countermeasure": "Strict cross-check: The server MUST verify the assertion using the specific public key previously registered for the 'iss' (issuer) claim."
            }

            timing["validation"] = time.time() - attack_start
            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="oauth2",
                success=True,
                message="SUCCESS — Malicious agent impersonated victim via forged assertion",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="zkp",
                success=False,
                message="Attack not applicable — ZKP uses Schnorr, not JWT assertions",
                details={"vulnerability": "N/A for ZKP"},
                timing=timing
            )
        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=str(e), status_code=500)


@router.post("/proof-correlation", response_model=AttackResponse)
async def proof_correlation_attack(request: AttackRequest):
    """Simulate traffic analysis."""
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "zkp":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "5. Proof Correlation: ZKP proofs leak metadata enabling traffic analysis and de-anonymization",
                "leaked_metadata": {
                    "proof_size_fingerprint": "Fixed ~180-220 bytes per proof — very distinctive",
                    "public_key_linkability": "All proofs share public key y=g^x — observer links ALL authentications",
                    "commitment_t_tracking": "Same commitment t in two proofs → nonce reuse signal"
                },
                "attack_successful": True,
                "impact": "Long-term traffic analysis links all agent sessions, reveals active hours, and request frequency",
                "countermeasure": "Constant-time proof padding, onion routing, BBS+ linkable threshold signatures"
            }

            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="zkp",
                success=True,
                message="SUCCESS — Traffic analysis enabled session correlation",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            timing["analysis"] = time.time() - attack_start
            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="oauth2",
                success=False,
                message="N/A — OAuth2 bearer tokens are not structurally correlatable in the same way",
                details={"vulnerability": "Variable token size and lack of shared math state makes fingerprinting difficult"},
                timing=timing
            )
        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=f"Attack simulation failed: {str(e)}", status_code=500)


@router.post("/challenge-predictability", response_model=AttackResponse)
async def challenge_predictability_attack(request: AttackRequest):
    """Simulate challenge token predictability."""
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "zkp":
            current_token = request.token or "token_intercepted_v1"
            predicted_next = hashlib.sha256(current_token.encode()).hexdigest()[:36]
            
            details = {
                "vulnerability": "6. Challenge Token Predictability: Predictable Challenge PRNG (Low Entropy / Improper Seeding)",
                "observation": {
                    "intercepted_challenge_n": current_token,
                    "predicted_challenge_n_plus_1": predicted_next,
                },
                "attack_logic": [
                    "1. Intercept consecutive challenges to identify the RNG sequence",
                    "2. Predict the next challenge 'T' before it's officially issued",
                    "3. Pre-compute and pre-sign a valid proof 's' for that specific 'T'",
                    "4. Inject the pre-computed proof the moment the victim attempts login"
                ],
                "pre_computed_artifact": {
                    "target_challenge": predicted_next,
                    "pre_signed_proof": {"commitment": "t_static_demo", "response": "s_static_demo"},
                    "exploit_status": "READY — Awaiting challenge issuance"
                },
                "attack_successful": True,
                "impact": "SUCCESS — Attacker successfully pre-computed a valid proof by predicting the next challenge",
                "countermeasure": "Use high-entropy entropy sources (TPM, hardware RNG) for all challenges. Never use time() as a seed."
            }

            timing["analysis"] = time.time() - attack_start
            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="zkp",
                success=True,
                message="SUCCESS — Next challenge predicted; valid proof pre-computed offline",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="oauth2",
                success=False,
                message="N/A — OAuth2 tokens are issued, not challenged",
                details={"note": "OAuth2 is non-interactive; there is no challenge token to predict"},
                timing={}
            )
        else:
            raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=str(e), status_code=500)


class CompareFullResponse(BaseModel):
    oauth2: Dict[str, Optional[AttackResponse]]
    zkp: Dict[str, Optional[AttackResponse]]


@router.post("/compare", response_model=CompareFullResponse)
async def compare_attack(request: CompareRequest):
    """Run all relevant attacks against both OAuth2 and ZKP for side-by-side comparison."""
    oauth2_results = {}
    if request.oauth2_token:
        oauth2_results["replay"] = await replay_attack(AttackRequest(auth_type="oauth2", token=request.oauth2_token, attack_type="replay"))
        oauth2_results["credential_theft"] = await credential_theft_attack(AttackRequest(auth_type="oauth2", token=request.oauth2_token, attack_type="credential_theft"))
        oauth2_results["mitm"] = await mitm_attack(AttackRequest(auth_type="oauth2", token=request.oauth2_token, attack_type="mitm"))
        oauth2_results["client_assertion_sub"] = await client_assertion_sub_attack(AttackRequest(auth_type="oauth2", token=request.oauth2_token, attack_type="client_assertion_sub"))

    zkp_results = {}
    if request.zkp_token:
        zkp_results["replay"] = await replay_attack(AttackRequest(auth_type="zkp", token=request.zkp_token, attack_type="replay"))
        zkp_results["credential_theft"] = await credential_theft_attack(AttackRequest(auth_type="zkp", token=request.zkp_token, attack_type="credential_theft"))
        zkp_results["mitm"] = await mitm_attack(AttackRequest(auth_type="zkp", token=request.zkp_token, attack_type="mitm"))
        zkp_results["proof_correlation"] = await proof_correlation_attack(AttackRequest(auth_type="zkp", token=request.zkp_token, attack_type="proof_correlation"))
        zkp_results["challenge_predictability"] = await challenge_predictability_attack(AttackRequest(auth_type="zkp", token=request.zkp_token, attack_type="challenge_predictability"))

    return CompareFullResponse(oauth2=oauth2_results, zkp=zkp_results)