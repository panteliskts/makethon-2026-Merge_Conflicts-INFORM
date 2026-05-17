import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .services import database as db
from .routes import admin, ingest, query, chat, reconcile, metrics

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    # Temp upload dir (used for parsing before upload to Supabase Storage)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)

    # Postgres connection pool
    if settings.supabase_db_url:
        await db.init_pool()
    else:
        logger.warning(
            "SUPABASE_DB_URL not set — running in local-only mode (no persistence)"
        )

    # Pre-load the LayoutLMv3 invoice extractor (best-effort: if it fails the
    # ingest path falls back to OCR-only chunks via the chunker's safe wrapper).
    try:
        from .services import inference
        inference.load_model(settings.layoutlm_model_dir)
    except Exception as exc:
        logger.warning(
            "LayoutLMv3 model failed to load at startup (will retry on first ingest): %s",
            exc,
        )

    logger.info("INFORM Invoice Intelligence API ready")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await db.close_pool()


def _cors_origins() -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]


app = FastAPI(
    title="INFORM Invoice Intelligence API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router,    prefix="/api")
app.include_router(query.router,     prefix="/api")
app.include_router(chat.router,      prefix="/api")
app.include_router(reconcile.router, prefix="/api")
app.include_router(metrics.router,   prefix="/api")
app.include_router(admin.router,     prefix="/api")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "db": "connected" if db.db_available() else "unavailable",
    }


# Serve locally-written temp files in dev / local-only mode.
# In production these are served from Supabase Storage via signed URLs.
_uploads_path = Path(settings.upload_dir)
_uploads_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_path)), name="uploads")
