import io
import re
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from typing import Optional
import pandas as pd
from ..models import ReconcileResult
from ..services.telemetry import record_event, record_exception
from ..services import database as db

router = APIRouter()

_AMOUNT_RE = re.compile(r"[\d,]+\.?\d*")
_INV_NUM_RE = re.compile(r"(?:invoice|inv|#|no\.?)\s*:?\s*([A-Z0-9\-]+)", re.IGNORECASE)


def _tenant_email(request: Request) -> str:
    return request.headers.get("x-inform-user-email", "demo@inform.app")


def _parse_amount(text: str) -> Optional[float]:
    clean = re.sub(r"[€$£,]", "", text).strip()
    m = _AMOUNT_RE.search(clean)
    if m:
        try:
            return float(m.group())
        except ValueError:
            return None
    return None


def _extract_invoice_info(chunks: list) -> list[dict]:
    """Extract amount + invoice number from chunk rows (asyncpg Record or dict)."""
    invoices = []
    for c in chunks:
        # Support both asyncpg Record and plain dict
        chunk_type = c["chunk_type"] if hasattr(c, "__getitem__") else c.get("chunk_type")
        text = c["text"] if hasattr(c, "__getitem__") else c.get("text", "")
        source = (c.get("source_file") or c.get("filename") or "unknown") if isinstance(c, dict) else "unknown"

        if chunk_type in ("totals", "line_item"):
            amount = _parse_amount(text)
            inv_match = _INV_NUM_RE.search(text)
            inv_num = inv_match.group(1) if inv_match else source
            if amount:
                invoices.append({"invoice_number": inv_num, "amount": amount})
    return invoices


@router.post("/reconcile")
async def reconcile(
    request: Request,
    bank_statement: UploadFile = File(...),
    invoice: Optional[UploadFile] = File(None),
    source_file: Optional[str] = Form(None),
):
    t0 = time.monotonic()

    # ── Parse bank CSV ────────────────────────────────────────────────────────
    csv_bytes = await bank_statement.read()
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception:
        try:
            df = pd.read_csv(io.BytesIO(csv_bytes), sep=";")
        except Exception:
            raise HTTPException(status_code=400, detail="Bank statement CSV could not be parsed")

    df.columns = [c.lower().strip() for c in df.columns]
    col_map: dict[str, str] = {}
    for col in df.columns:
        if any(k in col for k in ("amount", "betrag", "ποσό")):
            col_map["amount"] = col
        elif any(k in col for k in ("date", "datum", "ημερομηνία")):
            col_map["date"] = col

    if "amount" not in col_map:
        col_map["amount"] = df.columns[2] if len(df.columns) > 2 else df.columns[0]
    if "date" not in col_map:
        col_map["date"] = df.columns[0]

    bank_rows = []
    for _, row in df.iterrows():
        try:
            amount = float(str(row[col_map["amount"]]).replace(",", "").replace("€", "").strip())
            bank_rows.append({"amount": amount, "date": str(row[col_map["date"]]).strip()})
        except (ValueError, KeyError):
            continue

    # ── Retrieve invoice chunks (local DB read — no embedding call) ───────────
    invoice_items: list[dict] = []

    if db.db_available() and source_file:
        pool = db.get_pool()
        email = _tenant_email(request)
        try:
            tenant_id = await db.get_or_create_tenant(pool, email)
            doc = await db.get_document_by_filename(pool, tenant_id, source_file)
            if doc:
                rows = await db.get_chunks_for_document(pool, str(doc["id"]), tenant_id)
                invoice_items = _extract_invoice_info(rows)
        except Exception as exc:
            record_exception(request, "reconcile",
                             "Reconciliation failed while retrieving invoice totals", exc,
                             metadata={"source_file": source_file})
            raise

    if not invoice_items:
        record_event(request, "reconcile", "No invoice totals available for reconciliation",
                     status="warning", metadata={"source_file": source_file})
        return []

    # ── Match amounts ─────────────────────────────────────────────────────────
    tolerance = 0.05
    results = []
    for item in invoice_items:
        inv_amount = item["amount"]
        matched_bank = None
        status = "UNPAID"

        for bank_row in bank_rows:
            diff_ratio = abs(bank_row["amount"] - inv_amount) / max(inv_amount, 1)
            if diff_ratio <= tolerance:
                matched_bank = bank_row["amount"]
                status = "PAID" if diff_ratio < 0.001 else "PARTIAL"
                break

        results.append(ReconcileResult(
            invoice_number=item["invoice_number"],
            amount=inv_amount,
            date="",
            status=status,
            bank_amount=matched_bank,
        ))

    record_event(
        request, "reconcile",
        f"Reconciled {len(results)} invoice candidates",
        status="ok",
        metadata={
            "source_file": source_file,
            "bank_rows": len(bank_rows),
            "result_count": len(results),
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        },
    )
    return results
