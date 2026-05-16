"""
Embedding + retrieval layer backed by Postgres/pgvector.

Replaces the previous ChromaDB implementation.

Key design decisions
────────────────────
• Embeddings are 768-dimensional (Gemini gemini-embedding-001 with
  outputDimensionality=768) — small enough for HNSW indexing, large
  enough for invoice Q&A quality.
• Hybrid search: vector cosine + Postgres full-text, fused with RRF
  (k=60). This handles both semantic similarity AND exact matches for
  amounts, IBANs, invoice numbers, etc.
• All DB access takes an asyncpg.Pool argument — no module-level singletons.
• 429 backoff on the Gemini embed API (1→2→4→8 s, max 4 attempts).
"""

import asyncio
import httpx
from ..config import settings

_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta"
    f"/models/{{model}}:batchEmbedContents?key={{key}}"
)

# RRF constant — higher k = less aggressive ranking difference between hits
_RRF_K = 60


# ── Embedding API ─────────────────────────────────────────────────────────────

_MAX_EMBED_CHARS = 8_000  # Gemini per-item character limit
_MAX_BATCH_SIZE = 100    # Gemini batchEmbedContents hard cap


def _clean_texts(texts: list[str]) -> list[str]:
    """
    Sanitise texts before sending to the embedding API:
    - Replace empty/whitespace-only strings with a single space so the
      batch index alignment is preserved.
    - Truncate anything over the per-item character limit.
    - Strip NUL bytes and other control characters the API rejects.
    """
    cleaned = []
    for t in texts:
        t = t.replace("\x00", "").strip()
        if not t:
            t = " "  # placeholder keeps index alignment
        if len(t) > _MAX_EMBED_CHARS:
            t = t[:_MAX_EMBED_CHARS]
        cleaned.append(t)
    return cleaned


async def _embed_batch(client: httpx.AsyncClient, texts: list[str], task_type: str, url: str) -> list[list[float]]:
    """Send one batch (≤100 items) with retry on 429."""
    payload = {
        "requests": [
            {
                "model": f"models/{settings.gemini_embed_model}",
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
                "outputDimensionality": 768,
            }
            for t in texts
        ]
    }
    delay = 1.0
    for attempt in range(4):
        resp = await client.post(url, json=payload)
        if resp.status_code == 429:
            if attempt == 3:
                resp.raise_for_status()
            await asyncio.sleep(delay)
            delay *= 2
            continue
        if resp.status_code == 400:
            detail = resp.text[:500]
            raise ValueError(f"Gemini embedding API rejected the request (400): {detail}")
        resp.raise_for_status()
        return [e["values"] for e in resp.json()["embeddings"]]
    raise RuntimeError("Embedding failed after retries")


async def embed(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """
    Embed texts via Gemini in batches of up to 100 (API hard limit).
    task_type: "RETRIEVAL_DOCUMENT" for storage, "RETRIEVAL_QUERY" for queries.
    """
    if not texts:
        return []

    texts = _clean_texts(texts)
    url = _EMBED_URL.format(model=settings.gemini_embed_model, key=settings.gemini_api_key)

    results: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(texts), _MAX_BATCH_SIZE):
            batch = texts[i : i + _MAX_BATCH_SIZE]
            results.extend(await _embed_batch(client, batch, task_type, url))
    return results


def _vec_literal(embedding: list[float]) -> str:
    """Convert a float list to a Postgres vector literal '[x,y,z,...]'."""
    return "[" + ",".join(f"{v:.8f}" for v in embedding) + "]"


# ── Hybrid search (vector + full-text, RRF fusion) ────────────────────────────

