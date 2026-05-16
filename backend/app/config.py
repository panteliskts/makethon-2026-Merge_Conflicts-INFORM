from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Gemini
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    gemini_embed_model: str = "gemini-embedding-001"
    gemini_chat_model: str = "gemini-2.5-flash-lite"

    # Retrieval & generation
    max_tokens: int = 512
    top_k: int = 3
    top_k_retrieve: int = 20          # pre-rerank candidate pool size
    score_threshold: float = 0.35     # min vector_score to consider an answer grounded
    reranker_enabled: bool = False    # LLM reranker costs one extra API call per query

    # Safety & limits
    max_file_size_mb: int = 20
    max_history_tokens: int = 800     # token budget for conversation history window

    # Supabase – add these three to backend/.env
    # SUPABASE_URL=https://<ref>.supabase.co
    # SUPABASE_SERVICE_KEY=<service_role secret>
    # SUPABASE_DB_URL=postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_db_url: str = ""

    # Legacy (kept for temp-file writes during parsing; not served via StaticFiles)
    upload_dir: str = "./uploads"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    admin_api_token: str = ""


settings = Settings()
