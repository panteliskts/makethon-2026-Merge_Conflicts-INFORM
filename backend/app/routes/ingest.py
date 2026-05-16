import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from ..config import settings
from ..services.chunker import extract_chunks
from ..services.embedder import ChromaEmbedder

router = APIRouter()
_embedder: ChromaEmbedder | None = None


def get_embedder() -> ChromaEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = ChromaEmbedder()
    return _embedder


@router.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    chunks = extract_chunks(str(dest), file.filename)
    if not chunks:
        raise HTTPException(status_code=422, detail="No text could be extracted from the PDF")

    embedder = get_embedder()
    embedder.delete_by_source(file.filename)
    embedder.embed_chunks(chunks)

    return {"source_file": file.filename, "chunk_count": len(chunks), "status": "ok"}


@router.get("/sources")
async def list_sources():
    return {"sources": get_embedder().list_sources()}
