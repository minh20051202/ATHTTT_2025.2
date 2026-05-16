from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, env_file=".env", extra="ignore")

    # Database
    database_url: str = "sqlite:///./agentic_commerce.db"

    # NVIDIA NIM Configuration
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_api_key: str = ""

    # OAuth2 Configuration
    oauth2_client_id: str = "your_client_id"
    oauth2_client_secret: str = "your_client_secret"
    oauth2_redirect_uri: str = "http://localhost:8000/oauth/callback"

    # JWT Configuration
    jwt_secret_key: str = "your_jwt_secret_key_here"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 30

    # ZKP Configuration
    zkp_secret_key: str = "your_zkp_secret_key_here"

    # Attack Simulation Settings
    strict_assertion_check: bool = False  # Default vulnerable; set True for secure mode
    vulnerable_rng: bool = False

    # Environment
    environment: str = "development"
    debug: bool = True

    # These fields accept comma-separated strings in env vars, parsed after init
    _env_cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Logging simulation
    log_buffer: List[dict] = []
    
    # MITM interception simulation
    tls_downgrade_active: bool = False
    proxy_buffer: List[dict] = []

    @property
    def cors_origins(self) -> List[str]:
        return [u.strip() for u in self._env_cors_origins.split(",") if u.strip()]


settings = Settings()
