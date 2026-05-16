from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    chroma_persist_dir: str = "./chroma_db"
    upload_dir: str = "./uploads"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    admin_api_token: str = ""

    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    gemini_embed_model: str = "gemini-embedding-001"
    gemini_chat_model: str = "gemini-2.0-flash"

    # LayoutLMv3 invoice extractor
    layoutlm_model_dir: str = "./models/layoutlmv3-invoice"
    pdf_render_dpi: int = 200
    extractor_confidence_threshold: float = 0.60

    # Cross-validation at ingest: 1 extra Gemini call per page to verify the
    # model's structured fields. Best-effort: failures fall back to model-only.
    cross_validate_ingest: bool = True
    cross_validate_fuzzy_threshold: float = 0.80


settings = Settings()
