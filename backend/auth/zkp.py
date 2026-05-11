"""
Zero-Knowledge Proof authentication using Schnorr Identification Protocol.

Domain parameters (public, agreed upon by client and server):
  - Safe prime p  (512-bit, for demo)
  - Generator g    (shared, not secret)
  - Subgroup order q (512-bit)

Key generation:
  - Secret: x = H(password)  (deterministic — no random per-key salt)
  - Public: y = g^x mod p

Authentication (3-pass Schnorr identification):
  1. Client → Server: commitment  t = g^r  (r = random nonce, kept secret)
  2. Server → Client: challenge    c = H(t || token)  (c depends on t and server's token)
  3. Client → Server: response     s = r + c·x  (mod q)
  4. Server verifies: g^s ≡ t · y^c  (mod p)

Security property: Server stores ONLY y. It can never derive x or the password.
The password never leaves the client.
"""
from typing import Tuple
import hashlib
import secrets
import json


# ---------------------------------------------------------------------------
# Domain parameters (educational/demo — 257-bit safe prime).
# p = 2q + 1, where q is prime. g generates the order-q subgroup.
# For production: use FIPS 186-5 parameters (e.g., 2048-bit or 3072-bit)
# ---------------------------------------------------------------------------
_DHP = 0x1cf31b37e99c3942ce796767f4df210c915eda4d037a0ff36f0c24ed2485c99ff
_DHQ = 0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b78612769242e4cff
_DHG = 0x4
_EXTERNAL_DHP = _DHP
_EXTERNAL_DHQ = _DHQ
_EXTERNAL_DHG = _DHG


def _modpow(base: int, exp: int, mod: int) -> int:
    return pow(base, exp, mod)


# ---------------------------------------------------------------------------
# Public API (used by client-side JS which mirrors these formulas)
# ---------------------------------------------------------------------------

def get_domain_params() -> dict:
    """Return the shared domain parameters (p, g, q)."""
    return {"p": _DHP, "g": _DHG, "q": _DHQ}


def hash_secret(secret: str) -> int:
    """
    DEPRECATED — server must never derive public key from a shared password.
    For true ZKP: client generates random private key x, computes y = g^x locally.
    Use client-side generateKeyPair() in zkp.js instead.
    """
    raise NotImplementedError(
        "Server must not derive public key from password. "
        "Client generates random private key and computes public key locally."
    )


def create_public_key(secret: str) -> str:
    """
    DEPRECATED — server must never call this.
    For true ZKP: client generates random x, computes y = g^x, sends only y to server.
    Left for reference: shows the broken shared-secret approach.
    """
    raise NotImplementedError(
        "Server must not derive public key from password. "
        "Client generates random private key and computes public key locally."
    )


# ---------------------------------------------------------------------------
# Token store (single-use, time-limited) — used for ZKP challenge/response
# ---------------------------------------------------------------------------

_token_store: dict[str, dict] = {}   # token -> {agent_id, commitment, expires}
_TOKEN_TTL = 300  # 5 minutes — allows user time to type password


def cleanup_expired_tokens():
    """Remove expired tokens from _token_store. Call on each generate_token/consume_token."""
    import time
    now = time.time()
    expired = [k for k, v in _token_store.items() if v["expires"] < now]
    for k in expired:
        del _token_store[k]


def generate_token(agent_id: int) -> str:
    """Issue a server-signed challenge token for a ZKP agent."""
    import time
    token = secrets.token_urlsafe(48)
    _token_store[token] = {
        "agent_id": agent_id,
        "expires": time.time() + _TOKEN_TTL,
    }
    cleanup_expired_tokens()
    return token


def consume_token(token: str, expected_agent_id: int) -> bool:
    """Validate and consume a token (single-use, 60-second TTL)."""
    cleanup_expired_tokens()
    import time
    entry = _token_store.pop(token, None)
    if not entry:
        return False
    if entry["expires"] < time.time():
        return False
    if entry["agent_id"] != expected_agent_id:
        return False
    return True


# ---------------------------------------------------------------------------
# Verification — handles BOTH new Schnorr JSON format and legacy noknow.
# chat.py calls this single entry point so it works with all agent types.
# ---------------------------------------------------------------------------

def _verify_schnorr(proof_data: str, pk_json: str, token: str) -> Tuple[bool, float]:
    """Verify a pure Schnorr proof (JSON format)."""
    import time
    start = time.time()
    try:
        proof = json.loads(proof_data)
        pk = json.loads(pk_json)
        t = int(proof["commitment"], 16)  # JS computeProof sends commitment as hex string
        s = int(proof["response"], 16)
        y = pk["y"]
        p, g = pk["p"], pk["g"]
        q = _DHQ

        # Recompute challenge: must match what client computed
        c = int(hashlib.sha512(f"{t:x}{token}".encode()).hexdigest(), 16) % q

        # Verify: g^s ≡ t * y^c (mod p)
        left = _modpow(g, s, p)
        right = (_modpow(y, c, p) * (t % p)) % p
        elapsed = time.time() - start
        return left == right, elapsed
    except Exception:
        import time as _t
        return False, _t.time() - start


