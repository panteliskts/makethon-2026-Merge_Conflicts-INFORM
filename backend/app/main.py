import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .services import database as db
from .services import telemetry
from .routes import admin, ingest, query, chat, reconcile, metrics

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    await db.init_pool()
    # Hydrate in-memory telemetry from Supabase so admin console survives restarts
    await telemetry.load_from_db()
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
