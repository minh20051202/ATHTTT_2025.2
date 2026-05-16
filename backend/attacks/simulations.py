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
import secrets


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
                # 1. Parse token to get agent_id (just to formulate the request)
                payload = _verify_oauth2_token(request.token)
                agent_id = payload.get("sub")
                
                # 2. Simulate TRUE attack by calling the actual Intent Endpoint
                from ..api.chat import extract_and_execute, ChatRequest
                from fastapi import Request
                from ..db.models import get_db
                
                # Mock a request with the stolen Bearer token
                scope = {
                    "type": "http",
                    "headers": [(b"authorization", f"Bearer {request.token}".encode("utf-8"))]
                }
                mock_request = Request(scope)
                
                chat_req = ChatRequest(
                    message="show my order history",
                    agent_id=int(agent_id) if agent_id else 0
                )
                
                db = next(get_db())
                # Actually hit the protected endpoint
                intent_response = await extract_and_execute(request=chat_req, http_request=mock_request, db=db)
                
                timing["verification"] = time.time() - attack_start

                details = {
                    "vulnerability": "3. Token Replay: OAuth2 tokens are reusable by design until they expire",
                    "stolen_identity": {
                        "agent_id": agent_id,
                        "token_expiry": payload.get("exp"),
                        "scopes": payload.get("scopes", ["all"])
                    },
                    "replay_result": "ACCESS GRANTED — Attacker successfully re-authenticated as victim by calling /api/chat/intent",
                    "exfiltrated_data": intent_response.result,  # Result directly from the intent endpoint
                    "attack_successful": True,
                    "countermeasure": "Use one-time tokens (JTI), shorter TTLs, and implement DPoP (Demonstrating Proof-of-Possession)."
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="oauth2",
                    success=True,
                    message="SUCCESS — Stolen bearer token used to successfully call the intent endpoint",
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
                from ..api.chat import extract_and_execute, ChatRequest
                from fastapi import Request
                from ..db.models import get_db

                timing = {}
                attack_start = time.time()

                # Determine agent_id — prefer explicitly passed, else parse from token if provided
                agent_id = request.agent_id
                if not agent_id and request.token:
                    # token is the consumed challenge token — we still need an agent_id
                    # to formulate a valid request. Grab any ZKP agent from the DB.
                    from ..db.models import Agent
                    db = next(get_db())
                    zkp_agent = db.query(Agent).filter(Agent.auth_type == "zkp").first()
                    agent_id = zkp_agent.id if zkp_agent else 1

                # Mock request — no Authorization header (ZKP path)
                scope = {"type": "http", "headers": []}
                mock_request = Request(scope)

                # Use the CONSUMED token — real endpoint will reject it
                # The proof can be stale/invalid; the token check fires first
                chat_req = ChatRequest(
                    message="show attack log",
                    agent_id=agent_id or 1,
                    zkp_token=request.token or "consumed-token-xxxx",
                    zkp_proof=request.token2 or '{"t":"deadbeef","s":"feedface"}',
                )

                db = next(get_db())
                # Actually hit the protected endpoint — real enforcement rejects consumed token
                intent_response = await extract_and_execute(request=chat_req, http_request=mock_request, db=db)

                # If we get here something is wrong (token was not actually consumed)
                timing["verification"] = time.time() - attack_start
                details = {
                    "vulnerability": "3. Token Replay: ZKP challenge token still valid (unexpected)",
                    "token_already_consumed": False,
                    "replay_result": "ACCESS GRANTED — Challenge token was not consumed",
                    "attack_successful": True,
                    "countermeasure": "Server-side token invalidation already in place.",
                }
                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=True,
                    message="UNEXPECTED — Challenge token still valid",
                    details=details,
                    timing=timing
                )
            except AppError as e:
                timing["verification"] = time.time() - attack_start
                # Real endpoint rejected the consumed token — this is the correct outcome
                details = {
                    "vulnerability": "3. Token Replay: ZKP challenge replay blocked by server — token consumed",
                    "token_already_consumed": True,
                    "replay_result": f"REJECTED — {e.message}",
                    "attack_successful": False,
                    "countermeasure": "Atomic delete-verify pattern: token deleted immediately after use. Replay mathematically impossible — server enforces this on every request.",
                }
                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=False,
                    message="REJECTED — Challenge token consumed. Real endpoint confirmed.",
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
    """Simulate MITM / TLS Downgrade.

    tls_downgrade_active=True  → countermeasure ON (mTLS) → attack BLOCKED
    tls_downgrade_active=False → no countermeasure → connection vulnerable → creds intercepted
    """
    timing = {}
    attack_start = time.time()

    # No countermeasure → vulnerable → attack succeeds
    if not settings.tls_downgrade_active:
        # Connection is vulnerable to TLS downgrade — show intercepted data
        if request.auth_type == "oauth2":
            timing["interception"] = time.time() - attack_start

            stolen_token = None
            for entry in settings.proxy_buffer:
                headers = entry.get("headers", {})
                auth_header = next((v for k, v in headers.items() if k.lower() == "authorization"), "")
                if auth_header.startswith("Bearer "):
                    stolen_token = auth_header[7:]
                    break

            # Fallback: use token passed from frontend (captured during /intent response)
            if not stolen_token:
                stolen_token = request.token

            details = {
                "intercepted_data": {
                    "header_name": "Authorization",
                    "header_value": stolen_token or "N/A",
                },
                "attack_successful": True,
                "impact": "Attacker extracts bearer token from intercepted request, reuses directly",
                "countermeasure": "mTLS + TLS 1.3 pinning prevents proxy from reading traffic"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="oauth2",
                success=True,
                message="SUCCESS — TLS Interception captured Authorization: Bearer token",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["interception"] = time.time() - attack_start

            captured_proof = None
            captured_password = None
            for entry in settings.proxy_buffer:
                body = entry.get("body", {})
                if body.get("zkp_proof"):
                    captured_proof = body.get("zkp_proof")
                if body.get("password"):
                    captured_password = body.get("password")

            # Fallback: use proof/token2 passed from frontend
            if not captured_proof:
                captured_proof = request.token2 or "zkp_proof_from_wire"

            details = {
                "intercepted_data": {
                    "captured_proof": captured_proof,
                },
                "attack_successful": True,
                "impact": "MITM proxy captures the ZKP proof (commitment t and response s). The secret x is not exposed — but the proof is single-use anyway.",
                "reason": "ZKP authentication transmits proof only — no secret on wire. However, registration/agent-lifecycle calls may differ.",
                "countermeasure": "mTLS + TLS 1.3 pinning prevents traffic inspection by intermediaries."
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="zkp",
                success=True,
                message="SUCCESS — ZKP proof intercepted from unencrypted traffic",
                details=details,
                timing=timing
            )

        raise AppError(error_code=ErrorCode.INVALID_PARAMETER, message=f"Invalid auth_type: {request.auth_type}", status_code=400)

    # Countermeasure enabled → attack blocked
    # tls_downgrade_active=True means mTLS/TLS 1.3 pinning is enforced
    timing["interception"] = time.time() - attack_start
    return AttackResponse(
        attack_type="mitm",
        auth_type=request.auth_type,
        success=False,
        message="BLOCKED — mTLS + TLS 1.3 pinning prevented proxy interception",
        details={
            "vulnerability": "2. TLS Interception / MITM: Blocked by mTLS + certificate pinning",
            "countermeasure": "mTLS + TLS 1.3 only ensures intermediary cannot terminate TLS"
        },
        timing=timing
    )


@router.post("/client-assertion-sub", response_model=AttackResponse)
async def client_assertion_sub_attack(request: AttackRequest):
    """Simulate OAuth2 Client Assertion Substitution attack."""
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            victim_id = str(request.agent_id) if request.agent_id else "99"
            
            from ..auth.oauth2 import oauth2_auth
            attacker_public_key, attacker_private_key = oauth2_auth.create_rsa_keypair()
            
            forged_assertion, _ = oauth2_auth.create_client_assertion(victim_id, attacker_private_key)
            
            from ..db.operations import db_ops
            from ..db.models import get_db, Agent
            
            db = next(get_db())
            victim_agent = db.query(Agent).filter(Agent.id == int(victim_id)).first() if victim_id.isdigit() else None
            victim_public_key = victim_agent.public_key if victim_agent else None

            attack_successful = False
            error_message = ""
            
            if not settings.strict_assertion_check:
                attack_successful = True
            else:
                try:
                    if victim_public_key:
                        oauth2_auth.verify_client_assertion(forged_assertion, victim_public_key)
                        attack_successful = True
                    else:
                        error_message = "Victim has no public key registered"
                        attack_successful = False
                except Exception as e:
                    attack_successful = False
                    error_message = str(e)
            
            details = {
                "vulnerability": "4. Client Assertion Substitution: Missing identity-to-key cross-check",
                "attack_sequence": [
                    f"1. Attacker generates a new RSA keypair",
                    f"2. Attacker modifies 'sub' and 'iss' claims to: {victim_id}",
                    "3. Attacker signs with their OWN private key",
                    "4. Vulnerable server only checks if the signature is valid for ANY known user"
                ],
                "forged_claims": {
                    "iss": victim_id,
                    "sub": victim_id,
                    "aud": "https://auth.example.com/token",
                },
                "attack_successful": attack_successful,
                "impact": "SUCCESS — Attacker successfully impersonated victim agent via assertion substitution" if attack_successful else "FAILED — Server strictly validates signature against victim's registered public key",
                "countermeasure": "Strict cross-check: The server MUST verify the assertion using the specific public key previously registered for the 'iss' (issuer) claim."
            }
            if error_message:
                details["error"] = error_message

            timing["validation"] = time.time() - attack_start
            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="oauth2",
                success=attack_successful,
                message="SUCCESS — Malicious agent impersonated victim via forged assertion" if attack_successful else "FAILED: Invalid client assertion signature",
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
                "vulnerability": "5. Traffic Analysis: ZKP proofs leak metadata enabling fingerprinting and de-anonymization",
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
            from ..utils.config import settings
            if settings.vulnerable_rng:
                predicted_next = f"predictable-token-{int(time.time()) + 1}"
                details = {
                    "vulnerability": "6. Challenge Token Forgery: Predictable Challenge PRNG (Low Entropy / Improper Seeding)",
                    "observation": {
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
                success = True
                message = "SUCCESS — Next challenge predicted; valid proof pre-computed offline"
            else:
                details = {
                    "vulnerability": "6. Challenge Token Forgery: Predictable Challenge PRNG",
                    "observation": {
                        "entropy": "UUID v4 (122 bits)",
                    },
                    "attack_successful": False,
                    "impact": "FAILURE — Challenge token is cryptographically secure (UUID v4) and unpredictable.",
                    "countermeasure": "Already using high-entropy entropy sources for all challenges."
                }
                success = False
                message = "FAILED — Challenge token is cryptographically secure and unpredictable."

            timing["analysis"] = time.time() - attack_start
            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="zkp",
                success=success,
                message=message,
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":            return AttackResponse(
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



@router.post("/nonce-reuse", response_model=AttackResponse)
async def nonce_reuse_attack(request: AttackRequest):
    """
    NONCE-REUSE ATTACK: Real Schnorr vulnerability.

    If the same random nonce r is reused for two different proofs,
    the secret x can be recovered algebraically.

    Math:
      Proof 1: s1 = r + c1·x (mod q)  — issued for challenge c1
      Proof 2: s2 = r + c2·x (mod q)  — issued for different challenge c2
      s1 - s2 = (c1 - c2)·x (mod q)
      x = (s1 - s2) · inv(c1 - c2, q) (mod q)  ← secret fully recovered

    This is why proper Schnorr implementations:
      1. Delete nonce r immediately after use (never reuse)
      2. Use CSPRNG for r (no predictability)
      3. Sign with deterministic nonce (RFC 6979: r = HMAC(k, H(m)) never repeats)
    """
    import time
    import secrets
    from ..auth.zkp import _DHP, _DHQ, _DHG
    attack_start = time.time()

    # Generate honest Schnorr context using the same domain params as real ZKP
    r = secrets.randbelow(_DHQ)  # nonce — FIXED across two proofs (the bug)
    t = pow(_DHG, r, _DHP)

    # Two different challenge tokens (c1 and c2 are different)
    token1 = secrets.token_urlsafe(48)
    token2 = secrets.token_urlsafe(48)

    c1 = int(hashlib.sha512(f"{t:x}{token1}".encode()).hexdigest(), 16) % _DHQ
    c2 = int(hashlib.sha512(f"{t:x}{token2}".encode()).hexdigest(), 16) % _DHQ

    # Secret x (agent's private key — the attacker's target)
    # Same keypair used in the SEED (hardcoded for demo reproducibility)
    x_secret = int("deadbeef1234567890abcdef", 16) % _DHQ

    s1 = (r + c1 * x_secret) % _DHQ
    s2 = (r + c2 * x_secret) % _DHQ

    # --- Attack: recover x from (s1, c1) and (s2, c2) ---
    diff_c = (c1 - c2) % _DHQ
    diff_s = (s1 - s2) % _DHQ
    # Extended Euclidean Algorithm for modular inverse
    def egcd(a, b):
        if b == 0:
            return (a, 1, 0)
        g, x1, y1 = egcd(b, a % b)
        return (g, y1, x1 - (a // b) * y1)
    # egcd returns (g, x, y) where a*x + b*y = g
    # For inv(diff_c) modulo _DHQ: use the coefficient of _DHQ (second param) → y at top level
    _, inv_diff_c, _ = egcd(diff_c, _DHQ)
    x_recovered = (diff_s * inv_diff_c) % _DHQ

    match = (x_recovered == x_secret)
    timing = {"observe": time.time() - attack_start}

    return AttackResponse(
        attack_type="nonce-reuse",
        auth_type="zkp",
        success=match,
        message="SUCCESS — x recovered from two proofs sharing nonce r" if match else "FAILED",
        details={
            "vulnerability": "6. Nonce Reuse: Schnorr signature broken if nonce r is repeated",
            "attack_logic": {
                "root_cause": "r reused across two proofs with different challenges c1 ≠ c2",
                "formula": "s1 - s2 = (c1 - c2)·x  →  x = (s1 - s2) · inv(c1 - c2) mod q",
                "nonce_r_reused": format(r, 'x'),
                "proof1": {"c1": format(c1, 'x'), "s1": format(s1, 'x')},
                "proof2": {"c2": format(c2, 'x'), "s2": format(s2, 'x')},
            },
            "recovered_secret": format(x_recovered, 'x'),
            "actual_secret": format(x_secret, 'x'),
            "match": match,
            "impact": "CRITICAL — With recovered x, attacker can generate new valid proofs for ANY challenge. Full identity compromise.",
            "countermeasure": "Use RFC 6979 deterministic nonce: r = HMAC-HMAC(key, msg). Deterministic + unique per signature = never reuse. Or use EdDSA which handles this natively.",
        },
        timing=timing
    )


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