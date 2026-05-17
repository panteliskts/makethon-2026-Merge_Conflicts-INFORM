"""
asyncpg connection pool + Supabase REST fallback.

Connection strategy (tried in order):
  1. asyncpg direct / pooler  — full SQL, used when SUPABASE_DB_URL resolves.
  2. supabase-py REST client  — HTTPS over IPv4, used when asyncpg can't connect.
     Requires SUPABASE_URL + SUPABASE_SERVICE_KEY.

Every public function accepts pool as its first argument (may be None on the
REST path) and routes are unchanged — db_available() + get_pool() still work.
"""

import logging
import urllib.parse
import asyncpg
from ..config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_sb = None  # supabase.AsyncClient, set when asyncpg is unavailable


# ── Initialisation ────────────────────────────────────────────────────────────

def _parse_db_url(url: str) -> dict:
    parsed = urllib.parse.urlparse(url)
    return {
        "host":     parsed.hostname,
        "port":     parsed.port or 5432,
        "user":     urllib.parse.unquote(parsed.username or ""),
        "password": urllib.parse.unquote(parsed.password or ""),
        "database": parsed.path.lstrip("/"),
    }


async def init_pool() -> None:
    global _pool, _sb

    # ── Try asyncpg first ─────────────────────────────────────────────────────
    if settings.supabase_db_url:
        try:
            _pool = await asyncpg.create_pool(
                **_parse_db_url(settings.supabase_db_url),
                min_size=2,
                max_size=10,
                command_timeout=30,
            )
            logger.info("asyncpg pool initialised")
            return
        except (OSError, ValueError, asyncpg.PostgresError) as exc:
            _pool = None
            logger.warning("asyncpg failed (%s) — falling back to Supabase REST.", exc)

    # ── Fall back to supabase-py (HTTPS, IPv4-compatible) ────────────────────
    if settings.supabase_url and settings.supabase_service_key:
        try:
            from supabase import AsyncClient, acreate_client  # type: ignore
            _sb = await acreate_client(settings.supabase_url, settings.supabase_service_key)
            logger.info("Supabase REST client initialised (IPv4 fallback)")
        except Exception as exc:
            _sb = None
            logger.warning("Supabase REST client failed: %s — running local-only.", exc)
    else:
        logger.warning("No DB credentials — running local-only (no persistence).")


async def close_pool() -> None:
    global _pool, _sb
    if _pool:
        await _pool.close()
        _pool = None
    if _sb:
        try:
            await _sb.aclose()
        except Exception:
            pass
        _sb = None


def get_pool() -> asyncpg.Pool | None:
    return _pool


def get_sb():
    return _sb


def db_available() -> bool:
    return _pool is not None or _sb is not None


# ── Tenant helpers ────────────────────────────────────────────────────────────

async def get_or_create_tenant(pool: asyncpg.Pool | None, email: str) -> str:
    if pool is not None:
        row = await pool.fetchrow(
            """
            INSERT INTO tenants (email)
            VALUES ($1)
            ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
            RETURNING id
            """,
            email,
        )
        return str(row["id"])

    res = await _sb.table("tenants").upsert({"email": email}, on_conflict="email").execute()
    return str(res.data[0]["id"])


# ── Document helpers ──────────────────────────────────────────────────────────

