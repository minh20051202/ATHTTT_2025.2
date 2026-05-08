from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
import bcrypt
from ..utils.config import settings
from ..utils.errors import AppError, ErrorCode
import time
import json


pwd_context = None  # lazily initialized below

def _get_bcrypt():
    global pwd_context
    if pwd_context is None:
        pwd_context = bcrypt


class OAuth2Auth:
    """OAuth2 authentication with Private Key JWT for AI Agents."""

    def __init__(self):
        self.secret_key = settings.jwt_secret_key
        self.algorithm = settings.jwt_algorithm
        self.expiration_minutes = settings.jwt_expiration_minutes

    def hash_password(self, password: str) -> str:
        """Hash a password for storage."""
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against a hash."""
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

    def create_access_token(
        self,
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """Create a JWT access token."""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.expiration_minutes)

        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt

    def verify_token(self, token: str) -> Dict[str, Any]:
        """Verify and decode a JWT token."""
        start_time = time.time()
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            verification_time = time.time() - start_time
            payload["verification_time"] = verification_time
            return payload
        except JWTError as e:
            raise AppError(
                error_code=ErrorCode.TOKEN_INVALID,
                message=f"Invalid token: {str(e)}",
                status_code=401
            )

    def create_rsa_keypair(self) -> tuple[str, str]:
        """Generate a RSA-2048 keypair. Returns (public_pem, private_pem)."""
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
        public_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        return public_pem.decode("utf-8"), private_pem.decode("utf-8")

    def create_client_assertion(self, client_id: str, private_key_pem: str) -> tuple[str, float]:
        """Create a signed JWT client_assertion (RFC 7523). Signs with RS256."""
        import time
        start = time.time()
        now = datetime.now(timezone.utc)
        payload = {
            "iss": client_id,
            "sub": client_id,
            "aud": "https://oauth.example.com/token",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "jti": f"{int(now.timestamp() * 1000)}",
        }
        assertion = jwt.encode(payload, private_key_pem, algorithm="RS256")
        return assertion, time.time() - start

    def verify_client_assertion(self, assertion: str, public_key_pem: str) -> dict:
        """Verify a client_assertion JWT (RS256) using the stored public key."""
        try:
            payload = jwt.decode(assertion, public_key_pem, algorithms=["RS256"],
                               options={"verify_aud": False})
            return payload
        except JWTError as e:
            raise AppError(
                error_code=ErrorCode.TOKEN_INVALID,
                message=f"Invalid client assertion: {str(e)}",
                status_code=401
            )

    def get_assertion_payload(self, assertion: str) -> dict:
        """Decode assertion payload WITHOUT signature verification (for inspection)."""
        try:
            return jwt.decode(assertion, key=None, algorithms=["RS256"], options={"verify_signature": False})
        except Exception as e:
            raise AppError(
                error_code=ErrorCode.TOKEN_INVALID,
                message=f"Invalid assertion format: {str(e)}",
                status_code=400
            )

    def create_private_key_jwt(
        self,
        client_id: str,
        private_key: str
    ) -> tuple[str, float]:
        """Create a Private Key JWT for client authentication."""
        now = datetime.now(timezone.utc)
        payload = {
            "iss": client_id,
            "sub": client_id,
            "aud": "https://oauth.example.com/token",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "jti": f"{int(now.timestamp() * 1000)}"
        }

        start_time = time.time()
        encoded_jwt = jwt.encode(payload, private_key, algorithm="RS256")
        generation_time = time.time() - start_time

        return encoded_jwt, generation_time

    def get_token_info(self, token: str) -> Dict[str, Any]:
        """Get information about a token for display purposes (no signature verification)."""
        try:
            # Decode WITHOUT signature verification to extract payload for display
            payload = jwt.decode(token, key=None, algorithms=["HS256", "RS256"], options={"verify_signature": False})
            return {
                "header": jwt.get_unverified_header(token),
                "payload": payload,
                "token_size": len(token)
            }
        except Exception as e:
            return {
                "error": str(e),
                "token_size": len(token) if token else 0
            }

    def create_access_token_with_key(
        self,
        data: Dict[str, Any],
        private_key_pem: str,
        expires_delta: Optional[timedelta] = None
    ) -> tuple[str, float]:
        """Create a JWT access token signed with an RSA private key (RS256).

        Args:
            data: Payload data to encode
            private_key_pem: RSA PKCS8 private key in PEM format
            expires_delta: Optional custom expiration time delta

        Returns:
            (encoded_jwt, generation_time_ms)
        """
        start = time.time()
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=self.expiration_minutes)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, private_key_pem, algorithm="RS256")
        return encoded_jwt, time.time() - start

    def verify_token_with_public_key(self, token: str, public_key_pem: str) -> Dict[str, Any]:
        """Verify and decode a JWT access token using a stored RSA public key (asymmetric RS256).

        Args:
            token: The JWT access token
            public_key_pem: RSA public key in PEM format

        Returns:
            Decoded JWT payload with added `verification_time` field

        Raises:
            AppError with 401 if token is invalid
        """
        start = time.time()
        try:
            payload = jwt.decode(token, public_key_pem, algorithms=["RS256"])
            payload["verification_time"] = time.time() - start
            return payload
        except JWTError as e:
            raise AppError(
                error_code=ErrorCode.TOKEN_INVALID,
                message=f"Invalid token: {str(e)}",
                status_code=401
            )


oauth2_auth = OAuth2Auth()
