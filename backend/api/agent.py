import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..agents.server_agent import ServerAgent
from ..db.models import Agent, get_db
from ..utils.errors import AppError, ErrorCode
from .agent_auth import verify_agent_request


router = APIRouter(prefix="/api/agent", tags=["agent"])


class DelegateRequest(BaseModel):
    task: str
    calling_agent_id: int
    target_agent_id: int
    zkp_token: str | None = None
    zkp_proof: str | None = None


def get_agent_or_404(db: Session, agent_id: int) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise AppError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            message=f"Agent {agent_id} not found",
            status_code=404,
        )
    return agent


def sse(event: str, data: dict | None) -> str:
    return f"event: {event}\ndata: {json.dumps(data or {})}\n\n"


@router.post("/delegate")
async def agent_delegate(
    request: DelegateRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    calling_agent = get_agent_or_404(db, request.calling_agent_id)
    if calling_agent.agent_type != "user":
        raise AppError(
            error_code=ErrorCode.AUTH_FAILED,
            message="Only user agents can delegate",
            status_code=403,
        )

    auth_info = verify_agent_request(
        calling_agent,
        http_request,
        zkp_token=request.zkp_token,
        zkp_proof=request.zkp_proof,
    )

    target_agent = get_agent_or_404(db, request.target_agent_id)
    if target_agent.agent_type != "server":
        raise AppError(
            error_code=ErrorCode.INVALID_OPERATION,
            message="Target must be a server agent",
            status_code=400,
        )

    server_agent = ServerAgent()

    async def event_stream():
        yield sse("auth", auth_info)
        try:
            async for item in server_agent.stream_run(
                request.task,
                calling_agent.auth_type,
                calling_agent.id,
                db,
            ):
                yield sse(item["event"], item["data"])
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
