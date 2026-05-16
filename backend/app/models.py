from typing import Optional
from pydantic import BaseModel


class BoundingBox(BaseModel):
    page_num: int
    x0: float
    y0: float
    x1: float
    y1: float
    source_file: str
    chunk_type: str


class ChunkResult(BaseModel):
    text: str
    bbox: BoundingBox
    score: float
    chunk_index: int


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    source_file: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    chunks: list[ChunkResult]
    grounded: bool
    refused: bool


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    source_file: Optional[str] = None


class ChatResponse(BaseModel):
    message: str
    chunks: list[ChunkResult]
    grounded: bool
    refused: bool


class ReconcileResult(BaseModel):
    invoice_number: str
    amount: float
    date: str
    status: str
    bank_amount: Optional[float] = None


class MetricsResponse(BaseModel):
    total_queries: int
    grounded_count: int
    refused_count: int
    avg_latency_ms: float
