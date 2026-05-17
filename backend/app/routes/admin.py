from pathlib import Path

from fastapi import APIRouter, Header, HTTPException

from ..config import settings
from ..models import AdminCommandRequest, AdminCommandResponse, AdminSessionsResponse
from ..services.telemetry import (
    get_session,
    list_sessions,
    now_iso,
    record_admin_event,
    uptime_seconds,
)
from .query import get_metrics

router = APIRouter()

SAFE_COMMANDS = {
    "healthcheck",
    "trace",
    "errors",
    "sources",
    "capture-snapshot",
    "reset-context",
    "mark-reviewed",
}


def _authorize_admin(token: str | None) -> None:
    if settings.admin_api_token and token != settings.admin_api_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")


def _safe_sources() -> list[str]:
    try:
        from .ingest import get_embedder

        return get_embedder().list_sources()
    except Exception:
        return []


@router.get("/admin/sessions", response_model=AdminSessionsResponse)
async def admin_sessions(x_admin_token: str | None = Header(default=None)):
    _authorize_admin(x_admin_token)
    return AdminSessionsResponse(
        generated_at=now_iso(),
        uptime_seconds=uptime_seconds(),
        sessions=list_sessions(),
    )


@router.post("/admin/command", response_model=AdminCommandResponse)
async def admin_command(
    req: AdminCommandRequest,
    x_admin_token: str | None = Header(default=None),
):
    _authorize_admin(x_admin_token)
    command = req.command.strip().lower()
    if command not in SAFE_COMMANDS:
        raise HTTPException(status_code=400, detail="Unsupported admin command")

    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    metrics = get_metrics()
    sources = _safe_sources()
    output: list[str]
    status = "ok"

    if command == "healthcheck":
        output = [
            "api: ok",
            f"uptime_seconds: {uptime_seconds()}",
            f"total_queries: {metrics['total_queries']}",
            f"avg_latency_ms: {round(metrics['total_latency_ms'] / metrics['total_queries'], 1) if metrics['total_queries'] else 0}",
            f"indexed_sources: {len(sources)}",
            f"upload_dir_exists: {Path(settings.upload_dir).exists()}",
            f"supabase_db: {'configured' if settings.supabase_db_url else 'local-mode'}",
            f"layoutlm_model_dir: {settings.layoutlm_model_dir}",
            f"cross_validate_ingest: {settings.cross_validate_ingest}",
        ]
    elif command == "trace":
        events = session.get("events", [])[-10:]
        output = [
            f"{event['timestamp']} [{event['status']}] {event['type']}: {event['message']}"
            for event in events
        ] or ["trace: no events captured for this session"]
    elif command == "errors":
        errors = [event for event in session.get("events", []) if event["status"] == "error"]
        output = [
            f"{event['timestamp']} {event['type']}: {event['message']}"
            for event in errors[-10:]
        ] or ["errors: no captured errors for this session"]
    elif command == "sources":
        output = [f"source: {source}" for source in sources] or ["sources: no indexed documents"]
    elif command == "capture-snapshot":
        output = [
            "snapshot: captured server-side telemetry",
            f"session_id: {session['id']}",
            f"user: {session['user_email']}",
            f"path: {session['path']}",
            f"active_source: {session.get('active_source') or 'none'}",
            f"events: {len(session.get('events', []))}",
        ]
    elif command == "reset-context":
        output = [
            "reset-context: server marker recorded",
            "client_action: refresh browser session or reopen document workspace",
            "note: live remote reset requires a websocket control channel",
        ]
    else:
        output = ["mark-reviewed: session marked for admin follow-up"]

    record_admin_event(req.session_id, command, output, status=status)
    return AdminCommandResponse(
        session_id=req.session_id,
        command=command,
        status=status,
        generated_at=now_iso(),
        output=output,
    )
