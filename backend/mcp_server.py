"""INFORM MCP server.

Exposes the invoice-intelligence backend as MCP tools so any LLM
(Claude Desktop, Claude Code, Cursor, ChatGPT, etc.) can hand over an
invoice and receive a grounded answer.

Transports
──────────
  stdio  (default) — for local LLM clients (Claude Desktop, Claude Code)
  http             — streamable HTTP, for remote clients over the internet

Run locally over stdio:
    python backend/mcp_server.py

Run as a public HTTP server (use ./mcp_serve.sh for a one-command tunnel):
    INFORM_MCP_TRANSPORT=http \\
    INFORM_MCP_HOST=0.0.0.0 \\
    INFORM_MCP_PORT=8765 \\
    INFORM_MCP_TOKEN=$(openssl rand -hex 16) \\
    python backend/mcp_server.py

Environment
───────────
  INFORM_API_URL         Backend FastAPI base URL (default http://localhost:8000)
  INFORM_TENANT_EMAIL    Tenant identity sent on every request
  INFORM_HTTP_TIMEOUT    Per-request timeout in seconds (default 120)
  INFORM_MCP_TRANSPORT   stdio | http (default stdio)
  INFORM_MCP_HOST        Bind host for http transport (default 127.0.0.1)
  INFORM_MCP_PORT        Bind port for http transport (default 8765)
  INFORM_MCP_TOKEN       Optional bearer token; required on every HTTP call
                         when set. Strongly recommended for public exposure.
  INFORM_MAX_FETCH_MB    Max size for url-based ingest (default 25)
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

API_URL = os.getenv("INFORM_API_URL", "http://localhost:8000").rstrip("/")
TENANT_EMAIL = os.getenv("INFORM_TENANT_EMAIL", "demo@inform.app")
TIMEOUT = float(os.getenv("INFORM_HTTP_TIMEOUT", "120"))
MAX_FETCH_BYTES = int(float(os.getenv("INFORM_MAX_FETCH_MB", "25")) * 1024 * 1024)
MCP_TOKEN = os.getenv("INFORM_MCP_TOKEN", "").strip()

# Allow Host headers from tunnels / reverse proxies.
# Set INFORM_MCP_ALLOWED_HOSTS="example.com,foo.trycloudflare.com" to lock down,
# or leave the default ("*") to accept any host (fine when bearer-auth is on).
_allowed_hosts = [
    h.strip() for h in os.getenv("INFORM_MCP_ALLOWED_HOSTS", "*").split(",") if h.strip()
]
_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=("*" not in _allowed_hosts),
    allowed_hosts=_allowed_hosts,
)

mcp = FastMCP(
    "inform-invoice-intelligence",
    host=os.getenv("INFORM_MCP_HOST", "127.0.0.1"),
    port=int(os.getenv("INFORM_MCP_PORT", "8765")),
    stateless_http=True,         # works reliably through tunnels / load balancers
    json_response=True,          # plain JSON instead of SSE — no chunked stream
    transport_security=_security,
)


def _headers() -> dict[str, str]:
    return {"x-inform-user-email": TENANT_EMAIL}


async def _ingest_bytes(filename: str, data: bytes) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        files = {"file": (filename, data, "application/octet-stream")}
        r = await client.post(f"{API_URL}/api/ingest", files=files, headers=_headers())
    if r.status_code >= 400:
        return {"error": f"Ingest failed ({r.status_code}): {r.text}"}
    return r.json()


async def _query(question: str, source_file: str | None, top_k: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{API_URL}/api/query",
            json={"query": question, "source_file": source_file, "top_k": top_k},
            headers=_headers(),
        )
    if r.status_code >= 400:
        return {"error": f"Query failed ({r.status_code}): {r.text}"}
    return r.json()


def _format(question_result: dict, ingest_result: dict | None, filename: str) -> dict:
    if "error" in question_result:
        return question_result
    out = {
        "answer": question_result.get("answer", ""),
        "grounded": question_result.get("grounded", False),
        "refused": question_result.get("refused", False),
        "failure_mode": question_result.get("failure_mode"),
        "source_file": filename,
        "citations": question_result.get("citations", []),
    }
    if ingest_result:
        out["document_id"] = ingest_result.get("document_id")
        out["chunk_count"] = ingest_result.get("chunk_count")
        out["cached"] = ingest_result.get("cached", False)
    return out


# ── Tools ────────────────────────────────────────────────────────────────────

@mcp.tool()
async def ask_invoice_url(url: str, question: str, top_k: int = 5) -> dict:
    """Fetch an invoice from a public URL, index it, and answer a question.

    Best tool for remote LLMs that cannot read the caller's filesystem.

    Args:
        url: HTTPS URL of a PDF/JPG/PNG invoice.
        question: Natural-language question about the invoice.
        top_k: Max supporting chunks to retrieve.
    """
    if not url.lower().startswith(("http://", "https://")):
        return {"error": "url must be http(s)"}

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        try:
            r = await client.get(url)
        except Exception as exc:
            return {"error": f"Fetch failed: {exc}"}
    if r.status_code >= 400:
        return {"error": f"Fetch failed ({r.status_code})"}
    if len(r.content) > MAX_FETCH_BYTES:
        return {"error": f"File exceeds {MAX_FETCH_BYTES // (1024*1024)} MB limit"}

    filename = url.rsplit("/", 1)[-1].split("?", 1)[0] or "invoice.pdf"
    ingest = await _ingest_bytes(filename, r.content)
    if "error" in ingest:
        return ingest
    qres = await _query(question, filename, top_k)
    return _format(qres, ingest, filename)


@mcp.tool()
async def ask_invoice_base64(
    filename: str, content_base64: str, question: str, top_k: int = 5
) -> dict:
    """Index an invoice supplied as base64 bytes, then answer a question.

    Use when the LLM can pass the file inline (no public URL needed).

    Args:
        filename: Original filename including extension (.pdf/.jpg/.png).
        content_base64: Base64-encoded file bytes.
        question: Natural-language question.
        top_k: Max supporting chunks to retrieve.
    """
    try:
        data = base64.b64decode(content_base64, validate=True)
    except Exception as exc:
        return {"error": f"Invalid base64: {exc}"}
    if len(data) > MAX_FETCH_BYTES:
        return {"error": f"File exceeds {MAX_FETCH_BYTES // (1024*1024)} MB limit"}

    ingest = await _ingest_bytes(filename, data)
    if "error" in ingest:
        return ingest
    qres = await _query(question, filename, top_k)
    return _format(qres, ingest, filename)


@mcp.tool()
async def ask_invoice_local(file_path: str, question: str, top_k: int = 5) -> dict:
    """Index an invoice from a local file path (stdio / co-located clients only)."""
    path = Path(file_path).expanduser().resolve()
    if not path.is_file():
        return {"error": f"File not found: {path}"}
    data = path.read_bytes()
    ingest = await _ingest_bytes(path.name, data)
    if "error" in ingest:
        return ingest
    qres = await _query(question, path.name, top_k)
    return _format(qres, ingest, path.name)


@mcp.tool()
async def query_indexed_invoice(
    question: str, source_file: str | None = None, top_k: int = 5
) -> dict:
    """Query an already-indexed invoice by filename, without re-uploading."""
    qd = await _query(question, source_file, top_k)
    if "error" in qd:
        return qd
    return {
        "answer": qd.get("answer", ""),
        "grounded": qd.get("grounded", False),
        "refused": qd.get("refused", False),
        "citations": qd.get("citations", []),
    }


@mcp.tool()
async def list_invoices() -> dict:
    """List filenames of all invoices indexed in the backend."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{API_URL}/api/sources", headers=_headers())
    if r.status_code >= 400:
        return {"error": f"List failed ({r.status_code}): {r.text}"}
    return r.json()


