"""
Supabase Storage client built on httpx.

Bucket name: "invoices" (create once in the Supabase dashboard – Storage → New bucket).
Storage paths follow the pattern: {tenant_id}/{document_id}/{filename}

All methods are async and safe to call from FastAPI async routes.
"""

import mimetypes
import httpx
from ..config import settings

_BUCKET = "invoices"


def _storage_base() -> str:
    return f"{settings.supabase_url.rstrip('/')}/storage/v1"


def _auth_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "apikey": settings.supabase_service_key,
    }


def _content_type(filename: str) -> str:
    ct, _ = mimetypes.guess_type(filename)
    return ct or "application/octet-stream"


async def upload_file(
    tenant_id: str,
    document_id: str,
    filename: str,
    content: bytes,
) -> str:
    """
    Upload *content* to Supabase Storage.
    Returns the storage path (not a full URL).
    """
    path = f"{tenant_id}/{document_id}/{filename}"
    url = f"{_storage_base()}/object/{_BUCKET}/{path}"
    headers = {**_auth_headers(), "Content-Type": _content_type(filename)}

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, content=content, headers=headers)
        if resp.status_code == 409:
            # Object already exists (duplicate document_id is not expected,
            # but safe to treat as success).
            return path
        resp.raise_for_status()

    return path


async def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """
    Return a short-lived signed URL for *storage_path*.
    The URL is valid for *expires_in* seconds (default 1 hour).
    """
    url = f"{_storage_base()}/object/sign/{_BUCKET}/{storage_path}"
    headers = {**_auth_headers(), "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json={"expiresIn": expires_in}, headers=headers)
        resp.raise_for_status()
        signed_path = resp.json()["signedURL"]

    # signedURL is a relative path like /storage/v1/object/sign/...?token=...
    return f"{settings.supabase_url.rstrip('/')}{signed_path}"


def storage_configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_key)
