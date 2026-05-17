"""
Ingest route — upload an invoice (PDF / JPG / PNG), embed its chunks,
and store everything in Supabase Postgres + Storage.

Happy-path flow
───────────────
1. Read file bytes, compute SHA-256.
2. Look up (tenant_id, file_hash) in documents table.
   → Hit:  return cached chunk count + fresh signed URL. No LLM/embed call.
   → Miss: continue.
3. Upload raw file to Supabase Storage.
4. Parse file into text chunks (PyMuPDF or Gemini Vision).
5. Embed chunks via Gemini (768-dim, RETRIEVAL_DOCUMENT task type).
6. Insert document row + chunk rows into Postgres.
7. Return {source_file, document_id, chunk_count, preview_url}.

Graceful degradation
─────────────────────
If SUPABASE_DB_URL or SUPABASE_URL are not set the route falls back to
the old local-disk behaviour so local development still works without
Supabase credentials.
"""

import hashlib
import time
import uuid
import anyio
from pathlib import Path
from urllib.parse import quote
from fastapi import APIRouter, UploadFile, File, HTTPException, Request

from ..config import settings
from ..services import embedder as emb_svc
from ..services.chunker import extract_chunks
from ..services.telemetry import record_event, record_exception
from ..services import database as db
from ..services import storage as store

router = APIRouter()

_ALLOWED_EXTS = {".pdf", ".jpg", ".jpeg", ".png"}


def _local_preview_url(request: Request, filename: str) -> str:
    return f"{request.base_url}uploads/{quote(filename, safe='')}"


def _tenant_email(request: Request) -> str:
    return request.headers.get("x-inform-user-email", "demo@inform.app")


def _verification_counts(chunks: list[dict]) -> dict:
    """Count chunks by cross-validation verification status.

    Returns a dict the frontend renders as the post-ingest breakdown:
      verified / model_only / gemini_only / disputed / ocr_block.
    """
    counts = {"verified": 0, "model_only": 0, "gemini_only": 0,
              "disputed": 0, "ocr_block": 0}
    for c in chunks:
        if c.get("source_type") == "ocr_block":
            counts["ocr_block"] += 1
        else:
            counts[c.get("verification", "model_only")] += 1
    return counts


