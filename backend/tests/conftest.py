import os
import sys
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch

# Set up Python path so backend can be imported as a package
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

# Set test environment variables BEFORE any backend imports
os.environ["DATABASE_URL"] = "sqlite:///./test_agentic_commerce.db"
os.environ["NIM_API_KEY"] = "test-nim-api-key"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-12345"
os.environ["ZKP_SECRET_KEY"] = "test-zkp-secret-key-12345"
os.environ["OAUTH2_CLIENT_ID"] = "test_oauth2_client"
os.environ["OAUTH2_CLIENT_SECRET"] = "test_oauth2_secret"
os.environ["ENVIRONMENT"] = "test"

# Now import the app and database modules
from backend.db.models import Base, get_db, User, Agent, Product
from backend.main import app


# Test database engine — separate from the main one
TEST_DATABASE_URL = "sqlite:///./test_agentic_commerce.db"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    """Override the FastAPI get_db dependency to use test database."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Override the dependency
app.dependency_overrides[get_db] = override_get_db


# ---------------------------------------------------------------------------
# Mock intent extractor — avoids real NVIDIA NIM API calls in tests
# ---------------------------------------------------------------------------
class MockIntent:
    """Return a deterministic intent for all messages."""
    action = "search_products"
    parameters = {"query": "laptop"}
    confidence = 0.99

    def dict(self):
        return {
            "action": self.action,
            "parameters": self.parameters,
            "confidence": self.confidence
        }


@pytest.fixture(autouse=True)
def mock_intent_extractor():
    """Replace the real intent extractor with a mock in all tests."""
    from backend.agents import intent as intent_module
    original_extract = intent_module.intent_extractor.extract_intent

    async def mock_extract(message: str):
        return MockIntent()

    intent_module.intent_extractor.extract_intent = mock_extract
    yield
    # Restore original after test
    intent_module.intent_extractor.extract_intent = original_extract


@pytest.fixture(scope="function")
def db():
    """Provide a clean database session for each test."""
    Base.metadata.create_all(bind=test_engine)
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def client(db):
    """Provide a FastAPI TestClient bound to the test database."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="function")
def demo_user(db):
    """Create a demo user."""
    user = User(username="testuser", email="testuser@example.com", credentials_hash="hash_test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="function")
def oauth2_agent(db, demo_user):
    """Create an OAuth2 agent for testing.

    Client generates its own keypair and registers public key via /api/auth/oauth2/register.
    Server NEVER stores any per-agent private key.
    """
    from backend.auth.oauth2 import oauth2_auth

    # Client (test) generates keypair — private never stored, public stored for client_assertion verify
    public_pem, private_pem = oauth2_auth.create_rsa_keypair()

    agent = Agent(
        user_id=demo_user.id,
        name="Test OAuth2 Agent (PKJWT)",
        auth_type="oauth2",
        credentials_hash=None,
        public_key=public_pem,
        oauth2_private_key=None,  # DEPRECATED: server never stores per-agent private key
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # Client-side private key for signing assertions (not stored in DB)
    agent._test_private_key = private_pem
    return agent


@pytest.fixture(scope="function")
def zkp_agent(db, demo_user):
    """Create a ZKP agent with a stored public key (password is held by client only)."""
    from backend.auth.zkp import zkp_auth
    password = "zkp_test_password"
    public_key, _ = zkp_auth.create_client_signature(password)

    agent = Agent(
        user_id=demo_user.id,
        name="Test ZKP Agent",
        auth_type="zkp",
        credentials_hash="hash_zkp",
        public_key=public_key
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # Attach the plain password so tests can retrieve it
    # NOTE: this is the CLIENT's password — server only has public_key
    agent._test_password = password
    return agent


@pytest.fixture(scope="function")
def oauth2_pkjwt_agent(db, demo_user):
    """Create an OAuth2 agent for PKJWT testing with stored RSA public key.

    Client holds private key (for signing assertions). Server stores ONLY public key.
    Access tokens are HS256 (server symmetric secret), not per-agent RS256.
    """
    from backend.auth.oauth2 import oauth2_auth

    # Client (test) generates a keypair — private held by test, public stored in DB
    public_pem, private_pem = oauth2_auth.create_rsa_keypair()

    agent = Agent(
        user_id=demo_user.id,
        name="Test OAuth2 PKJWT Agent",
        auth_type="oauth2",
        credentials_hash=None,        # No bcrypt hash — PKJWT agent
        public_key=public_pem,
        oauth2_private_key=None,  # DEPRECATED: server never stores per-agent private key
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # Client holds the private key — tests use it to sign client_assertions (RS256)
    agent._test_private_key = private_pem
    return agent


@pytest.fixture(scope="function")
def sample_products(db):
    """Create sample products for testing."""
    products = [
        Product(name="Laptop", price=999.99, stock=10, description="Gaming laptop", category="Electronics"),
        Product(name="Mouse", price=49.99, stock=100, description="Wireless mouse", category="Accessories"),
        Product(name="Keyboard", price=79.99, stock=50, description="Mechanical keyboard", category="Accessories"),
    ]
    for p in products:
        db.add(p)
    db.commit()
    for p in products:
        db.refresh(p)
    return products


@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    """Ensure test database file is removed before the session starts."""
    import os
    db_path = os.path.join(PROJECT_ROOT, "test_agentic_commerce.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    yield
    if os.path.exists(db_path):
        os.remove(db_path)