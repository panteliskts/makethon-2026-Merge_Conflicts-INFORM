from fastapi import APIRouter
from ..models import MetricsResponse
from .query import get_metrics

router = APIRouter()


@router.get("/metrics", response_model=MetricsResponse)
async def metrics_endpoint():
    m = get_metrics()
    total = m["total_queries"]
    avg_latency = m["total_latency_ms"] / total if total > 0 else 0.0
    return MetricsResponse(
        total_queries=total,
        grounded_count=m["grounded_count"],
        refused_count=m["refused_count"],
        avg_latency_ms=round(avg_latency, 1),
    )
