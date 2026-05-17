from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import time
import json

from .utils.config import settings
from .db.models import init_db, get_db
from .db.operations import db_ops
from .auth.oauth2 import oauth2_auth
from .auth.zkp import zkp_auth
from .api.chat import router as chat_router
from .api.agent import router as agent_router
from .attacks.simulations import router as attacks_router
from .utils.errors import AppError

# Store active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass  # Ignore broken connections


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    init_db()
    print("Database initialized")
    yield
    # Shutdown
    print("Shutting down")


app = FastAPI(title="Agentic Commerce Demo", version="1.0.0", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(chat_router)
app.include_router(agent_router)
app.include_router(attacks_router)


@app.get("/")
async def root():
    return {"message": "Agentic Commerce Demo API", "docs": "/docs"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": time.time()}


@app.post("/api/demo/seed")
async def seed_demo(db=Depends(get_db)):
    """Create demo data: user, agents (OAuth2 and ZKP), products."""
    # Create demo user
    try:
        user = db_ops.create_user(
            db=db, username="demo", email="demo@example.com", password="demo"
        )
    except Exception:
        db.rollback()
        from .db.models import User
        user = db.query(User).filter_by(username="demo").first()
        if not user:
            raise

    # OAuth2 Agent — upserted (idempotent seed). Client generates its own RSA keypair,
    # sends only public key via POST /api/auth/oauth2/register.
    oauth2_agent = db_ops.upsert_agent(
        db=db, user_id=user.id, name="OAuth2 Agent",
        auth_type="oauth2", public_key=None
    )

    # ZKP Agent — public_key=NULL initially. Client generates its own random
    # keypair during onboarding and registers public key via POST /api/auth/zkp/register.
    zkp_agent = db_ops.upsert_agent(
        db=db, user_id=user.id, name="ZKP Agent",
        auth_type="zkp", public_key=None
    )

    server_agent = db_ops.upsert_agent(
        db=db,
        user_id=user.id,
        name="CommerceServerAgent",
        auth_type="oauth2",
        public_key=None,
        agent_type="server",
    )

    # Sample products — upsert via create_product (handles duplicates)
    products_data = [
        {"name": "Laptop", "price": 999.99, "stock": 10, "description": "High-performance laptop", "category": "Electronics"},
        {"name": "Smartphone", "price": 499.99, "stock": 25, "description": "Latest model smartphone", "category": "Electronics"},
        {"name": "Headphones", "price": 149.99, "stock": 50, "description": "Noise-cancelling headphones", "category": "Audio"},
        {"name": "Smartwatch", "price": 199.99, "stock": 30, "description": "Fitness tracker with heart monitor", "category": "Wearables"},
    ]
    products = [db_ops.create_product(db, **p) for p in products_data]
    db.commit()

    return {
        "message": "Demo data created",
        "user": {"id": user.id, "username": user.username},
        "oauth2_agent": {
            "id": oauth2_agent.id,
            "name": oauth2_agent.name,
            "auth_type": oauth2_agent.auth_type,
            "agent_type": oauth2_agent.agent_type,
            "note": "Client must call POST /api/auth/oauth2/register with RSA public key. Private key never sent to server.",
        },
        "zkp_agent": {"id": zkp_agent.id, "name": zkp_agent.name, "auth_type": zkp_agent.auth_type,
                      "agent_type": zkp_agent.agent_type,
                      "note": "Password is NOT stored on server. Client must provide it for authentication."},
        "server_agent": {
            "id": server_agent.id,
            "name": server_agent.name,
            "auth_type": server_agent.auth_type,
            "agent_type": server_agent.agent_type,
        },
        "products": [{"id": p.id, "name": p.name, "price": p.price} for p in products]
    }


@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """WebSocket endpoint for real-time dashboard updates."""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and receive any messages
            data = await websocket.receive_text()
            # Echo back or handle dashboard commands
            await websocket.send_json({"type": "pong", "timestamp": time.time()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post("/api/auth/oauth2/token")
async def oauth2_token_endpoint(
    client_id: str = Form(None),
    client_assertion: str = Form(None),
    db=Depends(get_db)
):
    """Exchange a client_assertion JWT (RS256) signed by the agent's private key
    for an access token. Implements RFC 7523 Private Key JWT."""
    try:
        # Validate required fields
        if not client_id or not client_assertion:
            raise AppError(
                error_code="INVALID_PARAMETER",
                message="client_id and client_assertion are required",
                status_code=422
            )
        # Parse client_id as agent ID
        agent_id = int(client_id)
        from .db.models import Agent
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            raise AppError(
                error_code="AUTH_FAILED",
                message="Unknown agent",
                status_code=401
            )

        if agent.auth_type != "oauth2":
            raise AppError(
                error_code="INVALID_PARAMETER",
                message="This endpoint only supports OAuth2 agents",
                status_code=400
            )

        if not agent.public_key:
            raise AppError(
                error_code="INVALID_OPERATION",
                message="OAuth2 agent has no public key — cannot verify assertion",
                status_code=500
            )

        # Verify the client_assertion signed with this agent's private key
        try:
            payload = oauth2_auth.verify_client_assertion(client_assertion, agent.public_key)
        except AppError:
            raise AppError(
                error_code="AUTH_FAILED",
                message="Invalid client assertion signature",
                status_code=401
            )

        # Validate iss/sub match the client_id (agent id)
        if payload.get("iss") != client_id or payload.get("sub") != client_id:
            raise AppError(
                error_code="AUTH_FAILED",
                message="Client assertion issuer/subject mismatch",
                status_code=401
            )

        # Mint access token using server-side symmetric key (HS256)
        access_token = oauth2_auth.create_access_token(
            data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"},
        )
        # HS256 signing is too fast to measure; use 0 for the sign_time field
        sign_time = 0

        token_info = oauth2_auth.get_token_info(access_token)
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": settings.jwt_expiration_minutes * 60,
            "token_info": token_info,
            "token_sign_time_ms": round(sign_time * 1000, 3),
        }
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code="AUTH_FAILED",
            message=f"OAuth2 token generation failed: {str(e)}",
            status_code=500
        )


@app.post("/api/auth/oauth2/register")
async def oauth2_register_agent(
    client_id: str = Form(...),
    public_key_pem: str = Form(...),
    db=Depends(get_db)
):
    """Register an OAuth2 agent's public key. Server never stores the private key."""
    try:
        agent_id = int(client_id)
        from .db.models import Agent
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            raise AppError(
                error_code="AGENT_NOT_FOUND",
                message="Agent not found",
                status_code=404
            )
        if agent.auth_type != "oauth2":
            raise AppError(
                error_code="INVALID_AUTH_TYPE",
                message="This endpoint only supports OAuth2 agents",
                status_code=400
            )
        agent.public_key = public_key_pem
        db.commit()
        return {
            "client_id": str(agent.id),
            "name": agent.name,
            "auth_type": agent.auth_type,
            "message": "Public key registered successfully. Server NEVER stores the private key."
        }
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code="REGISTRATION_FAILED",
            message=f"Failed to register OAuth2 agent: {str(e)}",
            status_code=500
        )


@app.post("/api/auth/zkp/register")
async def zkp_register_public_key(
    agent_id: int = Form(...),
    public_key: str = Form(...),
    db=Depends(get_db)
):
    """
    Client sends its Schnorr public key. Server stores only the public key.
    Private key never touches the server.

    public_key format: JSON string {"y": hex, "p": hex, "g": hex, "q": hex}
    """
    from .db.models import Agent
    from .utils.errors import AppError, ErrorCode

    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise AppError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            message="Agent not found",
            status_code=404
        )
    if agent.auth_type != "zkp":
        raise AppError(
            error_code=ErrorCode.INVALID_PARAMETER,
            message="Only ZKP agents can use this endpoint",
            status_code=400
        )

    # Parse and validate public_key fields
    from .utils.errors import AppError, ErrorCode
    import json as _json
    try:
        pk = _json.loads(public_key)
        for field in ("y", "p", "g", "q"):
            val = pk.get(field)
            if val is None:
                raise ValueError(f"missing {field}")
            # Accept hex strings (production: "1cf3...") or already-parsed ints (tests)
            if isinstance(val, str):
                pk[field] = int(val, 16)
    except Exception:
        raise AppError(
            error_code=ErrorCode.INVALID_PARAMETER,
            message="public_key must be JSON with fields: y, p, g, q (all hex integers)",
            status_code=400
        )

    agent.public_key = public_key
    db.add(agent)
    db.commit()

    return {
        "agent_id": agent.id,
        "message": "ZKP public key registered. Server NEVER stores the private key."
    }




# Export app for uvicorn
__all__ = ["app"]
