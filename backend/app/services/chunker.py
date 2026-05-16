import re
from pathlib import Path
import fitz  # PyMuPDF


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


def extract_chunks(pdf_path: str, source_file: str) -> list[dict]:
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

            bbox = block["bbox"]  # (x0, y0, x1, y1)
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
