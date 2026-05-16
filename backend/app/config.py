from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    chroma_persist_dir: str = "./chroma_db"
    upload_dir: str = "./uploads"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    gemini_embed_model: str = "text-embedding-004"
    gemini_chat_model: str = "gemini-2.0-flash"


settings = Settings()
