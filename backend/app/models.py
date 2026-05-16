from typing import Any, Optional
from pydantic import BaseModel, Field


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
    source_type: str = "ocr_block"
    confidence: float = 1.0
    entity: str = ""
    verification: str = "model_only"   # verified | model_only | gemini_only | disputed
    agreement: float = 0.0
    model_value: str = ""
    gemini_value: str = ""


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


class AdminEvent(BaseModel):
    id: str
    timestamp: str
    type: str
    status: str
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class AdminSession(BaseModel):
    id: str
    user_email: str
    user_name: str
    role: str
    status: str
    path: str
    user_agent: str
    active_source: Optional[str] = None
    first_seen: str
    last_seen: str
    request_count: int
    error_count: int
    events: list[AdminEvent]


class AdminSessionsResponse(BaseModel):
    generated_at: str
    uptime_seconds: float
    sessions: list[AdminSession]


class AdminCommandRequest(BaseModel):
    session_id: str
    command: str


class AdminCommandResponse(BaseModel):
    session_id: str
    command: str
    status: str
    generated_at: str
    output: list[str]
