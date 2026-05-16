import hashlib
import shutil
import time
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Request
from ..config import settings
from ..services.chunker import extract_chunks
from ..services.embedder import ChromaEmbedder
from ..services.telemetry import record_event, record_exception

router = APIRouter()
_embedder: ChromaEmbedder | None = None

_ALLOWED_EXTS = {".pdf", ".jpg", ".jpeg", ".png"}


def get_embedder() -> ChromaEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = ChromaEmbedder()
    return _embedder


@router.post("/ingest")
async def ingest(request: Request, file: UploadFile = File(...)):
    t0 = time.monotonic()
    file_ext = Path(file.filename).suffix.lower() if file.filename else ""
    if not file.filename or file_ext not in _ALLOWED_EXTS:
        record_event(
            request,
            "ingest",
            "Upload rejected because the file type is not supported",
            status="error",
            metadata={"filename": file.filename},
        )
        raise HTTPException(status_code=400, detail="Only PDF, JPG, and PNG files are accepted")

    file_bytes = await file.read()
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    embedder = get_embedder()

    # ── Hash de-dupe: skip re-embedding if file content hasn't changed ──────────
    stored_hash = embedder.source_hash(file.filename)
    if stored_hash == file_hash:
        chunk_count = len(embedder.get_by_source(file.filename))
        record_event(
            request,
            "ingest",
            f"Skipped re-embedding {file.filename} (hash unchanged)",
            status="ok",
            metadata={
                "source_file": file.filename,
                "chunk_count": chunk_count,
                "cache_hit": True,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        return {"source_file": file.filename, "chunk_count": chunk_count, "status": "ok", "cached": True}

    # ── Save file ────────────────────────────────────────────────────────────────
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename

    try:
        with dest.open("wb") as f:
            f.write(file_bytes)
    except Exception as exc:
        record_exception(
            request,
            "ingest",
            "Upload failed while saving the file",
            exc,
            metadata={
                "source_file": file.filename,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        raise

    # ── Extract chunks ───────────────────────────────────────────────────────────
    try:
        chunks = extract_chunks(str(dest), file.filename)
    except Exception as exc:
        record_exception(
            request,
            "ingest",
            "File parsing failed during upload",
            exc,
            metadata={
                "source_file": file.filename,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        raise

    if not chunks:
        record_event(
            request,
            "ingest",
            "Upload rejected because no text could be extracted",
            status="error",
            metadata={"source_file": file.filename},
        )
        raise HTTPException(status_code=422, detail="No text could be extracted from the file")

    # Stamp the file hash onto every chunk so we can check it later.
    for chunk in chunks:
        chunk["file_hash"] = file_hash

    # ── Embed ────────────────────────────────────────────────────────────────────
    try:
        embedder.delete_by_source(file.filename)
        embedder.embed_chunks(chunks)
    except Exception as exc:
        record_exception(
            request,
            "ingest",
            "Vector indexing failed during upload",
            exc,
            metadata={
                "source_file": file.filename,
                "chunk_count": len(chunks),
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        raise

    record_event(
        request,
        "ingest",
        f"Indexed {file.filename}",
        status="ok",
        metadata={
            "source_file": file.filename,
            "chunk_count": len(chunks),
            "cache_hit": False,
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        },
    )

    return {"source_file": file.filename, "chunk_count": len(chunks), "status": "ok", "cached": False}


@router.get("/sources")
async def list_sources():
    return {"sources": get_embedder().list_sources()}


@router.get("/chunks")
async def get_document_chunks(source_file: str):
    chunks = get_embedder().get_by_source(source_file)
    return {
        "source_file": source_file,
        "chunks": [
            {
                "text": c["text"],
                "chunk_type": c["metadata"].get("chunk_type", "header"),
                "page_num": int(c["metadata"].get("page_num", 0)),
                "chunk_index": int(c["metadata"].get("chunk_index", 0)),
            }
            for c in sorted(chunks, key=lambda x: int(x["metadata"].get("chunk_index", 0)))
        ],
    }
