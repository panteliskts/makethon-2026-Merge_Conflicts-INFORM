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

import time
import httpx
from ..config import settings

_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta"
    f"/models/{{model}}:batchEmbedContents?key={{key}}"
)

# RRF constant — higher k = less aggressive ranking difference between hits
_RRF_K = 60


# ── Embedding API ─────────────────────────────────────────────────────────────

async def embed(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """
    Embed a batch of texts via Gemini, returning 768-dim vectors.
    task_type: "RETRIEVAL_DOCUMENT" for storage, "RETRIEVAL_QUERY" for queries.
    """
    url = _EMBED_URL.format(model=settings.gemini_embed_model, key=settings.gemini_api_key)
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
    async with httpx.AsyncClient(timeout=60) as client:
        for attempt in range(4):
            resp = await client.post(url, json=payload)
            if resp.status_code == 429:
                if attempt == 3:
                    resp.raise_for_status()
                time.sleep(delay)
                delay *= 2
                continue
            resp.raise_for_status()
            return [e["values"] for e in resp.json()["embeddings"]]

    raise RuntimeError("Embedding failed after retries")  # unreachable


def _vec_literal(embedding: list[float]) -> str:
    """Convert a float list to a Postgres vector literal '[x,y,z,...]'."""
    return "[" + ",".join(f"{v:.8f}" for v in embedding) + "]"


# ── Hybrid search (vector + full-text, RRF fusion) ────────────────────────────

async def hybrid_search(
    pool,
    query: str,
    tenant_id: str,
    document_id: str | None,
    top_k: int,
) -> list[dict]:
    """
    Combine vector similarity and Postgres full-text ranking via RRF.
    Returns up to *top_k* chunks ordered by fused score.
    """
    query_vec = (await embed([query], task_type="RETRIEVAL_QUERY"))[0]
    vec_literal = _vec_literal(query_vec)

    # $3 is nullable: NULL means "all documents for this tenant"
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
        LIMIT 20
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
        LIMIT 20
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
    )

    return [
        {
            "text":        row["text"],
            "chunk_type":  row["chunk_type"],
            "chunk_index": row["chunk_index"],
            "page_num":    row["page_num"],
            "x0": row["x0"], "y0": row["y0"],
            "x1": row["x1"], "y1": row["y1"],
            "source_file": row["source_file"],
            "document_id": row["document_id"],
            "score":       float(row["score"]),
            "vector_score": float(row["vector_score"]),
            # Legacy key — LLM service reads this for grounding check
            "distance":    1.0 - float(row["vector_score"]),
            "metadata": {
                "chunk_type":  row["chunk_type"],
                "chunk_index": row["chunk_index"],
                "page_num":    row["page_num"],
                "x0": row["x0"], "y0": row["y0"],
                "x1": row["x1"], "y1": row["y1"],
                "source_file": row["source_file"],
            },
        }
        for row in rows
    ]
