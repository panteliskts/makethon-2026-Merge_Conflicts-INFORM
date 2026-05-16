from fastapi import APIRouter
from ..models import ChatRequest, ChatResponse, ChunkResult, BoundingBox
from ..services.embedder import ChromaEmbedder
from ..services.llm import LLMService

router = APIRouter()

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


def _build_chunk_result(item: dict) -> ChunkResult:
    meta = item["metadata"]
    return ChunkResult(
        text=item["text"],
        score=1.0 - float(item["distance"]),
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


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    user_messages = [m for m in req.messages if m.role == "user"]
    if not user_messages:
        return ChatResponse(message="No question provided.", chunks=[], grounded=False, refused=True)

    last_query = user_messages[-1].content
    where = {"source_file": req.source_file} if req.source_file else None
    chunks = _get_embedder().query(last_query, n_results=5, where=where)

    messages_dicts = [{"role": m.role, "content": m.content} for m in req.messages]
    result = _get_llm().generate_chat_answer(messages_dicts, chunks)

    answer = result["answer"]
    refused = result["refused"]
    grounded = not refused

    return ChatResponse(
        message=answer,
        chunks=[_build_chunk_result(c) for c in chunks],
        grounded=grounded,
        refused=refused,
    )