async def hybrid_search(
    pool,  # asyncpg.Pool | None — None triggers supabase-py RPC path
    query: str,
    tenant_id: str,
    document_id: str | None,
    top_k: int,
    retrieve_k: int | None = None,
) -> list[dict]:
    """
    Combine vector similarity and Postgres full-text ranking via RRF.

    retrieve_k controls how many candidates are fetched from each index before
    fusion (defaults to settings.top_k_retrieve). The fused result is then
    trimmed to top_k. When a reranker is enabled the caller uses retrieve_k >
    top_k to get a larger pool, reranks, then slices to top_k.
    """
    from ..config import settings as _settings
    candidate_k = retrieve_k if retrieve_k is not None else _settings.top_k_retrieve

    query_vec = (await embed([query], task_type="RETRIEVAL_QUERY"))[0]
    vec_literal = _vec_literal(query_vec)

    # ── asyncpg path ──────────────────────────────────────────────────────────
    if pool is not None:
        sql = """
        WITH vector_hits AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    ORDER BY embedding <=> $1::vector
                ) AS rank
            FROM document_chunks
            WHERE tenant_id = $2::uuid
              AND ($3::uuid IS NULL OR document_id = $3::uuid)
            ORDER BY embedding <=> $1::vector
            LIMIT $7
        ),
        text_hits AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    ORDER BY ts_rank(search_vector, plainto_tsquery('english', $4)) DESC
                ) AS rank
            FROM document_chunks
            WHERE tenant_id = $2::uuid
              AND ($3::uuid IS NULL OR document_id = $3::uuid)
              AND search_vector @@ plainto_tsquery('english', $4)
            LIMIT $7
        ),
        rrf AS (
            SELECT
                COALESCE(v.id, t.id) AS id,
                COALESCE(1.0 / ($5 + v.rank), 0.0)
                  + COALESCE(1.0 / ($5 + t.rank), 0.0) AS score
            FROM vector_hits v
            FULL OUTER JOIN text_hits t ON v.id = t.id
        )
        SELECT
            dc.id::text,
            dc.chunk_index,
            dc.chunk_type,
            dc.text,
            dc.page_num,
            dc.x0, dc.y0, dc.x1, dc.y1,
            dc.document_id::text,
            d.filename        AS source_file,
            rrf.score,
            1.0 - (dc.embedding <=> $1::vector) AS vector_score
        FROM rrf
        JOIN document_chunks dc ON dc.id = rrf.id
        JOIN documents        d  ON d.id  = dc.document_id
        ORDER BY rrf.score DESC
        LIMIT $6
        """
        rows = await pool.fetch(
            sql,
            vec_literal,
            tenant_id,
            document_id,
            query,
            float(_RRF_K),
            top_k,
            candidate_k,
        )
        raw = [dict(r) for r in rows]

    # ── supabase-py RPC path (IPv4 fallback) ──────────────────────────────────
    else:
        from . import database as _db
        sb = _db.get_sb()
        if sb is None:
            return []
        resp = await sb.rpc("hybrid_search_chunks", {
            "p_embedding":   vec_literal,
            "p_query":       query,
            "p_tenant_id":   tenant_id,
            "p_document_id": document_id,
            "p_top_k":       top_k,
            "p_candidate_k": candidate_k,
        }).execute()
        # RPC returns column "txt" (renamed to avoid reserved word collision)
        raw = [
            {**r, "text": r.pop("txt", r.get("text", "")), "source_file": r.get("source_file", "")}
            for r in (resp.data or [])
        ]

    return [
        {
            "id":           row["id"],
            "text":         row["text"],
            "chunk_type":   row["chunk_type"],
            "chunk_index":  row["chunk_index"],
            "page_num":     row["page_num"],
            "x0": row["x0"], "y0": row["y0"],
            "x1": row["x1"], "y1": row["y1"],
            "source_file":  row.get("source_file", ""),
            "document_id":  row.get("document_id", ""),
            "score":        float(row["score"]),
            "vector_score": float(row["vector_score"]),
            "distance":     1.0 - float(row["vector_score"]),
            "metadata": {
                "chunk_type":  row["chunk_type"],
                "chunk_index": row["chunk_index"],
                "page_num":    row["page_num"],
                "x0": row["x0"], "y0": row["y0"],
                "x1": row["x1"], "y1": row["y1"],
                "source_file": row.get("source_file", ""),
            },
        }
        for row in raw
    ]
