import time
from fastapi import APIRouter, Request
from ..models import QueryRequest, QueryResponse, ChunkResult, BoundingBox
from ..services.embedder import ChromaEmbedder
from ..services.llm import LLMService
from ..services.telemetry import record_event, record_exception

router = APIRouter()

_metrics = {
    "total_queries": 0,
    "grounded_count": 0,
    "refused_count": 0,
    "total_latency_ms": 0.0,
}

_embedder: ChromaEmbedder | None = None
_llm: LLMService | None = None


def _get_embedder() -> ChromaEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = ChromaEmbedder()
    return _embedder


def _get_llm() -> LLMService:
    global _llm
    if _llm is None:
        _llm = LLMService()
    return _llm


def get_metrics() -> dict:
    return _metrics.copy()


def _build_chunk_result(item: dict) -> ChunkResult:
    meta = item["metadata"]
    return ChunkResult(
        text=item["text"],
        score=1.0 - float(item["distance"]),
        chunk_index=int(meta.get("chunk_index", 0)),
        source_type=str(meta.get("source_type", "ocr_block")),
        confidence=float(meta.get("confidence", 1.0)),
        entity=str(meta.get("entity", "")),
        verification=str(meta.get("verification", "model_only")),
        agreement=float(meta.get("agreement", 0.0)),
        model_value=str(meta.get("model_value", "")),
        gemini_value=str(meta.get("gemini_value", "")),
        bbox=BoundingBox(
            page_num=int(meta.get("page_num", 0)),
            x0=float(meta.get("x0", 0)),
            y0=float(meta.get("y0", 0)),
            x1=float(meta.get("x1", 0)),
            y1=float(meta.get("y1", 0)),
            source_file=str(meta.get("source_file", "")),
            chunk_type=str(meta.get("chunk_type", "header")),
        ),
    )


@router.post("/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest, request: Request):
    t0 = time.monotonic()

    where = {"source_file": req.source_file} if req.source_file else None

    try:
        chunks = _get_embedder().query(req.query, n_results=req.top_k, where=where)
        result = _get_llm().generate_answer(req.query, chunks)
        answer = result["answer"]
        refused = result["refused"]
        grounded = not refused

        if not refused:
            grounded = _get_llm().self_check(answer, chunks)
    except Exception as exc:
        record_exception(
            request,
            "query",
            "Query failed before grounding could complete",
            exc,
            metadata={
                "source_file": req.source_file,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "top_k": req.top_k,
            },
        )
        raise

    latency_ms = (time.monotonic() - t0) * 1000
    _metrics["total_queries"] += 1
    _metrics["total_latency_ms"] += latency_ms
    if grounded:
        _metrics["grounded_count"] += 1
    if refused:
        _metrics["refused_count"] += 1

    record_event(
        request,
        "query",
        f"Query completed with {len(chunks)} retrieved chunks",
        status="ok" if grounded else "warning",
        metadata={
            "source_file": req.source_file,
            "grounded": grounded,
            "refused": refused,
            "latency_ms": round(latency_ms, 1),
            "top_k": req.top_k,
        },
    )

    return QueryResponse(
        answer=answer,
        chunks=[_build_chunk_result(c) for c in chunks],
        grounded=grounded,
        refused=refused,
    )