async def get_document_by_hash(
    pool: asyncpg.Pool | None, tenant_id: str, file_hash: str
) -> dict | None:
    if pool is not None:
        return await pool.fetchrow(
            "SELECT id, filename, storage_path, chunk_count FROM documents "
            "WHERE tenant_id = $1 AND file_hash = $2",
            tenant_id, file_hash,
        )

    res = (
        await _sb.table("documents")
        .select("id, filename, storage_path, chunk_count")
        .eq("tenant_id", tenant_id)
        .eq("file_hash", file_hash)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def get_document_by_filename(
    pool: asyncpg.Pool | None, tenant_id: str, filename: str
) -> dict | None:
    if pool is not None:
        return await pool.fetchrow(
            "SELECT id, filename, storage_path FROM documents "
            "WHERE tenant_id = $1 AND filename = $2 ORDER BY created_at DESC LIMIT 1",
            tenant_id, filename,
        )

    res = (
        await _sb.table("documents")
        .select("id, filename, storage_path")
        .eq("tenant_id", tenant_id)
        .eq("filename", filename)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def create_document(
    pool: asyncpg.Pool | None,
    tenant_id: str,
    filename: str,
    file_hash: str,
    storage_path: str,
    file_type: str,
    chunk_count: int,
) -> str:
    if pool is not None:
        row = await pool.fetchrow(
            """
            INSERT INTO documents (tenant_id, filename, file_hash, storage_path, file_type, chunk_count)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            tenant_id, filename, file_hash, storage_path, file_type, chunk_count,
        )
        return str(row["id"])

    res = await _sb.table("documents").insert({
        "tenant_id":    tenant_id,
        "filename":     filename,
        "file_hash":    file_hash,
        "storage_path": storage_path,
        "file_type":    file_type,
        "chunk_count":  chunk_count,
    }).execute()
    return str(res.data[0]["id"])


_META_KEYS = ("source_type", "entity", "confidence", "verification",
              "agreement", "model_value", "gemini_value")


def _extraction_meta(c: dict) -> dict:
    """Pick the cross-validation fields off a chunk into a JSONB-friendly dict."""
    out: dict = {}
    for k in _META_KEYS:
        if k in c and c[k] is not None and c[k] != "":
            out[k] = c[k]
    return out


async def insert_chunks(
    pool: asyncpg.Pool | None,
    document_id: str,
    tenant_id: str,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> None:
    if pool is not None:
        import json as _json
        records = [
            (
                document_id, tenant_id,
                c["chunk_index"], c["chunk_type"], c["text"],
                c["page_num"],
                float(c.get("x0", 0)), float(c.get("y0", 0)),
                float(c.get("x1", 0)), float(c.get("y1", 0)),
                "[" + ",".join(f"{v:.8f}" for v in emb) + "]",
                _json.dumps(_extraction_meta(c)),
            )
            for c, emb in zip(chunks, embeddings)
        ]
        await pool.executemany(
            """
            INSERT INTO document_chunks
              (document_id, tenant_id, chunk_index, chunk_type, text,
               page_num, x0, y0, x1, y1, embedding, extraction_meta)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12::jsonb)
            """,
            records,
        )
        return

    # supabase-py: pass embedding as vector literal — PostgREST casts it
    rows = [
        {
            "document_id": document_id,
            "tenant_id":   tenant_id,
            "chunk_index": c["chunk_index"],
            "chunk_type":  c["chunk_type"],
            "text":        c["text"],
            "page_num":    c["page_num"],
            "x0": float(c.get("x0", 0)), "y0": float(c.get("y0", 0)),
            "x1": float(c.get("x1", 0)), "y1": float(c.get("y1", 0)),
            "embedding":   "[" + ",".join(f"{v:.8f}" for v in emb) + "]",
            "extraction_meta": _extraction_meta(c),
        }
        for c, emb in zip(chunks, embeddings)
    ]
    batch = 500
    for i in range(0, len(rows), batch):
        await _sb.table("document_chunks").insert(rows[i : i + batch]).execute()


async def delete_chunks_for_document(pool: asyncpg.Pool | None, document_id: str) -> None:
    if pool is not None:
        await pool.execute("DELETE FROM document_chunks WHERE document_id = $1", document_id)
        return
    await _sb.table("document_chunks").delete().eq("document_id", document_id).execute()


async def get_chunks_for_document(
    pool: asyncpg.Pool | None, document_id: str, tenant_id: str
) -> list:
    if pool is not None:
        return await pool.fetch(
            """
            SELECT id, chunk_index, chunk_type, text, page_num, x0, y0, x1, y1
            FROM   document_chunks
            WHERE  document_id = $1 AND tenant_id = $2
            ORDER  BY chunk_index
            """,
            document_id, tenant_id,
        )

    res = (
        await _sb.table("document_chunks")
        .select("id, chunk_index, chunk_type, text, page_num, x0, y0, x1, y1")
        .eq("document_id", document_id)
        .eq("tenant_id", tenant_id)
        .order("chunk_index")
        .execute()
    )
    return res.data


# ── Chat helpers ──────────────────────────────────────────────────────────────

async def save_message(
    pool: asyncpg.Pool | None,
    tenant_id: str,
    document_id: str | None,
    role: str,
    content: str,
    chunk_ids: list[str] | None = None,
    grounded: bool | None = None,
    cached: bool = False,
    latency_ms: float | None = None,
) -> None:
    if pool is not None:
        await pool.execute(
            """
            INSERT INTO chat_messages
              (tenant_id, document_id, role, content, chunk_ids, grounded, cached, latency_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            tenant_id, document_id, role, content, chunk_ids, grounded, cached, latency_ms,
        )
        return

    await _sb.table("chat_messages").insert({
        "tenant_id":   tenant_id,
        "document_id": document_id,
        "role":        role,
        "content":     content,
        "chunk_ids":   chunk_ids,
        "grounded":    grounded,
        "cached":      cached,
        "latency_ms":  latency_ms,
    }).execute()


# ── Session telemetry helpers ─────────────────────────────────────────────────

async def upsert_session(pool: asyncpg.Pool | None, session: dict) -> None:
    row = {
        "id":            session["id"],
        "user_email":    session["user_email"],
        "user_name":     session["user_name"],
        "role":          session["role"],
        "path":          session.get("path"),
        "user_agent":    session.get("user_agent"),
        "active_source": session.get("active_source"),
        "last_seen":     session["last_seen"],
        "request_count": session["request_count"],
        "error_count":   session["error_count"],
    }
    if pool is not None:
        await pool.execute(
            """
            INSERT INTO sessions
              (id, user_email, user_name, role, path, user_agent,
               active_source, last_seen, request_count, error_count)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (id) DO UPDATE SET
              user_email    = EXCLUDED.user_email,
              user_name     = EXCLUDED.user_name,
              role          = EXCLUDED.role,
              path          = EXCLUDED.path,
              user_agent    = EXCLUDED.user_agent,
              active_source = EXCLUDED.active_source,
              last_seen     = EXCLUDED.last_seen,
              request_count = EXCLUDED.request_count,
              error_count   = EXCLUDED.error_count
            """,
            row["id"], row["user_email"], row["user_name"], row["role"],
            row["path"], row["user_agent"], row["active_source"],
            row["last_seen"], row["request_count"], row["error_count"],
        )
        return
    if _sb:
        await _sb.table("sessions").upsert(row, on_conflict="id").execute()


async def insert_session_event(pool: asyncpg.Pool | None, event: dict, session_id: str) -> None:
    row = {
        "id":         event["id"],
        "session_id": session_id,
        "event_type": event["type"],
        "status":     event["status"],
        "message":    event["message"],
        "metadata":   event.get("metadata", {}),
    }
    if pool is not None:
        await pool.execute(
            """
            INSERT INTO session_events (id, session_id, event_type, status, message, metadata)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb)
            ON CONFLICT (id) DO NOTHING
            """,
            row["id"], row["session_id"], row["event_type"],
            row["status"], row["message"], __import__("json").dumps(row["metadata"]),
        )
        return
    if _sb:
        await _sb.table("session_events").upsert(row, on_conflict="id").execute()


async def load_sessions(pool: asyncpg.Pool | None) -> list[dict]:
    """Load recent sessions + their latest events from DB on startup."""
    if pool is not None:
        rows = await pool.fetch(
            "SELECT * FROM sessions ORDER BY last_seen DESC LIMIT 200"
        )
        sessions = [dict(r) for r in rows]
        for s in sessions:
            ev_rows = await pool.fetch(
                "SELECT * FROM session_events WHERE session_id=$1 ORDER BY created_at DESC LIMIT 80",
                s["id"],
            )
            s["events"] = [
                {"id": r["id"], "timestamp": r["created_at"].isoformat(),
                 "type": r["event_type"], "status": r["status"],
                 "message": r["message"], "metadata": dict(r["metadata"])}
                for r in ev_rows
            ]
        return sessions
    if _sb:
        res = await _sb.table("sessions").select("*").order("last_seen", desc=True).limit(200).execute()
        sessions = list(res.data or [])
        for s in sessions:
            ev_res = (
                await _sb.table("session_events")
                .select("*")
                .eq("session_id", s["id"])
                .order("created_at", desc=True)
                .limit(80)
                .execute()
            )
            s["events"] = [
                {"id": r["id"], "timestamp": r["created_at"],
                 "type": r["event_type"], "status": r["status"],
                 "message": r["message"], "metadata": r.get("metadata", {})}
                for r in (ev_res.data or [])
            ]
        return sessions
    return []


# ── LLM cache helpers ─────────────────────────────────────────────────────────

async def get_llm_cache(pool: asyncpg.Pool | None, key: str) -> dict | None:
    if pool is not None:
        row = await pool.fetchrow(
            "SELECT answer, refused, citations FROM llm_cache WHERE cache_key=$1", key
        )
        if row:
            await pool.execute(
                "UPDATE llm_cache SET last_used=now() WHERE cache_key=$1", key
            )
            return {"answer": row["answer"], "refused": row["refused"],
                    "citations": list(row["citations"])}
        return None
    if _sb:
        res = await _sb.table("llm_cache").select("answer,refused,citations").eq("cache_key", key).maybeSingle().execute()
        if res.data:
            await _sb.table("llm_cache").update({"last_used": "now()"}).eq("cache_key", key).execute()
            return res.data
    return None


async def set_llm_cache(pool: asyncpg.Pool | None, key: str, answer: str, refused: bool, citations: list) -> None:
    if pool is not None:
        await pool.execute(
            """
            INSERT INTO llm_cache (cache_key, answer, refused, citations)
            VALUES ($1,$2,$3,$4::jsonb)
            ON CONFLICT (cache_key) DO UPDATE SET
              answer=EXCLUDED.answer, refused=EXCLUDED.refused,
              citations=EXCLUDED.citations, last_used=now()
            """,
            key, answer, refused, __import__("json").dumps(citations),
        )
        return
    if _sb:
        await _sb.table("llm_cache").upsert(
            {"cache_key": key, "answer": answer, "refused": refused, "citations": citations},
            on_conflict="cache_key",
        ).execute()


# ── Usage stat helpers ────────────────────────────────────────────────────────

async def increment_stats(pool: asyncpg.Pool | None, **counters: int) -> None:
    """Atomically increment one or more usage_stats rows."""
    for key, amount in counters.items():
        if amount == 0:
            continue
        if pool is not None:
            await pool.execute("SELECT public.increment_stat($1,$2)", key, amount)
        elif _sb:
            await _sb.rpc("increment_stat", {"p_key": key, "p_amount": amount}).execute()


async def get_usage_stats_from_db(pool: asyncpg.Pool | None) -> dict:
    if pool is not None:
        rows = await pool.fetch("SELECT stat_key, value FROM public.usage_stats")
        return {r["stat_key"]: int(r["value"]) for r in rows}
    if _sb:
        res = await _sb.table("usage_stats").select("stat_key,value").execute()
        return {r["stat_key"]: int(r["value"]) for r in (res.data or [])}
    return {}