# ── Optional bearer-token auth for HTTP transport ────────────────────────────

class _BearerAuth(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Allow unauthenticated health probes (used by tunnels & load balancers)
        if request.url.path in {"/healthz", "/", "/health"}:
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer ") or auth[7:].strip() != MCP_TOKEN:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


def _run_http() -> None:
    import logging
    import uvicorn
    from starlette.routing import Route

    logging.basicConfig(level=logging.INFO)
    log = logging.getLogger("inform-mcp")

    app = mcp.streamable_http_app()

    # Public health endpoint so tunnels/probes have a 200 to hit.
    async def _healthz(_request):
        return JSONResponse({"status": "ok", "backend": API_URL})
    app.router.routes.append(Route("/healthz", _healthz, methods=["GET"]))

    if MCP_TOKEN:
        app.add_middleware(_BearerAuth)
        log.info("Bearer-token auth ENABLED")
    else:
        log.warning("INFORM_MCP_TOKEN not set — server is UNAUTHENTICATED")

    log.info("MCP endpoint: http://%s:%s/mcp", mcp.settings.host, mcp.settings.port)
    log.info("Health:       http://%s:%s/healthz", mcp.settings.host, mcp.settings.port)
    uvicorn.run(app, host=mcp.settings.host, port=mcp.settings.port, log_level="info")


if __name__ == "__main__":
    transport = os.getenv("INFORM_MCP_TRANSPORT", "stdio").lower()
    if transport in {"http", "streamable-http"}:
        _run_http()
    else:
        mcp.run()
