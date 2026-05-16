"""
asyncpg connection pool + tenant helpers.

Every query that touches tenant-owned rows must receive a `tenant_id`
and include it as an explicit WHERE clause — this is the primary isolation
mechanism when the backend connects with the Postgres service-role user.
"""

import logging
import asyncpg
from ..config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    if not settings.supabase_db_url:
        logger.warning("SUPABASE_DB_URL not set — DB features disabled")
        return
    _pool = await asyncpg.create_pool(
        settings.supabase_db_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
        # Supabase requires SSL; asyncpg enables it by default for remote hosts.
    )
    logger.info("asyncpg pool initialised")


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — check SUPABASE_DB_URL")
    return _pool


def db_available() -> bool:
    return _pool is not None


# ── Tenant helpers ────────────────────────────────────────────────────────────

async def get_or_create_tenant(pool: asyncpg.Pool, email: str) -> str:
    """Return the tenant UUID for an email, creating the row if absent."""
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


async def get_document_by_hash(
    pool: asyncpg.Pool, tenant_id: str, file_hash: str
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, filename, storage_path, chunk_count FROM documents WHERE tenant_id = $1 AND file_hash = $2",
        tenant_id,
        file_hash,
    )


async def get_document_by_filename(
    pool: asyncpg.Pool, tenant_id: str, filename: str
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, filename, storage_path FROM documents WHERE tenant_id = $1 AND filename = $2 ORDER BY created_at DESC LIMIT 1",
        tenant_id,
        filename,
    )


async def create_document(
    pool: asyncpg.Pool,
    tenant_id: str,
    filename: str,
    file_hash: str,
    storage_path: str,
    file_type: str,
    chunk_count: int,
) -> str:
    row = await pool.fetchrow(
        """
        INSERT INTO documents (tenant_id, filename, file_hash, storage_path, file_type, chunk_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        """,
        tenant_id,
        filename,
        file_hash,
        storage_path,
        file_type,
        chunk_count,
    )
    return str(row["id"])


async def insert_chunks(
    pool: asyncpg.Pool,
    document_id: str,
    tenant_id: str,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> None:
    """Bulk-insert document chunks with their embeddings."""
    records = [
        (
            document_id,
            tenant_id,
            c["chunk_index"],
            c["chunk_type"],
            c["text"],
            c["page_num"],
            float(c.get("x0", 0)),
            float(c.get("y0", 0)),
            float(c.get("x1", 0)),
            float(c.get("y1", 0)),
            # Pass embedding as Postgres vector literal string
            "[" + ",".join(f"{v:.8f}" for v in emb) + "]",
        )
        for c, emb in zip(chunks, embeddings)
    ]
    await pool.executemany(
        """
        INSERT INTO document_chunks
          (document_id, tenant_id, chunk_index, chunk_type, text,
           page_num, x0, y0, x1, y1, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
        """,
        records,
    )


async def delete_chunks_for_document(pool: asyncpg.Pool, document_id: str) -> None:
    await pool.execute(
        "DELETE FROM document_chunks WHERE document_id = $1", document_id
    )


async def get_chunks_for_document(
    pool: asyncpg.Pool, document_id: str, tenant_id: str
) -> list[asyncpg.Record]:
    """Pure local lookup — no embedding API call needed."""
    return await pool.fetch(
        """
        SELECT id, chunk_index, chunk_type, text, page_num, x0, y0, x1, y1
        FROM   document_chunks
        WHERE  document_id = $1 AND tenant_id = $2
        ORDER  BY chunk_index
        """,
        document_id,
        tenant_id,
    )


async def save_message(
    pool: asyncpg.Pool,
    tenant_id: str,
    document_id: str | None,
    role: str,
    content: str,
    chunk_ids: list[str] | None = None,
    grounded: bool | None = None,
    cached: bool = False,
    latency_ms: float | None = None,
) -> None:
    await pool.execute(
        """
        INSERT INTO chat_messages
          (tenant_id, document_id, role, content, chunk_ids, grounded, cached, latency_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        tenant_id,
        document_id,
        role,
        content,
        chunk_ids,
        grounded,
        cached,
        latency_ms,
    )
