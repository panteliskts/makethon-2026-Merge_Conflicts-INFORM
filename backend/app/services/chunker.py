import base64
import re
from pathlib import Path

import fitz  # PyMuPDF

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}

_CURRENCY_RE = re.compile(r"[€$£]\s*[\d,]+\.?\d*|[\d,]+\.?\d*\s*[€$£]")
_TOTAL_KEYWORDS = {"total", "subtotal", "grand total", "σύνολο", "σύνολα", "amount due", "balance due"}
_PAYMENT_KEYWORDS = {"payment", "bank", "iban", "swift", "bic", "wire", "transfer", "πληρωμή", "τράπεζα"}


def _classify_block(text: str, block_index: int, total_blocks: int) -> str:
    lower = text.lower()
    if any(kw in lower for kw in _PAYMENT_KEYWORDS):
        return "payment_terms"
    if any(kw in lower for kw in _TOTAL_KEYWORDS):
        return "totals"
    if _CURRENCY_RE.search(text):
        return "line_item"
    if block_index < 3:
        return "header"
    if block_index >= total_blocks - 2:
        return "totals"
    return "header"


def _extract_chunks_from_pdf(pdf_path: str, source_file: str) -> list[dict]:
    chunks = []
    chunk_index = 0

    doc = fitz.open(pdf_path)
    for page_num, page in enumerate(doc):
        page_dict = page.get_text("dict")
        blocks = page_dict.get("blocks", [])
        text_blocks = [b for b in blocks if b.get("type") == 0]
        total = len(text_blocks)

        for block_idx, block in enumerate(text_blocks):
            lines = block.get("lines", [])
            text = " ".join(
                span["text"]
                for line in lines
                for span in line.get("spans", [])
            ).strip()

            if not text:
                continue

            bbox = block["bbox"]
            chunk_type = _classify_block(text, block_idx, total)

            chunks.append({
                "text": text,
                "page_num": page_num,
                "x0": bbox[0],
                "y0": bbox[1],
                "x1": bbox[2],
                "y1": bbox[3],
                "source_file": source_file,
                "chunk_type": chunk_type,
                "chunk_index": chunk_index,
            })
            chunk_index += 1

    doc.close()
    return chunks


def _extract_chunks_from_image(image_path: str, source_file: str) -> list[dict]:
    from openai import OpenAI
    from PIL import Image as PILImage
    from ..config import settings

    ext = Path(image_path).suffix.lower().lstrip(".")
    mime = "image/png" if ext == "png" else "image/jpeg"

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    with PILImage.open(image_path) as img:
        width, height = img.size

    client = OpenAI(api_key=settings.gemini_api_key, base_url=settings.gemini_base_url)
    resp = client.chat.completions.create(
        model=settings.gemini_chat_model,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                },
                {
                    "type": "text",
                    "text": (
                        "Extract all text from this invoice image. "
                        "Return each distinct text block on its own line. "
                        "Preserve numbers, dates, amounts, and labels exactly. "
                        "Do not add explanations or markdown formatting."
                    ),
                },
            ],
        }],
        max_tokens=2048,
    )

    raw = resp.choices[0].message.content or ""
    lines = [line.strip() for line in raw.split("\n") if line.strip()]

    chunks = []
    for i, text in enumerate(lines):
        chunk_type = _classify_block(text, i, len(lines))
        chunks.append({
            "text": text,
            "page_num": 0,
            "x0": 0.0,
            "y0": 0.0,
            "x1": float(width),
            "y1": float(height),
            "source_file": source_file,
            "chunk_type": chunk_type,
            "chunk_index": i,
        })

    return chunks


def extract_chunks(file_path: str, source_file: str) -> list[dict]:
    if Path(file_path).suffix.lower() in IMAGE_EXTS:
        return _extract_chunks_from_image(file_path, source_file)
    return _extract_chunks_from_pdf(file_path, source_file)
