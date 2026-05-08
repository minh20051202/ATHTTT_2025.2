from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import time
import json
import bcrypt

from .utils.config import settings
from .db.models import init_db, get_db
from .db.operations import db_ops
from .auth.oauth2 import oauth2_auth
from .auth.zkp import zkp_auth
from .agents.intent import intent_extractor, tool_caller
from .api.chat import router as chat_router
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

    # OAuth2 Agent — PKJWT: generate RSA keypair, store public key, return private key once.
    public_key_pem, private_key_pem = oauth2_auth.create_rsa_keypair()
    oauth2_agent = db_ops.create_agent(
        db=db, user_id=user.id, name="OAuth2 Agent",
        auth_type="oauth2", public_key=public_key_pem
    )

    # ZKP Agent — server stores ONLY the public key (ZKSignature params).
    # The password is never on the server. Demo password is 'zkp_password_456'
    # and is held OUT-OF-BAND by the instructor.
    zkp_password = "zkp_password_456"
    # Client derives the same public key from the shared password
    public_key, _ = zkp_auth.create_client_signature(zkp_password)
    zkp_agent = db_ops.create_agent(
        db=db, user_id=user.id, name="ZKP Agent",
        auth_type="zkp", public_key=public_key
    )

    # Sample products
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
            "public_key": public_key_pem,
            "private_key": private_key_pem,
            "note": "Private key shown once. Store it for the classroom demo."
        },
        "zkp_agent": {"id": zkp_agent.id, "name": zkp_agent.name, "auth_type": zkp_agent.auth_type,
                      "note": "Password is NOT stored on server. Client must provide it for authentication."},
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

        # Mint access token
        access_token = oauth2_auth.create_access_token(
            data={"sub": str(agent.id), "agent_name": agent.name, "type": "oauth2"}
        )

        token_info = oauth2_auth.get_token_info(access_token)
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": settings.jwt_expiration_minutes * 60,
            "token_info": token_info
        }
    except AppError as e:
        raise e
    except Exception as e:
        raise AppError(
            error_code="AUTH_FAILED",
            message=f"OAuth2 token generation failed: {str(e)}",
            status_code=500
        )


@app.post("/api/auth/zkp/register")
async def zkp_register_agent(
    agent_name: str,
    user_id: int,
    password: str,
    db=Depends(get_db)
):
    """Register a new ZKP-capable AI Agent. Server stores only the public key."""
    try:
        # Create ZKP agent — password never touches the server, only the public key is stored
        # after generation. credentials_hash stays NULL for ZKP (server never has secret).
        agent = db_ops.create_agent(
            db=db,
            user_id=user_id,
            name=agent_name,
            auth_type="zkp",
        )

        # Generate ZKP public key from password and store it on the agent
        public_key, _ = zkp_auth.create_client_signature(password)

        # Store the public key on the agent
        agent.public_key = public_key
        db.commit()
        db.refresh(agent)

        return {
            "agent_id": agent.id,
            "name": agent.name,
            "auth_type": "zkp",
            "message": "ZKP agent registered successfully. Password is NOT stored — only the public key."
        }
    except Exception as e:
        raise AppError(
            error_code="DATABASE_ERROR",
            message=f"Failed to register ZKP agent: {str(e)}",
            status_code=500
        )




# Export app for uvicorn
__all__ = ["app"]
