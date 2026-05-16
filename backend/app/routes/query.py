import time
from fastapi import APIRouter, Request
from ..config import settings
from ..models import QueryRequest, QueryResponse, ChunkResult, BoundingBox
from ..services import embedder as emb_svc
from ..services.llm import LLMService, _REFUSAL
from ..services.telemetry import record_event, record_exception
from ..services import database as db

router = APIRouter()

_metrics = {
    "total_queries": 0,
    "grounded_count": 0,
    "refused_count": 0,
    "total_latency_ms": 0.0,
}

_llm: LLMService | None = None
_SCORE_THRESHOLD = 0.35


def _get_llm() -> LLMService:
    global _llm
    if _llm is None:
        _llm = LLMService()
    return _llm


def get_metrics() -> dict:
    return _metrics.copy()


def _tenant_email(request: Request) -> str:
    return request.headers.get("x-inform-user-email", "demo@inform.app")


def _build_chunk_result(item: dict) -> ChunkResult:
    meta = item.get("metadata", item)
    return ChunkResult(
        text=item["text"],
        score=float(item.get("score", item.get("vector_score", 1.0))),
        chunk_index=int(meta.get("chunk_index", 0)),
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


def _local_grounding_check(answer: str, chunks: list[dict]) -> bool:
    if not chunks:
        return False
    top_score = float(chunks[0].get("vector_score", 0.0))
    if top_score < _SCORE_THRESHOLD:
        return False
    return _REFUSAL not in answer


@router.post("/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest, request: Request):
    t0 = time.monotonic()
    top_k = min(req.top_k, settings.top_k)
    email = _tenant_email(request)

    tenant_id: str | None = None
    document_id: str | None = None

    if db.db_available():
        pool = db.get_pool()
        tenant_id = await db.get_or_create_tenant(pool, email)
        if req.source_file:
            doc = await db.get_document_by_filename(pool, tenant_id, req.source_file)
            if doc:
                document_id = str(doc["id"])

    try:
        if db.db_available():
            chunks = await emb_svc.hybrid_search(
                pool, req.query, tenant_id, document_id, top_k
            )
        else:
            chunks = []

        result = _get_llm().generate_answer(
            req.query, chunks, source_file=req.source_file
        )
        answer = result["answer"]
        refused = result["refused"]
        grounded = _local_grounding_check(answer, chunks)

    except Exception as exc:
        record_exception(
            request, "query", "Query failed", exc,
            metadata={"source_file": req.source_file,
                       "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                       "top_k": top_k},
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
        request, "query",
        f"Query completed with {len(chunks)} retrieved chunks",
        status="ok" if grounded else "warning",
        metadata={
            "source_file": req.source_file,
            "grounded": grounded,
            "refused": refused,
            "cached": result.get("cached", False),
            "latency_ms": round(latency_ms, 1),
            "top_k": top_k,
        },
    )

    return QueryResponse(
        answer=answer,
        chunks=[_build_chunk_result(c) for c in chunks],
        grounded=grounded,
        refused=refused,
    )
