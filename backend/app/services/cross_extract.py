"""Cross-validation extractor: ask Gemini to extract the same invoice schema
the LayoutLMv3 token classifier produces, so per-field outputs can be compared.

The system trusts a field most when *both* sources agree. This catches the
nasty failure mode where the model is 99.9% confident but wrong (we saw this
on COMPANY/ADDRESS in the HQ eval).

This module is best-effort: any failure (quota, network, malformed JSON)
returns ``None`` and the rest of the pipeline falls back to model-only.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from typing import Optional

from PIL import Image

from ..config import settings

logger = logging.getLogger(__name__)

_PROMPT = """You are extracting structured fields from an invoice or receipt image.

Return ONLY a JSON object with these exact keys (use the empty string "" when
a field is not present). Numbers must be plain digits, no currency symbols.

  company       — seller / merchant name (NOT the customer)
  invoice_no    — invoice number or receipt id
  date          — invoice or transaction date as printed
  address       — seller's address
  subtotal      — subtotal amount
  tax           — tax / VAT amount
  total         — final total amount due
  items         — list of objects: description, quantity, total_price

Output strict JSON only, no prose, no code fences.
"""

_GEMINI_TO_MODEL = {
    "company": "COMPANY",
    "invoice_no": "INVOICE_NO",
    "date": "DATE",
    "address": "ADDRESS",
    "subtotal": "SUBTOTAL",
    "tax": "TAX",
    "total": "TOTAL",
}


def _client():
    from openai import OpenAI
    return OpenAI(api_key=settings.gemini_api_key, base_url=settings.gemini_base_url)


def _image_to_b64(image) -> str:
    if isinstance(image, Image.Image):
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=88)
        return base64.b64encode(buf.getvalue()).decode()
    # path-like
    with open(image, "rb") as f:
        return base64.b64encode(f.read()).decode()


def _parse_json(raw: str) -> dict | None:
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def gemini_extract(image, *, max_tokens: int = 600) -> Optional[dict]:
    """Run one Gemini call. Returns dict in our canonical schema, or None.

    Canonical schema:
      {
        "fields": {COMPANY: str, INVOICE_NO: str, DATE: str, ADDRESS: str,
                   SUBTOTAL: str, TAX: str, TOTAL: str},
        "items":  [{"name": str, "qty": str, "price": str}, ...]
      }
    """
    if not settings.gemini_api_key:
        logger.info("cross_extract: GEMINI_API_KEY missing; skipping")
        return None
    try:
        b64 = _image_to_b64(image)
        resp = _client().chat.completions.create(
            model=settings.gemini_chat_model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": _PROMPT},
                ],
            }],
            temperature=0,
            max_tokens=max_tokens,
        )
        raw = resp.choices[0].message.content or ""
    except Exception as exc:
        # Quota / network / API — keep the pipeline going on model-only.
        logger.warning("cross_extract: Gemini call failed (%s); falling back",
                       exc.__class__.__name__)
        return None

    g = _parse_json(raw)
    if not isinstance(g, dict):
        logger.warning("cross_extract: Gemini returned non-JSON; ignoring")
        return None

    fields: dict[str, str] = {}
    for g_key, m_key in _GEMINI_TO_MODEL.items():
        v = g.get(g_key, "")
        if v is None:
            v = ""
        fields[m_key] = str(v).strip()

    items_raw = g.get("items") or []
    items: list[dict] = []
    if isinstance(items_raw, list):
        for it in items_raw:
            if not isinstance(it, dict):
                continue
            items.append({
                "name": str(it.get("description") or "").strip(),
                "qty": str(it.get("quantity") or "").strip(),
                "price": str(it.get("total_price") or it.get("unit_price") or "").strip(),
            })

    return {"fields": fields, "items": items}


# ---- comparison helpers ----

_AMOUNT_RE = re.compile(r"-?\d[\d.,]*")
_NUMERIC_FIELDS = {"SUBTOTAL", "TAX", "TOTAL"}


def _all_amounts(s: str) -> list[float]:
    if not s:
        return []
    s = s.replace(" ", "").replace("$", "").replace("€", "").replace("£", "")
    out: list[float] = []
    for m in _AMOUNT_RE.finditer(s):
        tok = m.group(0)
        if re.match(r"^-?\d{1,3}(?:\.\d{3})+,\d+$", tok):
            tok = tok.replace(".", "").replace(",", ".")
        else:
            tok = tok.replace(",", "")
        try:
            out.append(float(tok))
        except ValueError:
            pass
    return out


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s.,/-]", "", s)
    return s


def _fuzzy(a: str, b: str) -> float:
    from difflib import SequenceMatcher
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def compare_field(label: str, model_val: str, gemini_val: str,
                  fuzzy_threshold: float = 0.8) -> tuple[bool, float]:
    """Return (agree, agreement_score) for one field."""
    model_val = (model_val or "").strip()
    gemini_val = (gemini_val or "").strip()
    if not model_val or not gemini_val:
        return False, 0.0
    if label in _NUMERIC_FIELDS:
        ms = _all_amounts(model_val)
        gs = _all_amounts(gemini_val)
        if not ms or not gs:
            return False, 0.0
        for m in ms:
            for g in gs:
                if abs(m - g) <= 0.5:
                    return True, 1.0
        return False, 0.0
    if label == "DATE":
        mp = re.sub(r"\D", "", model_val)
        gp = re.sub(r"\D", "", gemini_val)
        if not mp or not gp:
            return False, 0.0
        if mp == gp or mp in gp or gp in mp:
            return True, 1.0
        return False, 0.0
    if label == "INVOICE_NO":
        mp = re.sub(r"\W", "", model_val).lower()
        gp = re.sub(r"\W", "", gemini_val).lower()
        if not mp or not gp:
            return False, 0.0
        if mp == gp:
            return True, 1.0
        if mp in gp or gp in mp:
            return True, 0.9
        return False, 0.0
    # COMPANY / ADDRESS / fallback text fields
    s = _fuzzy(model_val, gemini_val)
    return s >= fuzzy_threshold, s