@router.post("/ingest")
async def ingest(request: Request, file: UploadFile = File(...)):
    t0 = time.monotonic()

    # ── Validate file type ────────────────────────────────────────────────────
    filename = Path(file.filename or "").name
    file_ext = Path(filename).suffix.lower()
    if not filename or file_ext not in _ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, JPG, and PNG files are accepted",
        )

    file_bytes = await file.read()

    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_file_size_mb} MB size limit",
        )

    file_hash = hashlib.sha256(file_bytes).hexdigest()
    email = _tenant_email(request)

    # ── Supabase path ─────────────────────────────────────────────────────────
    if db.db_available():
        pool = db.get_pool()
        tenant_id = await db.get_or_create_tenant(pool, email)

        # ── Hash de-dupe ──────────────────────────────────────────────────────
        existing = await db.get_document_by_hash(pool, tenant_id, file_hash)
        if existing:
            preview_url = ""
            if store.storage_configured():
                try:
                    preview_url = await store.get_signed_url(existing["storage_path"])
                except Exception:
                    pass
            record_event(
                request, "ingest",
                f"Skipped re-embedding {filename} (hash unchanged)",
                status="ok",
                metadata={
                    "source_file": filename,
                    "document_id": str(existing["id"]),
                    "chunk_count": existing["chunk_count"],
                    "cache_hit": True,
                    "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                },
            )
            return {
                "source_file": filename,
                "document_id": str(existing["id"]),
                "chunk_count": existing["chunk_count"],
                "preview_url": preview_url,
                "status": "ok",
                "cached": True,
            }

        # ── Upload to Supabase Storage ─────────────────────────────────────────
        document_id = str(uuid.uuid4())
        storage_path = ""
        preview_url = ""

        if store.storage_configured():
            try:
                storage_path = await store.upload_file(
                    tenant_id, document_id, filename, file_bytes
                )
                preview_url = await store.get_signed_url(storage_path)
            except Exception as exc:
                record_exception(request, "ingest", "Storage upload failed", exc,
                                 metadata={"source_file": filename})
                # Non-fatal: continue without Storage URL

        # ── Write temp file for parsing, delete immediately after ────────────
        import tempfile, os as _os
        tmp_suffix = Path(filename).suffix.lower()
        with tempfile.NamedTemporaryFile(suffix=tmp_suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            chunks = await anyio.to_thread.run_sync(
                lambda: extract_chunks(tmp_path, filename)
            )
        except Exception as exc:
            record_exception(request, "ingest", "File parsing failed", exc,
                             metadata={"source_file": filename})
            raise HTTPException(status_code=422, detail=str(exc))
        finally:
            _os.unlink(tmp_path)  # always delete, even on parse failure

        if not chunks:
            raise HTTPException(
                status_code=422,
                detail="No text could be extracted from the file",
            )

        # ── Embed ─────────────────────────────────────────────────────────────
        try:
            texts = [c["text"] for c in chunks]
            embeddings = await emb_svc.embed(texts, task_type="RETRIEVAL_DOCUMENT")
        except Exception as exc:
            record_exception(request, "ingest", "Embedding failed", exc,
                             metadata={"source_file": filename, "chunk_count": len(chunks)})
            raise

        # ── Persist to Postgres ───────────────────────────────────────────────
        try:
            doc_id = await db.create_document(
                pool, tenant_id, filename, file_hash,
                storage_path, file_ext.lstrip("."), len(chunks),
            )
            await db.insert_chunks(pool, doc_id, tenant_id, chunks, embeddings)
        except Exception as exc:
            record_exception(request, "ingest", "DB write failed", exc,
                             metadata={"source_file": filename})
            raise

        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        record_event(
            request, "ingest", f"Indexed {filename}",
            status="ok",
            metadata={
                "source_file": filename,
                "document_id": doc_id,
                "chunk_count": len(chunks),
                "cache_hit": False,
                "latency_ms": latency_ms,
                **_verification_counts(chunks),
            },
        )
        return {
            "source_file": filename,
            "document_id": doc_id,
            "chunk_count": len(chunks),
            "preview_url": preview_url,
            "status": "ok",
            "cached": False,
            "verification": _verification_counts(chunks),
        }

    # ── Local fallback (no Supabase creds) ────────────────────────────────────
    import tempfile, os as _os
    tmp_suffix = Path(filename).suffix.lower()
    with tempfile.NamedTemporaryFile(suffix=tmp_suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        chunks = await anyio.to_thread.run_sync(
            lambda: extract_chunks(tmp_path, filename)
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        _os.unlink(tmp_path)

    if not chunks:
        raise HTTPException(status_code=422, detail="No text could be extracted")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    await anyio.to_thread.run_sync(
        lambda: (upload_dir / filename).write_bytes(file_bytes)
    )

    counts = _verification_counts(chunks)
    record_event(request, "ingest", f"Indexed {filename} (local mode)",
                 status="ok",
                 metadata={"source_file": filename, "chunk_count": len(chunks),
                           **counts})

    return {
        "source_file": filename,
        "document_id": None,
        "chunk_count": len(chunks),
        "preview_url": _local_preview_url(request, filename),
        "status": "ok",
        "cached": False,
        "verification": counts,
    }


@router.get("/sources")
async def list_sources():
    if db.db_available():
        pool = db.get_pool()
        if pool is not None:
            rows = await pool.fetch("SELECT DISTINCT filename FROM documents ORDER BY filename")
            return {"sources": [r["filename"] for r in rows]}
        # supabase-py path
        sb = db.get_sb()
        res = await sb.table("documents").select("filename").order("filename").execute()
        seen: set[str] = set()
        sources = []
        for r in res.data:
            if r["filename"] not in seen:
                seen.add(r["filename"])
                sources.append(r["filename"])
        return {"sources": sources}
    return {"sources": []}


@router.get("/chunks")
async def get_document_chunks(source_file: str, request: Request):
    if not db.db_available():
        return {"source_file": source_file, "chunks": []}

    pool = db.get_pool()
    email = _tenant_email(request)
    tenant_id = await db.get_or_create_tenant(pool, email)

    doc = await db.get_document_by_filename(pool, tenant_id, source_file)
    if not doc:
        return {"source_file": source_file, "chunks": []}

    rows = await db.get_chunks_for_document(pool, str(doc["id"]), tenant_id)
    return {
        "source_file": source_file,
        "chunks": [
            {
                "text": r["text"],
                "chunk_type": r["chunk_type"],
                "page_num": r["page_num"],
                "chunk_index": r["chunk_index"],
            }
            for r in rows
        ],
    }
