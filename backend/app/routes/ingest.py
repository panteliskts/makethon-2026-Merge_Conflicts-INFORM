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


def get_embedder() -> ChromaEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = ChromaEmbedder()
    return _embedder


_ALLOWED_EXTS = {".pdf", ".jpg", ".jpeg", ".png"}


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

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename

    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as exc:
        record_exception(
            request,
            "ingest",
            "Upload failed while saving the PDF",
            exc,
            metadata={
                "source_file": file.filename,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        raise

    try:
        chunks = extract_chunks(str(dest), file.filename)
    except Exception as exc:
        record_exception(
            request,
            "ingest",
            "PDF parsing failed during upload",
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

    embedder = get_embedder()
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
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        },
    )

    return {"source_file": file.filename, "chunk_count": len(chunks), "status": "ok"}


@router.get("/sources")
async def list_sources():
    return {"sources": get_embedder().list_sources()}
