"""Hybrid invoice chunker.

Per page we run:
  1. LayoutLMv3 invoice extractor (Tesseract OCR + token classifier) — emits
     high-confidence structured field/line-item chunks ("extracted").
  2. Raw OCR/PyMuPDF text blocks — emits fallback text chunks for long-tail
     fields the classifier does not know about ("ocr_block").

Both share the same coordinate system (PDF points for PDFs, image pixels for
JPG/PNG) so the frontend overlay can highlight either kind.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from ..config import settings
from . import inference, cross_extract

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}

_CURRENCY_RE = re.compile(r"[€$£]\s*[\d,]+\.?\d*|[\d,]+\.?\d*\s*[€$£]")
_TOTAL_KEYWORDS = {"total", "subtotal", "grand total", "σύνολο", "σύνολα", "amount due", "balance due"}
_PAYMENT_KEYWORDS = {"payment", "bank", "iban", "swift", "bic", "wire", "transfer", "πληρωμή", "τράπεζα"}

# Map of LayoutLMv3 entity labels -> human chunk_type used for retrieval boosts and UI labels.
_FIELD_CHUNK_TYPE = {
    "COMPANY": "vendor",
    "DATE": "date",
    "ADDRESS": "address",
    "INVOICE_NO": "invoice_no",
    "SUBTOTAL": "subtotal",
    "TAX": "tax",
    "TOTAL": "totals",
}


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


def _safe_extract(image: Image.Image) -> dict | None:
    try:
        return inference.extract_invoice(image, model_dir=settings.layoutlm_model_dir)
    except Exception as exc:
        logger.warning("LayoutLMv3 extraction failed: %s", exc)
        return None


def _scale_box(box, sx: float, sy: float):
    return [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy]


def _extracted_chunks_from_image(
    image: Image.Image,
    page_num: int,
    source_file: str,
    next_index: int,
    sx: float = 1.0,
    sy: float = 1.0,
) -> tuple[list[dict], int]:
    """Run LayoutLMv3 + (optionally) Gemini cross-validation on an image.

    Each extracted field is tagged with one of four verification states so the
    downstream system knows how much to trust it:

      verified     — model and Gemini agree (strongest signal)
      model_only   — model predicted; Gemini didn't (or was disabled)
      gemini_only  — Gemini found a field the model missed
      disputed     — both predicted, they disagree (lowest trust)

    sx/sy convert pixel boxes back to the target coord system (PDF points for
    PDFs). For raw images they default to 1.0.
    """
    model_result = _safe_extract(image)
    if not model_result:
        model_result = {"fields": {}, "field_boxes": {}, "field_scores": {},
                        "line_items": []}

    gem = None
    if settings.cross_validate_ingest:
        gem = cross_extract.gemini_extract(image)
        if gem:
            logger.info("cross_extract: page %d got %d gemini fields, %d items",
                        page_num, sum(1 for v in gem["fields"].values() if v),
                        len(gem["items"]))

    threshold = settings.extractor_confidence_threshold
    fuzzy = settings.cross_validate_fuzzy_threshold
    chunks: list[dict] = []

    # ---- scalar fields ----
    model_fields = {k: v for k, v in model_result["fields"].items()
                    if model_result["field_scores"].get(k, 0.0) >= threshold}
    gem_fields = (gem or {}).get("fields", {}) or {}

    all_field_keys = set(model_fields) | {k for k, v in gem_fields.items() if v}
    for entity in all_field_keys:
        m_val = model_fields.get(entity, "")
        g_val = gem_fields.get(entity, "")
        score = float(model_result["field_scores"].get(entity, 0.0))
        box = model_result["field_boxes"].get(entity)

        if m_val and g_val:
            agree, sim = cross_extract.compare_field(entity, m_val, g_val, fuzzy)
            verification = "verified" if agree else "disputed"
            text_val = m_val if agree else f"{m_val}  ⟂  {g_val}"
            agreement = sim
            confidence = 1.0 if agree else min(score, 0.5)
        elif m_val:
            verification = "model_only"
            text_val = m_val
            agreement = 0.0
            confidence = score
        else:  # g_val only
            verification = "gemini_only"
            text_val = g_val
            agreement = 0.0
            confidence = 0.75  # Gemini-only is a lower trust default
            box = None  # no pixel evidence

        x0 = y0 = x1 = y1 = 0.0
        if box:
            x0, y0, x1, y1 = _scale_box(box, sx, sy)

        label = entity.replace("_", " ").title()
        chunks.append({
            "text": f"{label}: {text_val}",
            "page_num": page_num,
            "x0": float(x0), "y0": float(y0),
            "x1": float(x1), "y1": float(y1),
            "source_file": source_file,
            "chunk_type": _FIELD_CHUNK_TYPE.get(entity, "extracted"),
            "chunk_index": next_index,
            "source_type": "extracted",
            "entity": entity,
            "confidence": float(confidence),
            "verification": verification,
            "agreement": float(agreement),
            "model_value": m_val,
            "gemini_value": g_val,
        })
        next_index += 1

    # ---- line items: pair model items to gemini items by fuzzy name match ----
    model_items = [it for it in model_result["line_items"]
                   if it.get("name_score", 0.0) >= threshold
                   and it.get("name", "").strip()]
    gem_items = (gem or {}).get("items", []) or []

    from difflib import SequenceMatcher
    used_g = set()
    for mi in model_items:
        # find best matching gemini item
        best_j, best_s = -1, 0.0
        for j, gi in enumerate(gem_items):
            if j in used_g:
                continue
            s = SequenceMatcher(None, (mi.get("name", "") or "").lower(),
                                (gi.get("name", "") or "").lower()).ratio()
            if s > best_s:
                best_s, best_j = s, j

        m_name = mi.get("name", "")
        m_qty = mi.get("qty", "")
        m_price = mi.get("price", "")
        score = float(mi.get("name_score", 0.0))

        g_name = g_qty = g_price = ""
        if best_j >= 0 and best_s >= fuzzy:
            used_g.add(best_j)
            g_name = gem_items[best_j]["name"]
            g_qty = gem_items[best_j]["qty"]
            g_price = gem_items[best_j]["price"]

        # the model is weak on qty/price; fill from Gemini when available
        qty = m_qty or g_qty
        price = m_price or g_price
        if g_name:
            verification = "verified"
            confidence = 1.0
            agreement = best_s
        else:
            verification = "model_only"
            confidence = score
            agreement = 0.0

        parts = [f"Item: {m_name}"]
        if qty:
            parts.append(f"qty: {qty}")
        if price:
            parts.append(f"price: {price}")
        text = " | ".join(parts)

        x0, y0, x1, y1 = _scale_box(mi["box"], sx, sy)
        chunks.append({
            "text": text,
            "page_num": page_num,
            "x0": float(x0), "y0": float(y0),
            "x1": float(x1), "y1": float(y1),
            "source_file": source_file,
            "chunk_type": "line_item",
            "chunk_index": next_index,
            "source_type": "extracted",
            "entity": "ITEM",
            "confidence": float(confidence),
            "verification": verification,
            "agreement": float(agreement),
            "model_value": f"{m_name} | {m_qty} | {m_price}",
            "gemini_value": f"{g_name} | {g_qty} | {g_price}" if g_name else "",
        })
        next_index += 1

    # ---- gemini-only items (model missed them entirely) ----
    for j, gi in enumerate(gem_items):
        if j in used_g:
            continue
        name = (gi.get("name") or "").strip()
        if not name:
            continue
        parts = [f"Item: {name}"]
        if gi.get("qty"):
            parts.append(f"qty: {gi['qty']}")
        if gi.get("price"):
            parts.append(f"price: {gi['price']}")
        chunks.append({
            "text": " | ".join(parts),
            "page_num": page_num,
            "x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0,
            "source_file": source_file,
            "chunk_type": "line_item",
            "chunk_index": next_index,
            "source_type": "extracted",
            "entity": "ITEM",
            "confidence": 0.75,
            "verification": "gemini_only",
            "agreement": 0.0,
            "model_value": "",
            "gemini_value": " | ".join([name, gi.get("qty", ""), gi.get("price", "")]),
        })
        next_index += 1

    return chunks, next_index


def _extract_chunks_from_pdf(pdf_path: str, source_file: str) -> list[dict]:
    chunks: list[dict] = []
    chunk_index = 0

    doc = fitz.open(pdf_path)
    dpi = settings.pdf_render_dpi
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    for page_num, page in enumerate(doc):
        # 1. PyMuPDF text blocks (PDF point coords already)
        page_dict = page.get_text("dict")
        text_blocks = [b for b in page_dict.get("blocks", []) if b.get("type") == 0]
        total = len(text_blocks)
        for block_idx, block in enumerate(text_blocks):
            text = " ".join(
                span["text"]
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            ).strip()
            if not text:
                continue
            bbox = block["bbox"]
            chunks.append({
                "text": text,
                "page_num": page_num,
                "x0": float(bbox[0]), "y0": float(bbox[1]),
                "x1": float(bbox[2]), "y1": float(bbox[3]),
                "source_file": source_file,
                "chunk_type": _classify_block(text, block_idx, total),
                "chunk_index": chunk_index,
                "source_type": "ocr_block",
                "confidence": 1.0,
            })
            chunk_index += 1

        # 2. LayoutLMv3 extraction on the rasterized page.
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        # convert pixel boxes back to PDF points so the frontend overlay aligns
        extracted, chunk_index = _extracted_chunks_from_image(
            img, page_num, source_file, chunk_index, sx=1 / zoom, sy=1 / zoom,
        )
        chunks.extend(extracted)

    doc.close()
    return chunks


def _extract_chunks_from_image(image_path: str, source_file: str) -> list[dict]:
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    chunks: list[dict] = []
    chunk_index = 0

    extracted, chunk_index = _extracted_chunks_from_image(
        image, 0, source_file, chunk_index, sx=1.0, sy=1.0,
    )
    chunks.extend(extracted)

    # Tesseract line-level fallback: group OCR words into rough text lines so
    # questions about uncovered fields still hit retrieval.
    try:
        import pytesseract
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
        lines: dict[tuple, dict] = {}
        n = len(data["text"])
        for i in range(n):
            txt = data["text"][i].strip()
            if not txt or int(data["conf"][i]) <= 0:
                continue
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            x = data["left"][i]; y = data["top"][i]
            x1 = x + data["width"][i]; y1 = y + data["height"][i]
            entry = lines.setdefault(key, {"words": [], "x0": x, "y0": y, "x1": x1, "y1": y1})
            entry["words"].append(txt)
            entry["x0"] = min(entry["x0"], x)
            entry["y0"] = min(entry["y0"], y)
            entry["x1"] = max(entry["x1"], x1)
            entry["y1"] = max(entry["y1"], y1)
        ordered = sorted(lines.values(), key=lambda e: (e["y0"], e["x0"]))
        total = len(ordered)
        for i, entry in enumerate(ordered):
            text = " ".join(entry["words"]).strip()
            if not text:
                continue
            chunks.append({
                "text": text,
                "page_num": 0,
                "x0": float(entry["x0"]), "y0": float(entry["y0"]),
                "x1": float(entry["x1"]), "y1": float(entry["y1"]),
                "source_file": source_file,
                "chunk_type": _classify_block(text, i, total),
                "chunk_index": chunk_index,
                "source_type": "ocr_block",
                "confidence": 1.0,
            })
            chunk_index += 1
    except Exception as exc:
        logger.warning("Tesseract line fallback failed: %s", exc)
        # last-ditch: one chunk for the whole page so retrieval still has something
        chunks.append({
            "text": "(no OCR text available)",
            "page_num": 0,
            "x0": 0.0, "y0": 0.0,
            "x1": float(width), "y1": float(height),
            "source_file": source_file,
            "chunk_type": "header",
            "chunk_index": chunk_index,
            "source_type": "ocr_block",
            "confidence": 0.0,
        })

    return chunks


def extract_chunks(file_path: str, source_file: str) -> list[dict]:
    if Path(file_path).suffix.lower() in IMAGE_EXTS:
        return _extract_chunks_from_image(file_path, source_file)
    return _extract_chunks_from_pdf(file_path, source_file)
