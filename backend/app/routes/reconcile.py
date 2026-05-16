import io
import re
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from typing import Optional
import pandas as pd
from ..models import ReconcileResult
from ..services.embedder import ChromaEmbedder
from ..services.telemetry import record_event, record_exception

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
    request: Request,
    bank_statement: UploadFile = File(...),
    invoice: Optional[UploadFile] = File(None),
    source_file: Optional[str] = Form(None),
):
    t0 = time.monotonic()
    csv_bytes = await bank_statement.read()
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception:
        try:
            df = pd.read_csv(io.BytesIO(csv_bytes), sep=";")
        except Exception:
            record_event(
                request,
                "reconcile",
                "Bank statement CSV could not be parsed",
                status="error",
                metadata={"source_file": source_file},
            )
            raise HTTPException(status_code=400, detail="Bank statement CSV could not be parsed")

    df.columns = [c.lower().strip() for c in df.columns]
    if len(df.columns) == 0:
        record_event(
            request,
            "reconcile",
            "Bank statement CSV had no readable columns",
            status="error",
            metadata={"source_file": source_file},
        )
        raise HTTPException(status_code=400, detail="Bank statement CSV had no readable columns")

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

    # Local ChromaDB get — no embedding API call needed for reconciliation.
    try:
        raw_chunks = _get_embedder().get_by_source(source_file)
        invoice_items = _extract_invoice_info(raw_chunks)
    except Exception as exc:
        record_exception(
            request,
            "reconcile",
            "Reconciliation failed while retrieving invoice totals",
            exc,
            metadata={
                "source_file": source_file,
                "bank_rows": len(bank_rows),
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            },
        )
        raise

    if not invoice_items:
        record_event(
            request,
            "reconcile",
            "No invoice totals were available for reconciliation",
            status="warning",
            metadata={"source_file": source_file, "bank_rows": len(bank_rows)},
        )
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

    record_event(
        request,
        "reconcile",
        f"Reconciled {len(results)} invoice candidates",
        status="ok" if bank_rows else "warning",
        metadata={
            "source_file": source_file,
            "bank_rows": len(bank_rows),
            "result_count": len(results),
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        },
    )

    return results
