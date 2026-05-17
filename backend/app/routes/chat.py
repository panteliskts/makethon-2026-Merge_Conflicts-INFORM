import time
from fastapi import APIRouter, Request
from ..models import ChatRequest, ChatResponse, ChunkResult, BoundingBox, Citation
from ..services import embedder as emb_svc
from ..services.llm import LLMService
from ..services.telemetry import record_event, record_exception
from ..services import database as db
from ..config import settings

router = APIRouter()
_llm: LLMService | None = None


def _get_llm() -> LLMService:
    global _llm
    if _llm is None:
        _llm = LLMService()
    return _llm


def _tenant_email(request: Request) -> str:
    return request.headers.get("x-inform-user-email", "demo@inform.app")


def _build_chunk_result(item: dict) -> ChunkResult:
    meta = item.get("metadata", item)
    return ChunkResult(
        text=item["text"],
        score=float(item.get("score", item.get("vector_score", 1.0))),
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


def _resolve_failure_mode(
    chunks: list[dict],
    refused: bool,
    grounded: bool,
) -> str | None:
    if not chunks or float(chunks[0].get("vector_score", 0)) < settings.score_threshold:
        return "retrieval"
    if refused or not grounded:
        return "grounding"
    return None


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest, request: Request):
    t0 = time.monotonic()

    user_messages = [m for m in req.messages if m.role == "user"]
    if not user_messages:
        return ChatResponse(
            message="No question provided.",
            chunks=[],
            grounded=False,
            refused=True,
            failure_mode="retrieval",
        )

    email = _tenant_email(request)

    # ── Resolve tenant + document_id ──────────────────────────────────────────
    pool = db.get_pool()
    tenant_id: str | None = None
    document_id: str | None = None

    if db.db_available():
        tenant_id = await db.get_or_create_tenant(pool, email)
        if req.source_file:
            doc = await db.get_document_by_filename(pool, tenant_id, req.source_file)
            if doc:
                document_id = str(doc["id"])

    # ── Hybrid retrieval ──────────────────────────────────────────────────────
    last_query = user_messages[-1].content
    top_k = settings.top_k

    try:
        if db.db_available():
            retrieve_k = settings.top_k_retrieve if settings.reranker_enabled else top_k
            chunks = await emb_svc.hybrid_search(
                pool, last_query, tenant_id, document_id, top_k,
                retrieve_k=retrieve_k,
            )
            if settings.reranker_enabled and len(chunks) > top_k:
                chunks = _get_llm().rerank(last_query, chunks, top_k)
        else:
            chunks = []

        messages_dicts = [{"role": m.role, "content": m.content} for m in req.messages]
        result = await _get_llm().generate_chat_answer(
            messages_dicts, chunks, source_file=req.source_file
        )
    except Exception as exc:
        record_exception(
            request, "chat",
            "Chat request failed before a response could be generated",
            exc,
            metadata={"source_file": req.source_file,
                       "latency_ms": round((time.monotonic() - t0) * 1000, 1)},
        )
        raise

    answer = result["answer"]
    refused = result["refused"]
    citations = result.get("citations", [])

    top_score = float(chunks[0].get("vector_score", 0)) if chunks else 0.0
    grounded = (
        not refused
        and bool(chunks)
        and top_score >= settings.score_threshold
    )
    failure_mode = _resolve_failure_mode(chunks, refused, grounded)
    latency_ms = (time.monotonic() - t0) * 1000

    # ── Persist messages to DB ────────────────────────────────────────────────
    if db.db_available() and tenant_id:
        chunk_ids = [c["id"] for c in chunks if "id" in c]
        try:
            await db.save_message(pool, tenant_id, document_id, "user", last_query)
            await db.save_message(
                pool, tenant_id, document_id, "assistant", answer,
                chunk_ids=chunk_ids or None,
                grounded=grounded,
                cached=result.get("cached", False),
                latency_ms=latency_ms,
            )
        except Exception:
            pass  # message persistence is non-fatal

    record_event(
        request, "chat",
        f"Assistant response generated with {len(chunks)} supporting chunks",
        status="ok" if grounded else "warning",
        metadata={
            "source_file": req.source_file,
            "grounded": grounded,
            "refused": refused,
            "failure_mode": failure_mode,
            "citation_count": len(citations),
            "cached": result.get("cached", False),
            "latency_ms": round(latency_ms, 1),
        },
    )

    return ChatResponse(
        message=answer,
        chunks=[_build_chunk_result(c) for c in chunks],
        grounded=grounded,
        refused=refused,
        failure_mode=failure_mode,
        citations=[Citation(**c) for c in citations if isinstance(c, dict)],
    )
