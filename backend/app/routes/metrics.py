from fastapi import APIRouter
from ..models import MetricsResponse
from ..services import database as db
from ..services.llm import get_usage_stats

router = APIRouter()

_RPD_LIMIT = 1500
_CONTEXT_WINDOW_DISPLAY_LIMIT = 32_768


@router.get("/metrics", response_model=MetricsResponse)
async def metrics_endpoint():
    pool = db.get_pool()
    if db.db_available():
        # Derive query metrics directly from the persistent chat_messages table
        try:
            if pool is not None:
                row = await pool.fetchrow(
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE role='user')                AS total_queries,
                      COUNT(*) FILTER (WHERE role='assistant' AND grounded)  AS grounded_count,
                      COUNT(*) FILTER (WHERE role='assistant' AND NOT COALESCE(grounded,false) AND NOT COALESCE(cached,false)) AS refused_count,
                      AVG(latency_ms) FILTER (WHERE role='assistant')    AS avg_latency
                    FROM chat_messages
                    """
                )
                return MetricsResponse(
                    total_queries=row["total_queries"] or 0,
                    grounded_count=row["grounded_count"] or 0,
                    refused_count=row["refused_count"] or 0,
                    avg_latency_ms=round(float(row["avg_latency"] or 0), 1),
                )
            else:
                # REST fallback — count from chat_messages
                sb = db.get_sb()
                res = await sb.table("chat_messages").select("role,grounded,cached,latency_ms").execute()
                rows = res.data or []
                user_rows = [r for r in rows if r["role"] == "user"]
                asst_rows = [r for r in rows if r["role"] == "assistant"]
                grounded = sum(1 for r in asst_rows if r.get("grounded"))
                refused = sum(1 for r in asst_rows if not r.get("grounded") and not r.get("cached"))
                latencies = [r["latency_ms"] for r in asst_rows if r.get("latency_ms")]
                avg_lat = sum(latencies) / len(latencies) if latencies else 0.0
                return MetricsResponse(
                    total_queries=len(user_rows),
                    grounded_count=grounded,
                    refused_count=refused,
                    avg_latency_ms=round(avg_lat, 1),
                )
        except Exception:
            pass  # fall through to in-memory fallback

    # In-memory fallback (no DB)
    stats = get_usage_stats()
    total = stats["cache_hits"] + stats["cache_misses"]
    return MetricsResponse(
        total_queries=total,
        grounded_count=0,
        refused_count=0,
        avg_latency_ms=0.0,
    )


@router.get("/usage")
async def usage_endpoint():
    # Prefer DB counters so stats survive restarts
    db_stats: dict = {}
    if db.db_available():
        try:
            db_stats = await db.get_usage_stats_from_db(db.get_pool())
        except Exception:
            pass

    mem_stats = get_usage_stats()

    # DB values are the source of truth; fall back to in-memory if DB not available
    def val(key: str) -> int:
        return db_stats.get(key, mem_stats.get(key, 0))

    cache_hits   = val("cache_hits")
    cache_misses = val("cache_misses")
    total_requests = cache_hits + cache_misses
    cache_hit_rate = round(cache_hits / total_requests * 100, 1) if total_requests > 0 else 0.0

    return {
        "total_requests":      total_requests,
        "cache_hits":          cache_hits,
        "cache_misses":        cache_misses,
        "cache_hit_rate_pct":  cache_hit_rate,
        "cache_size":          mem_stats.get("cache_size", 0),
        "total_input_tokens":  val("total_input_tokens"),
        "total_output_tokens": val("total_output_tokens"),
        "rate_limit_hits":     val("rate_limit_hits"),
        "context_window_limit": _CONTEXT_WINDOW_DISPLAY_LIMIT,
        "requests_per_day_limit": _RPD_LIMIT,
    }
