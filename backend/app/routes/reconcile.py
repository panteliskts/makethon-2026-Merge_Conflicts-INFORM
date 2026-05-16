import io
import re
from datetime import datetime, timedelta
from fastapi import APIRouter, UploadFile, File, Form
from typing import Optional
import pandas as pd
from ..models import ReconcileResult
from ..services.embedder import ChromaEmbedder

router = APIRouter()

_embedder: ChromaEmbedder | None = None


def _get_embedder() -> ChromaEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = ChromaEmbedder()
    return _embedder


_AMOUNT_RE = re.compile(r"[\d,]+\.?\d*")
_INV_NUM_RE = re.compile(r"(?:invoice|inv|#|no\.?)\s*:?\s*([A-Z0-9\-]+)", re.IGNORECASE)


def _parse_amount(text: str) -> Optional[float]:
    clean = text.replace(",", "").replace("€", "").replace("$", "").replace("£", "").strip()
    m = _AMOUNT_RE.search(clean)
    if m:
        try:
            return float(m.group())
        except ValueError:
            return None
    return None


def _extract_invoice_info(chunks: list[dict]) -> list[dict]:
    invoices = []
    for c in chunks:
        meta = c.get("metadata", {})
        text = c.get("text", "")
        if meta.get("chunk_type") in ("totals", "line_item"):
            amount = _parse_amount(text)
            inv_match = _INV_NUM_RE.search(text)
            inv_num = inv_match.group(1) if inv_match else meta.get("source_file", "unknown")
            if amount:
                invoices.append({
                    "invoice_number": inv_num,
                    "amount": amount,
                    "source_file": meta.get("source_file", ""),
                    "chunk_type": meta.get("chunk_type", ""),
                })
    return invoices


@router.post("/reconcile")
async def reconcile(
    bank_statement: UploadFile = File(...),
    invoice: Optional[UploadFile] = File(None),
    source_file: Optional[str] = Form(None),
):
    csv_bytes = await bank_statement.read()
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception:
        df = pd.read_csv(io.BytesIO(csv_bytes), sep=";")

    df.columns = [c.lower().strip() for c in df.columns]

    col_map = {}
    for col in df.columns:
        if "amount" in col or "betrag" in col or "ποσό" in col:
            col_map["amount"] = col
        elif "date" in col or "datum" in col or "ημερομηνία" in col:
            col_map["date"] = col
        elif "desc" in col or "reference" in col or "narration" in col or "περιγραφή" in col:
            col_map["description"] = col

    if "amount" not in col_map:
        col_map["amount"] = df.columns[2] if len(df.columns) > 2 else df.columns[0]
    if "date" not in col_map:
        col_map["date"] = df.columns[0]

    bank_rows = []
    for _, row in df.iterrows():
        try:
            amount = float(str(row[col_map["amount"]]).replace(",", "").replace("€", "").strip())
            date_str = str(row[col_map["date"]]).strip()
            bank_rows.append({"amount": amount, "date": date_str})
        except (ValueError, KeyError):
            continue

    where = {"source_file": source_file} if source_file else None
    raw_chunks = _get_embedder().query("total amount invoice", n_results=20, where=where)
    invoice_items = _extract_invoice_info(raw_chunks)

    if not invoice_items:
        return []

    results = []
    tolerance = 0.05

    for item in invoice_items:
        inv_amount = item["amount"]
        matched_bank = None
        status = "UNPAID"

        for bank_row in bank_rows:
            bank_amount = bank_row["amount"]
            if abs(bank_amount - inv_amount) / max(inv_amount, 1) <= tolerance:
                matched_bank = bank_amount
                if abs(bank_amount - inv_amount) / max(inv_amount, 1) < 0.001:
                    status = "PAID"
                else:
                    status = "PARTIAL"
                break

        results.append(ReconcileResult(
            invoice_number=item["invoice_number"],
            amount=inv_amount,
            date="",
            status=status,
            bank_amount=matched_bank,
        ))

    return results
