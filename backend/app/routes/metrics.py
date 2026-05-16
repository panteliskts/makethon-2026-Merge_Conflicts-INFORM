from fastapi import APIRouter
from ..models import MetricsResponse
from .query import get_metrics
from ..services.llm import get_usage_stats

router = APIRouter()

# Flash-lite preview quota as a practical demo ceiling (RPD).
_RPD_LIMIT = 1500


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


@router.get("/usage")
async def usage_endpoint():
    stats = get_usage_stats()
    total_requests = stats["cache_hits"] + stats["cache_misses"]
    cache_hit_rate = (
        round(stats["cache_hits"] / total_requests * 100, 1) if total_requests > 0 else 0.0
    )
    # Rough token estimate: flash-lite context window is 1M but we cap display at 32k.
    estimated_prompt_tokens = stats["total_input_tokens"]
    estimated_output_tokens = stats["total_output_tokens"]
    context_window_limit = 32_768  # display ceiling for the UI bar

    return {
        "total_requests": total_requests,
        "cache_hits": stats["cache_hits"],
        "cache_misses": stats["cache_misses"],
        "cache_hit_rate_pct": cache_hit_rate,
        "cache_size": stats["cache_size"],
        "total_input_tokens": estimated_prompt_tokens,
        "total_output_tokens": estimated_output_tokens,
        "rate_limit_hits": stats["rate_limit_hits"],
        "context_window_limit": context_window_limit,
        "requests_per_day_limit": _RPD_LIMIT,
    }