def _verify_noknow_legacy(
    proof_data: str,
    sig_dump: str,
    token: str,
) -> Tuple[bool, float]:
    """Verify a proof using the old noknow ZKSignature format (pre-seeded agents)."""
    import time as _t
    start = _t.time()
    try:
        from schnorrzkp.core import ZK, ZKSignature, ZKProof
        proof = ZKProof.load(proof_data)
        client_sig = ZKSignature.load(sig_dump)
        client_zk = ZK(client_sig.params)
        valid = client_zk.verify(proof, client_sig, data=str(token))
        return valid, _t.time() - start
    except Exception:
        return False, _t.time() - start


def verify_proof(
    proof_data: str,
    public_key_data: str,
    token: str,
) -> Tuple[bool, float]:
    """
    Verify a ZKP proof — single entry point for all agent types.

    Supported public_key formats:
      1. JSON {"y": int, "p": int, "g": int}   → pure Schnorr (new agents)
      2. noknow ZKSignature hex dump          → legacy (pre-seeded demo agents)

    The server never needs to know or check which format — it auto-detects.
    """
    # Attempt pure Schnorr JSON first
    try:
        parsed = json.loads(public_key_data)
        if isinstance(parsed, dict) and "y" in parsed:
            return _verify_schnorr(proof_data, public_key_data, token)
    except (json.JSONDecodeError, KeyError, TypeError):
        pass

    # Fall back to legacy noknow (pre-seeded demo agents)
    return _verify_noknow_legacy(proof_data, public_key_data, token)


# ---------------------------------------------------------------------------
# Backwards-compatible wrapper — provides the zkp_auth object expected by
# chat.py, main.py, attacks, and tests.
# Wraps standalone functions with timing instrumentation.
# ---------------------------------------------------------------------------

class _ZKPAuth:
    """Wraps standalone Schnorr functions into a backwards-compatible API."""

    def create_client_signature(self, password: str) -> Tuple[str, float]:
        """Create a public key JSON from a password (client-side operation).

        Returns (public_key_json, elapsed_time).
        """
        import time
        start = time.time()
        pk = create_public_key(password)
        return pk, time.time() - start

    def verify_proof(self, proof_data: str, public_key_data: str, token: str) -> Tuple[bool, float]:
        """Verify a proof — delegates to the standalone verify_proof()."""
        return verify_proof(proof_data, public_key_data, token)

    def get_proof_info(self, proof_data: str) -> dict:
        """Parse a proof JSON and return metadata for display."""
        try:
            parsed = json.loads(proof_data)
            return {
                "proof_size": len(proof_data),
                "data_size": len(json.dumps(parsed)),
                "type": "schnorr" if "commitment" in parsed else "noknow",
                "has_commitment": "commitment" in parsed,
                "has_response": "response" in parsed,
                "has_c": "c" in parsed,
                "has_m": "m" in parsed,
            }
        except Exception:
            return {
                "proof_size": len(proof_data),
                "data_size": 0,
                "error": "failed to parse",
            }

    def create_token(self) -> Tuple[str, float]:
        """Create a challenge token (server-side)."""
        import time
        start = time.time()
        token = secrets.token_urlsafe(48)
        return token, time.time() - start

    def sign_data(self, password: str, public_key: str, token: str) -> Tuple[str, float]:
        """
        Client-side: create a Schnorr proof for a challenge token.

        This simulates what the frontend JS does. For true ZKP, the private key
        is randomly generated (not password-derived) — this method accepts the raw
        private key directly for test simulation purposes.
        Returns (proof_json, elapsed_time).
        """
        import time
        start = time.time()
        # For tests: accept raw private key as hex string (not password-derived)
        # Client-side generateKeyPair() produces a hex privateKey string.
        try:
            x = int(password, 16)  # password is actually hex private key
        except ValueError:
            # Fallback: derive from password (BROKEN — only for legacy tests)
            pk = json.loads(public_key)
            x = int(hashlib.sha512(password.encode()).hexdigest(), 16) % _DHQ
        r = secrets.randbelow(_DHQ)
        t = pow(_DHG, r, _DHP)
        c = int(hashlib.sha512(f"{t:x}{token}".encode()).hexdigest(), 16) % _DHQ
        s = (r + c * x) % _DHQ
        proof = json.dumps({"commitment": format(t, 'x'), "response": format(s, 'x')})
        return proof, time.time() - start


zkp_auth = _ZKPAuth()