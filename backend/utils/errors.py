from typing import Optional, Any
from fastapi import HTTPException, status


class ErrorResponse:
    """Structured error response format."""

    def __init__(
        self,
        error_code: str,
        message: str,
        details: Optional[dict] = None,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    ):
        self.error_code = error_code
        self.message = message
        self.details = details or {}
        self.status_code = status_code

    def to_dict(self) -> dict:
        return {
            "error_code": self.error_code,
            "message": self.message,
            "details": self.details
        }


class AppError(HTTPException):
    """Custom application error with structured response."""

    def __init__(
        self,
        error_code: str,
        message: str,
        details: Optional[dict] = None,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    ):
        self.error_code = error_code
        self.message = message
        self.details = details or {}
        super().__init__(
            status_code=status_code,
            detail=ErrorResponse(error_code, message, details).to_dict()
        )


# Common error codes
class ErrorCode:
    # Authentication errors
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_INVALID = "TOKEN_INVALID"
    AUTH_FAILED = "AUTH_FAILED"

    # Authorization errors
    PERMISSION_DENIED = "PERMISSION_DENIED"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"

    # Request errors
    INVALID_REQUEST = "INVALID_REQUEST"
    MISSING_PARAMETER = "MISSING_PARAMETER"
    INVALID_PARAMETER = "INVALID_PARAMETER"

    # Database errors
    DATABASE_ERROR = "DATABASE_ERROR"
    DUPLICATE_ENTRY = "DUPLICATE_ENTRY"

    # External service errors
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    NIM_API_ERROR = "NIM_API_ERROR"

    # Business logic errors
    INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK"
    INVALID_OPERATION = "INVALID_OPERATION"

    # Attack simulation errors
    ATTACK_SIMULATION_FAILED = "ATTACK_SIMULATION_FAILED"
    ATTACK_ISOLATION_ERROR = "ATTACK_ISOLATION_ERROR"


