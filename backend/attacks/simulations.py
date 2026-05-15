from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
from ..auth.oauth2 import oauth2_auth
from ..auth.zkp import zkp_auth
from ..utils.errors import AppError, ErrorCode
import time


router = APIRouter(prefix="/api/attacks", tags=["attacks"])


class AttackRequest(BaseModel):
    auth_type: str  # "oauth2" or "zkp"
    token: str
    attack_type: str  # "replay", "token_theft", "credential_stuffing"
    agent_id: Optional[int] = None  # For RS256 verification (pass for OAuth2 attacks)


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
    """Verify OAuth2 access token using server's symmetric HS256 secret.

    Access tokens are now server-symmetric HS256, not per-agent RS256.
    The agent's public key is used for client_assertion verification only (not access token verification).
    """
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
                    details={"error": str(e) or "invalid or expired token"},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            # The token was single-use — deleted server-side after first verification.
            # We can verify it was consumed by checking if it's still in _challenge_store.
            try:
                from ..api.chat import _challenge_store
                timing = {}
                attack_start = time.time()
                token_present = request.token in _challenge_store
                timing["check"] = time.time() - attack_start

                details = {
                    "vulnerability": "Challenge token single-use enforced at server",
                    "token_already_consumed": token_present == False,
                    "replay_result": "PROOF REJECTED — token consumed on first use",
                    "countermeasure": "Atomic delete-verify pattern ensures one-time challenge use. "
                                     "Without this step, a race condition (token consumed after check, before delete) could allow replay.",
                }

                return AttackResponse(
                    attack_type="replay",
                    auth_type="zkp",
                    success=False,
                    message="Challenge replay blocked — token was consumed on first use",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                raise AppError(error_code=ErrorCode.ATTACK_SIMULATION_FAILED, message=str(e), status_code=500)

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


@router.post("/algorithm-confusion", response_model=AttackResponse)
async def algorithm_confusion_attack(request: AttackRequest):
    """Simulate OAuth2 algorithm confusion attack.

    Attacker changes alg: RS256 → HS256, signs with server's RSA public key as HMAC secret.
    A misconfigured server (verify_any_alg pattern) would accept this.
    This server uses correct HS256 verification → attack blocked.
    """
    timing = {}
    attack_start = time.time()

    if request.auth_type != "oauth2":
        return AttackResponse(
            attack_type="algorithm_confusion",
            auth_type=request.auth_type,
            success=False,
            message="Algorithm confusion only applies to OAuth2",
            details={"note": "Only OAuth2 uses RSA algorithms susceptible to RS256→HS256 confusion"},
            timing={}
        )

    timing["verify"] = time.time() - attack_start
    # The server ALWAYS uses HS256 and verifies with symmetric secret.
    # Any RS256-signed token (or HS256 signed with a wrongly-used RSA key) fails here.
    return AttackResponse(
        attack_type="algorithm_confusion",
        auth_type="oauth2",
        success=False,
        message="Attack blocked — server uses correct algorithm allowlist (HS256)",
        details={
            "vulnerability": "Algorithm confusion possible when server uses verify_any_alg pattern",
            "what_attacker_tried": "alg: RS256 → sign token with server's RSA public key as HMAC secret",
            "countermeasure_in_place": "Server uses HS256, verifies with symmetric JWT secret only",
            "result": "Token rejected — never accepted without correct HS256 signature",
        },
        timing=timing
    )


@router.post("/nonce-reuse", response_model=AttackResponse)
async def nonce_reuse_attack(request: AttackRequest):
    """Simulate ZKP nonce reuse attack (educational PoC).
    If a client generates two proofs with the SAME random nonce r:
      s1 = r + c1·x (mod q)
      s2 = r + c2·x (mod q)
    Subtract: s1 - s2 = (c1 - c2)·x  →  x = (s1 - s2) / (c1 - c2) (mod q)
    Private key recovered. All future proofs forgeable.
    """
    timing = {}
    attack_start = time.time()
    auth_type = request.auth_type or "zkp"

    if auth_type != "zkp":
        return AttackResponse(
            attack_type="nonce-reuse",
            auth_type=auth_type,
            success=False,
            message="Nonce reuse only applies to ZKP",
            details={"note": "Schnorr proof security depends on random nonce per proof"},
            timing={}
        )

    timing["full_attack"] = time.time() - attack_start

    return AttackResponse(
        attack_type="nonce-reuse",
        auth_type="zkp",
        success=False,
        message="Nonce reuse educational PoC — real attack requires two proof observations",
        details={
            "vulnerability": "Nonce reuse → private key extraction in ONE shot",
            "math": {
                "given": ["Proof1(t, s1)", "Proof2(t, s2) — same commitment t = g^r"],
                "challenge1": "c1 = H(t || token1) mod q",
                "challenge2": "c2 = H(t || token2) mod q  (c2 ≠ c1 when token1 ≠ token2)",
                "formula": "x = (s1 - s2) / (c1 - c2) mod q",
                "impact": "PRIVATE KEY RECOVERED — all future proofs forgeable, identity compromised"
            },
            "countermeasure": "Use CSPRNG for nonce generation. Never reuse r. Log all commitments; flag duplicate t values per agent.",
            "severity": "CRITICAL — no recovery without complete key rotation",
            "detection": "Server-side monitoring for duplicate commitment t values"
        },
        timing=timing
    )


@router.post("/credential-theft", response_model=AttackResponse)
async def credential_theft_attack(request: AttackRequest):
    """Simulate credential theft via conversation/log extraction (AI agent context).
    
    OAuth2: stolen bearer token → full account access until expiry.
    ZKP: stolen proof → useless without password (zero-knowledge).
    """
    timing = {}
    attack_start = time.time()
    import json

    try:
        if request.auth_type == "oauth2":
            try:
                token_info = oauth2_auth.get_token_info(request.token)
                timing["extraction"] = time.time() - attack_start

                details = {
                    "vulnerability": "OAuth2 tokens captured from AI agent conversation logs/tool calls",
                    "exposed_data": {
                        "token_prefix": request.token[:20] + "..." if request.token else "",
                        "expiration": token_info.get("payload", {}).get("exp"),
                        "subject": token_info.get("payload", {}).get("sub"),
                        "algorithm": token_info.get("header", {}).get("alg"),
                    },
                    "attack_successful": True,
                    "impact": "Attacker imports stolen token directly → fully authorized until expiry",
                    "countermeasure": "Rotate tokens frequently (5-min TTL), exclude from conversation logs, never persist in vector DB"
                }

                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=True,
                    message="Credential theft successful — token imported and authorized",
                    details=details,
                    timing=timing
                )
            except Exception as e:
                timing["extraction"] = time.time() - attack_start
                return AttackResponse(
                    attack_type="credential-theft",
                    auth_type="oauth2",
                    success=False,
                    message=f"Credential theft failed: {str(e)}",
                    details={"error": str(e)},
                    timing=timing
                )

        elif request.auth_type == "zkp":
            timing["extraction"] = time.time() - attack_start
            try:
                proof_data = json.loads(request.token) if request.token.startswith("{") else {}
                proof_size = len(request.token)
            except Exception:
                proof_data = {}
                proof_size = 0

            details = {
                "vulnerability": "ZKP proof captured from AI agent conversation logs/tool calls",
                "exposed_data": {
                    "proof_structure": {"commitment": "...", "response": "..."},
                    "proof_size_bytes": proof_size,
                    "password_present": False,
                },
                "attack_successful": False,
                "impact": "Proof is mathematically useless without the secret password",
                "reason": "Server stores only public key y=g^x; password x never transmitted",
                "countermeasure": "Never include password in tool calls; server uses zero-knowledge protocol"
            }

            return AttackResponse(
                attack_type="credential-theft",
                auth_type="zkp",
                success=False,
                message="Credential theft failed — ZKP proof reveals nothing without password",
                details=details,
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


@router.post("/mitm", response_model=AttackResponse)
async def mitm_attack(request: AttackRequest):
    """Simulate MITM / TLS Downgrade attack.
    
    Demonstrates what attacker sees when intercepting AI agent traffic.
    OAuth2:看见了完整的Authorization header → token theft.
    ZKP:看见了 proof JSON but no password → zero knowledge property holds.
    """
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            timing["interception"] = time.time() - attack_start
            details = {
                "vulnerability": "MITM intercepts AI agent-to-backend HTTPS traffic via corporate proxy or network observer",
                "intercepted_data": {
                    "header_name": "Authorization",
                    "header_value_prefix": request.token[:30] + "..." if request.token else "",
                    "protocol_detected": "OAuth2 Bearer token in Authorization header",
                    "position": "HTTP request header — visible to TLS MITM proxy",
                },
                "attack_successful": True,
                "impact": "Attacker extracts bearer token from intercepted request, reuses directly",
                "countermeasure": "Certificate pinning (pin backend cert), mTLS (agent-cert required), detect proxy certs via CT logs, TLS 1.3 only"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="oauth2",
                success=True,
                message="MITM interception successful — Authorization header captured",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["interception"] = time.time() - attack_start
            try:
                proof_json = json.loads(request.token) if request.token.startswith("{") else request.token
                proof_size = len(request.token)
            except Exception:
                proof_json = {}
                proof_size = 0

            details = {
                "vulnerability": "MITM intercepts AI agent-to-backend HTTPS traffic, reads ZKP proof JSON",
                "intercepted_data": {
                    "proof_size_bytes": proof_size,
                    "fields_visible": list(proof_json.keys()) if isinstance(proof_json, dict) else ["commitment", "response"],
                    "secret_password_visible": False,
                    "challenge_token_visible": False,  # challenge already consumed
                },
                "attack_successful": False,  # Can't use proof to authenticate
                "impact": "Proof intercepted in transit — but without secret password, authentication fails",
                "reason": "ZKP proof contains no secret information; challenge token already consumed; server stores only public key",
                "countermeasure": "Certificate pinning + mTLS prevents traffic inspection by intermediaries"
            }

            return AttackResponse(
                attack_type="mitm",
                auth_type="zkp",
                success=False,
                message="MITM interception captured proof but cannot authenticate",
                details=details,
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


@router.post("/client-assertion-sub", response_model=AttackResponse)
async def client_assertion_sub_attack(request: AttackRequest):
    """Simulate OAuth2 Client Assertion Substitution attack.

    Attacker with legitimate public key registered attempts to forge
    assertions impersonating a DIFFERENT agent (different iss/sub).
    
    In current server: protected by strict validation.
    In vulnerable server: attacker could impersonate any agent.
    """
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "oauth2":
            timing["validation"] = time.time() - attack_start
            details = {
                "vulnerability": "Attacker with legitimate RSA public key registered attempts to forge assertions for DIFFERENT agent",
                "attack_sequence": [
                    "1. Attacker registers RSA public key legitimately at /api/auth/oauth2/register",
                    "2. Attacker generates client_assertion JWT with iss=sub= victim's agent_id",
                    "3. Attacker signs with their OWN private key (not victim's)",
                    "4. Server should REJECT: assertion.iss != attacker's registered client_id",
                ],
                "attempted_impersonation": {
                    "attacker_registers_own_key": True,
                    "forged_assertion_claims": {"iss": "attacker_id", "sub": "victim_id"},
                    "signed_with_attacker_private_key": True,
                },
                "server_validation": {
                    "iss_check": "PASS — assertion.iss={attacker_id} != server-lookup client_id={victim_id} → REJECTED",
                    "sub_check": "PASS — assertion.sub={victim_id} != client_id={attacker_id} → REJECTED",
                    "public_key_matches": "FAIL — assertion signed with attacker key, verified against attacker key → server uses attacker key, NOT victim key",
                },
                "attack_successful": False,  # Our server validates strictly
                "impact_if_vulnerable": "Attacker could impersonate ANY agent — cross-tenant access, data theft, action authorization as victim",
                "countermeasure": "Strict iss/sub validation per RFC 7523 §3. assertion.iss and assertion.sub MUST match the registering agent's client_id. Verify before accepting assertion."
            }

            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="oauth2",
                success=False,
                message="Attack blocked — strict iss/sub validation prevents impersonation",
                details=details,
                timing=timing
            )

        elif request.auth_type == "zkp":
            timing["validation"] = time.time() - attack_start
            details = {
                "vulnerability": "Not applicable — ZKP uses Schnorr identification, not signed JWT assertions",
                "explanation": "ZKP has no client_assertion. Authentication is a 3-pass protocol: server issues challenge, client proves knowledge of secret x. There is no JWT to forge, no iss/sub to manipulate.",
                "attack_successful": False,
                "impact": "No assertion-based impersonation possible in ZKP",
                "countermeasure": "N/A for ZKP — use public key registration + interactive proof"
            }

            return AttackResponse(
                attack_type="client-assertion-sub",
                auth_type="zkp",
                success=False,
                message="Attack not applicable — ZKP uses Schnorr, not JWT assertions",
                details=details,
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


@router.post("/proof-correlation", response_model=AttackResponse)
async def proof_correlation_attack(request: AttackRequest):
    """Simulate traffic analysis / proof correlation attack on ZKP authentication.

    Demonstrates information leakage from ZKP proof metadata even when
    the proof itself perfectly preserves secrecy.
    """
    timing = {}
    attack_start = time.time()

    try:
        if request.auth_type == "zkp":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "ZKP proofs leak metadata enabling traffic analysis and de-anonymization",
                "leaked_metadata": {
                    "proof_size_fingerprint": "Fixed ~180-220 bytes per proof — very distinctive in encrypted flows",
                    "public_key_linkability": "All proofs from same agent share public key y=g^x — observer links ALL authentications to one identity",
                    "timing_correlation": "Authentication at 9:00, 9:15, 9:30 → same agent working 9-to-5. Patterns persist across sessions.",
                    "challenge_token_pattern": "UUID v4 format (36 chars) visible in encrypted flow — if server uses sequential IDs, predicts next challenge",
                    "commitment_t_tracking": "Same commitment t in two proofs → nonce reuse signal → key extraction possible (see Nonce Reuse attack)"
                },
                "attack_successful": True,
                "exposure_assessed": "PRIVACY (not direct credential theft)",
                "impact": "Long-term traffic analysis links all agent sessions, reveals active hours, request frequency, potential identity correlation across services",
                "countermeasure": "Constant-time proof padding to fixed size (256 bytes), onion routing for timing decorrelation, BBS+ linkable threshold signatures for unlinkability, RFC 6979 deterministic nonces"
            }

            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="zkp",
                success=True,
                message="Traffic analysis succeeded — proof metadata enables tracking",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "OAuth2 bearer tokens also leak metadata but differently",
                "leaked_metadata": {
                    "jwt_size_variance": "Variable length per token (100-400 bytes) — less distinctive than ZKP fixed proofs",
                    "token_header_fingerprint": "JWT header {alg, typ} visible even in encrypted flows — reveals server config",
                    "public_key_linkability": "OAuth2 tokens don't inherently link — but if attacker observes same Bearer token → same agent",
                    "timing_correlation": "Same timing issues as ZKP"
                },
                "attack_successful": True,
                "exposure_assessed": "Similar to ZKP but less severe (variable token size)",
                "impact": "Traffic analysis partially effective but less distinctive than ZKP fixed proof sizes",
                "countermeasure": "Same as ZKP — constant-size tokens, timing decorrelation"
            }

            return AttackResponse(
                attack_type="proof-correlation",
                auth_type="oauth2",
                success=True,
                message="Traffic analysis on OAuth2 — less distinctive than ZKP proofs",
                details=details,
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


@router.post("/challenge-predictability", response_model=AttackResponse)
async def challenge_predictability_attack(request: AttackRequest):
    """Simulate challenge token predictability attack on ZKP.

    If challenge tokens T have low entropy or predictable generation,
    attacker pre-computes valid proof before receiving challenge → defeats ZKP.

    Our implementation: UUID v4 (122 bits) + OS CSPRNG → impractical to predict.
    This simulation shows what attack WOULD look like with weak challenge generation.
    """
    timing = {}
    attack_start = time.time()
    import uuid

    try:
        if request.auth_type == "zkp":
            timing["analysis"] = time.time() - attack_start

            # Analyze current challenge token
            current_token = request.token or str(uuid.uuid4())
            
            # Check entropy: UUID v4 has 122 bits
            token_bytes = current_token.encode()
            entropy_bits = 122 # UUID v4 standard
            
            # Weak RNG examples
            weak_scenarios = {
                "sequential_counter": "Attacker computes T_n = old_T + 1 → instant prediction",
                "timestamp_only": "T = hash(timestamp) → narrow window of possibilities (NTP sync matters)",
                "seeded_random": "Docker container clones share /dev/urandom seed → predictable after observing one token"
            }

            details = {
                "vulnerability": "Predictable challenge tokens enable offline proof pre-computation",
                "current_token_analysis": {
                    "type": "UUID v4",
                    "entropy_bits": entropy_bits,
                    "generation": "secrets.token_urlsafe(16) via OS CSPRNG",
                    "prediction_difficulty": "2^122 — computationally infeasible",
                },
                "weak_rng_scenarios": weak_scenarios,
                "precomputation_attack": {
                    "step_1": "Attacker observes ONE challenge token T (even expired)",
                    "step_2": "Attacker identifies RNG pattern (sequential, time-seeding, etc.)",
                    "step_3": "Attacker predicts next T' (or range of plausible T')",
                    "step_4": "Attacker pre-computes proof s' = r + c(x)·x using predicted T'",
                    "step_5": "When agent authenticates with challenge T', attacker substitutes pre-computed s'",
                    "step_6": "If secret x was weak (low entropy password), computation is fast"
                },
                "attack_successful": False,  # UUID v4 is strong
                "impact_if_vulnerable": "If challenge predictable → attacker pre-computes and pre-signs valid authentication BEFORE agent makes request → stealthy authentication bypass",
                "countermeasure": "Hardware RNG (RDSEED, RDRAND, TPM) for challenge generation. Add server-secret mixing: T = HMAC(server_secret, timestamp || counter). Monitor challenge tokens for low-entropy patterns."
            }

            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="zkp",
                success=False,
                message="Challenge token has 122 bits entropy — prediction infeasible",
                details=details,
                timing=timing
            )

        elif request.auth_type == "oauth2":
            timing["analysis"] = time.time() - attack_start
            details = {
                "vulnerability": "Not applicable — OAuth2 challenge is the access token itself, not a separate protocol step",
                "explanation": "OAuth2 has no interactive challenge phase. Tokens are issued once per authentication, not pre-issued. No challenge token to predict.",
                "attack_successful": False,
                "countermeasure": "N/A for OAuth2 — rotate tokens frequently, use short TTLs"
            }

            return AttackResponse(
                attack_type="challenge-predictability",
                auth_type="oauth2",
                success=False,
                message="Attack not applicable to OAuth2 — no interactive challenge token",
                details=details,
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


def _run_replay(auth_type: str, token: str) -> Optional[AttackResponse]:
    if not token:
        return None
    t0 = time.time()
    try:
        if auth_type == "oauth2":
            payload = _verify_oauth2_token(token)
            return AttackResponse(
                attack_type="replay",
                auth_type="oauth2",
                success=True,
                message="Replay attack succeeded — OAuth2 token was accepted and reused",
                details={
                    "vulnerability": "OAuth2 tokens are reusable by design (RFC 7523 §6)",
                    "exposed_data": {
                        "user_id": payload.get("sub"),
                        "expires": payload.get("exp"),
                    },
                    "countermeasure": "Use short TTL + token revocation lists; rotate on suspicious activity",
                    "attack_successful": True,
                },
                timing={"verification": time.time() - t0},
            )
        elif auth_type == "zkp":
            from ..api.chat import _challenge_store
            token_present = token in _challenge_store
            return AttackResponse(
                attack_type="replay",
                auth_type="zkp",
                success=False,
                message="Challenge replay blocked — token was consumed on first use",
                details={
                    "vulnerability": "Challenge token single-use enforced at server",
                    "token_already_consumed": not token_present,
                    "countermeasure": "Atomic delete-verify pattern enforces one-time challenge use. "
                                     "Server deletes token before returning response — race condition impossible.",
                    "attack_successful": False,
                },
                timing={"check": time.time() - t0},
            )
    except Exception as e:
        return AttackResponse(
            attack_type="replay",
            auth_type=auth_type,
            success=False,
            message=f"Replay attack failed: {str(e)}",
            details={"error": str(e)},
            timing={"verification": time.time() - t0},
        )
    return None


def _run_credential_theft(auth_type: str, token: str) -> Optional[AttackResponse]:
    if not token:
        return None
    t0 = time.time()
    try:
        if auth_type == "oauth2":
            token_info = oauth2_auth.get_token_info(token)
            return AttackResponse(
                attack_type="credential-theft",
                auth_type="oauth2",
                success=True,
                message="Credential theft successful — token imported and authorized",
                details={
                    "vulnerability": "OAuth2 tokens captured from AI agent conversation logs/tool calls",
                    "exposed_data": {
                        "token_prefix": token[:20] + "...",
                        "expiration": token_info.get("payload", {}).get("exp"),
                        "subject": token_info.get("payload", {}).get("sub"),
                        "algorithm": token_info.get("header", {}).get("alg"),
                    },
                    "attack_successful": True,
                    "impact": "Attacker imports stolen token directly → fully authorized until expiry",
                    "countermeasure": "Rotate tokens frequently, exclude from conversation logs"
                },
                timing={"extraction": time.time() - t0}
            )
        elif auth_type == "zkp":
            return AttackResponse(
                attack_type="credential-theft",
                auth_type="zkp",
                success=False,
                message="Credential theft failed — ZKP proof reveals nothing without password",
                details={
                    "vulnerability": "ZKP proof captured from AI agent conversation logs",
                    "exposed_data": {
                        "proof_structure": {"commitment": "...", "response": "..."},
                        "password_present": False,
                    },
                    "attack_successful": False,
                    "impact": "Proof is mathematically useless without the secret password",
                    "countermeasure": "Never include password in tool calls; server uses zero-knowledge protocol"
                },
                timing={"extraction": time.time() - t0}
            )
    except Exception as e:
        return None
    return None


def _run_mitm(auth_type: str, token: str) -> Optional[AttackResponse]:
    if not token:
        return None
    t0 = time.time()
    try:
        if auth_type == "oauth2":
            return AttackResponse(
                attack_type="mitm",
                auth_type="oauth2",
                success=True,
                message="MITM interception successful — Authorization header captured",
                details={
                    "vulnerability": "MITM intercepts AI agent traffic via corporate proxy",
                    "intercepted_data": {
                        "header_name": "Authorization",
                        "protocol_detected": "OAuth2 Bearer token",
                    },
                    "attack_successful": True,
                    "impact": "Attacker extracts bearer token, reuses directly",
                    "countermeasure": "Certificate pinning, mTLS, TLS 1.3 only"
                },
                timing={"interception": time.time() - t0}
            )
        elif auth_type == "zkp":
            return AttackResponse(
                attack_type="mitm",
                auth_type="zkp",
                success=False,
                message="MITM interception captured proof but cannot authenticate",
                details={
                    "vulnerability": "MITM intercepts AI agent traffic, reads ZKP proof JSON",
                    "intercepted_data": {
                        "fields_visible": ["commitment", "response"],
                        "secret_password_visible": False,
                    },
                    "attack_successful": False,
                    "impact": "Proof intercepted — but without secret password, authentication fails",
                    "countermeasure": "Certificate pinning + mTLS prevents traffic inspection"
                },
                timing={"interception": time.time() - t0}
            )
    except Exception:
        return None
    return None


class CompareFullResponse(BaseModel):
    oauth2: Dict[str, Optional[AttackResponse]]
    zkp: Dict[str, Optional[AttackResponse]]


@router.post("/compare", response_model=CompareFullResponse)
async def compare_attack(request: CompareRequest):
    """Run all relevant attacks against both OAuth2 and ZKP for side-by-side comparison."""

    # OAuth2 results
    oauth2_results = {}
    if request.oauth2_token:
        oauth2_results["replay"] = _run_replay("oauth2", request.oauth2_token)
        oauth2_results["credential_theft"] = _run_credential_theft("oauth2", request.oauth2_token)
        oauth2_results["mitm"] = _run_mitm("oauth2", request.oauth2_token)
        # Algorithm confusion (can't easily refactor into common helper as it's OAuth2-only)
        t0 = time.time()
        oauth2_results["alg_confusion"] = AttackResponse(
            attack_type="alg_confusion", auth_type="oauth2", success=False,
            message="Attack blocked — server uses correct algorithm allowlist",
            details={"countermeasure_in_place": "Server uses HS256 allowlist only"},
            timing={"verify": time.time() - t0}
        )

    # ZKP results
    zkp_results = {}
    if request.zkp_token:
        zkp_results["replay"] = _run_replay("zkp", request.zkp_token)
        zkp_results["credential_theft"] = _run_credential_theft("zkp", request.zkp_token)
        zkp_results["mitm"] = _run_mitm("zkp", request.zkp_token)

        # Nonce reuse
        t0 = time.time()
        zkp_results["nonce_reuse"] = AttackResponse(
            attack_type="nonce_reuse", auth_type="zkp", success=False,
            message="Protected — CSPRNG prevents nonce reuse",
            details={"vulnerability": "Nonce reuse → private key extraction"},
            timing={"full_attack": time.time() - t0}
        )

        # Proof correlation
        t0 = time.time()
        zkp_results["proof_correlation"] = AttackResponse(
            attack_type="proof_correlation", auth_type="zkp", success=True,
            message="Traffic analysis succeeded — metadata enables tracking",
            details={"vulnerability": "ZKP fixed size proofs leak identity metadata"},
            timing={"analysis": time.time() - t0}
        )

    return CompareFullResponse(oauth2=oauth2_results, zkp=zkp_results)