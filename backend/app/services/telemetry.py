"""
Session telemetry — hybrid in-memory + Supabase persistence.

In-memory dict gives instant reads for the admin console.
Every mutation fires an async task to persist to Supabase so data
survives server restarts and is shared across instances.
"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import Request

BOOT_TIME = time.time()
MAX_EVENTS_PER_SESSION = 80

_sessions: dict[str, dict[str, Any]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uptime_seconds() -> float:
    return round(time.time() - BOOT_TIME, 1)


async def load_from_db() -> None:
    """Called at startup — hydrate in-memory cache from Supabase."""
    try:
        from . import database as db
        rows = await db.load_sessions(db.get_pool())
        for s in rows:
            sid = s["id"]
            _sessions[sid] = {
                "id":            sid,
                "user_email":    s.get("user_email", "unknown"),
                "user_name":     s.get("user_name", "Unknown"),
                "role":          s.get("role", "client"),
                "status":        "idle",
                "path":          s.get("path", "/"),
                "user_agent":    s.get("user_agent", "unknown"),
                "active_source": s.get("active_source"),
                "first_seen":    s.get("first_seen", now_iso()),
                "last_seen":     s.get("last_seen", now_iso()),
                "request_count": s.get("request_count", 0),
                "error_count":   s.get("error_count", 0),
                "events":        s.get("events", []),
            }
    except Exception:
        pass  # non-fatal — in-memory starts empty


def _fire(coro) -> None:
    """Schedule a coroutine as a background task without blocking."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(coro)
    except RuntimeError:
        pass


def _client_context(request: Request) -> dict[str, str]:
    return {
        "id":         request.headers.get("x-inform-session-id", "anonymous-client"),
        "user_email": request.headers.get("x-inform-user-email", "unknown@client"),
        "user_name":  request.headers.get("x-inform-user-name", "Unknown client"),
        "role":       request.headers.get("x-inform-user-role", "client"),
        "path":       request.headers.get("x-inform-path", "/"),
        "user_agent": request.headers.get("user-agent", "unknown"),
    }


def _get_session(context: dict[str, str]) -> dict[str, Any]:
    timestamp = now_iso()
    session = _sessions.setdefault(
        context["id"],
        {
            "id":            context["id"],
            "user_email":    context["user_email"],
            "user_name":     context["user_name"],
            "role":          context["role"],
            "status":        "active",
            "path":          context["path"],
            "user_agent":    context["user_agent"],
            "active_source": None,
            "first_seen":    timestamp,
            "last_seen":     timestamp,
            "request_count": 0,
            "error_count":   0,
            "events":        [],
        },
    )
    session.update({
        "user_email": context["user_email"],
        "user_name":  context["user_name"],
        "role":       context["role"],
        "path":       context["path"],
        "user_agent": context["user_agent"],
        "last_seen":  timestamp,
    })
    return session


def _trim_events(session: dict[str, Any]) -> None:
    if len(session["events"]) > MAX_EVENTS_PER_SESSION:
        session["events"] = session["events"][-MAX_EVENTS_PER_SESSION:]


async def _persist_session_and_event(session: dict, event: dict) -> None:
    try:
        from . import database as db
        pool = db.get_pool()
        await db.upsert_session(pool, session)
        await db.insert_session_event(pool, event, session["id"])
    except Exception:
        pass  # non-fatal


def record_event(
    request: Request,
    event_type: str,
    message: str,
    *,
    status: str = "ok",
    metadata: dict[str, Any] | None = None,
) -> None:
    session = _get_session(_client_context(request))
    event = {
        "id":        uuid4().hex[:12],
        "timestamp": now_iso(),
        "type":      event_type,
        "status":    status,
        "message":   message,
        "metadata":  metadata or {},
    }
    session["request_count"] += 1
    if status == "error":
        session["error_count"] += 1
    if metadata and metadata.get("source_file"):
        session["active_source"] = str(metadata["source_file"])
    session["events"].append(event)
    _trim_events(session)

    _fire(_persist_session_and_event(dict(session), event))


def record_exception(
    request: Request,
    event_type: str,
    message: str,
    exc: Exception,
    *,
    metadata: dict[str, Any] | None = None,
) -> None:
    details = dict(metadata or {})
    details["error_type"] = exc.__class__.__name__
    details["error"] = str(exc)[:280]
    record_event(request, event_type, message, status="error", metadata=details)


def record_admin_event(
    session_id: str,
    command: str,
    output: list[str],
    *,
    status: str = "ok",
) -> None:
    session = _sessions.get(session_id)
    if not session:
        return
    session["last_seen"] = now_iso()
    event = {
        "id":        uuid4().hex[:12],
        "timestamp": now_iso(),
        "type":      "admin-command",
        "status":    status,
        "message":   f"Admin ran {command}",
        "metadata":  {"output": output[:6]},
    }
    session["events"].append(event)
    _trim_events(session)

    _fire(_persist_session_and_event(dict(session), event))


def list_sessions() -> list[dict[str, Any]]:
    current = time.time()
    result = []
    for session in _sessions.values():
        try:
            last_seen = datetime.fromisoformat(session["last_seen"]).timestamp()
        except ValueError:
            last_seen = current
        status = "active" if current - last_seen < 60 else "idle"
        result.append({**session, "status": status, "events": session["events"][-12:]})
    return sorted(result, key=lambda s: s["last_seen"], reverse=True)


def get_session(session_id: str) -> dict[str, Any] | None:
    return _sessions.get(session_id)
