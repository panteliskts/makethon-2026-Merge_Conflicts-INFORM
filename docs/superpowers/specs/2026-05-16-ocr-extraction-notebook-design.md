# OCR Extraction & Knowledgebase Notebook — Design

Date: 2026-05-16
Project: INFORM FinDoc AI (Makeathon 2026, team Merge Conflicts)

## Goal

A Kaggle-GPU notebook that:

1. Trains/compiles a model from the four challenge datasets.
2. Given an invoice/receipt image, returns extracted information **and a bounding box for every item**.
3. Summarizes each document's context and embeds it into the app's ChromaDB knowledgebase.

Two deliverables: (a) a **reusable extraction module** the backend runs on demand, and (b) a **pre-populated ChromaDB knowledgebase** built from the datasets.

## Guiding Metrics

The implementation is judged on:

- **Consistency** — same image must yield the same fields and boxes. Achieved by a fine-tuned local model (deterministic inference); the VLM is used offline only.
- **Reliability** — no hallucinations. Every extracted field carries a bounding box traceable to an OCR word. Summary chunks are extractive (built from extracted fields), not free-form generation.
- **Cheap** — zero external API calls at backend request time. Model inference is local CPU/GPU. Gemini cost is a one-time offline notebook expense, with batched embedding calls.

## Approach

Fine-tune **LayoutLMv3** (`microsoft/layoutlmv3-base`) as a token classifier on SROIE + CORD
(both ship token-level field annotations). Gemini (`gemini-2.0-flash`) is used **only inside the
notebook, offline** — for pseudo-labeling weakly-annotated datasets and for context summarization.
The backend never calls Gemini at request time, satisfying the "cheap" + "consistent" metrics.

Rejected: VLM-per-request (no compiled model, per-call cost/variance) and pure heuristic regex
(brittle across vendor formats).

## Datasets

All downloaded locally as zips / extracted folders in the project root.

| Dataset | Form | Annotations | Role |
|---|---|---|---|
| SROIE v2 | `.jpg` receipts | `box/*.txt` quad coords + `entities/*.json` (company/date/address/total) | Primary training labels |
| CORD v2 | parquet (image + KV ground truth) | structured key-value pairs | Training labels (line items) |
| invoice-ocr | `.jpg` + Tesseract `image_to_data` JSON | words+boxes only, no field labels | Eval + Gemini pseudo-labels |
| HQ invoice | `.jpg` + JSON ground truth + OCR text | structured JSON | Eval + Gemini pseudo-labels |

## Unified Schema

Every document is normalized to `{image, words[], boxes[], labels[]}` where boxes are
`[x0,y0,x1,y1]` in pixels and labels use a BIO scheme over this entity space:

```
COMPANY, DATE, ADDRESS, INVOICE_NO, SUBTOTAL, TAX, TOTAL,
ITEM_NAME, ITEM_QTY, ITEM_PRICE, O
```

SROIE/CORD ground truth maps directly. invoice-ocr/HQ get labels by Gemini extraction
matched back onto OCR word boxes by fuzzy text alignment.

## Model

- `microsoft/layoutlmv3-base` token classifier; boxes normalized to 0–1000.
- Train on Kaggle GPU; held-out SROIE/CORD test splits.
- Metric: per-entity precision/recall/F1.
- Export: HF `save_pretrained` (model + processor) → `layoutlmv3-invoice.zip`.

## Inference Function

`extract_invoice(image) -> dict`, shared by notebook and backend:

1. OCR words + boxes — PaddleOCR primary, Tesseract fallback.
2. LayoutLMv3 token classification.
3. Group consecutive same-entity tokens → fields, each with a merged bounding box.
4. Assemble line-item table (ITEM_NAME/QTY/PRICE grouped by row).

Returns structured fields, a line-item list, and a bounding box for every item.

## Context Summarization

For each document, Gemini condenses the **already-extracted fields** into one short grounded
context paragraph (extractive — no new facts). Stored as a `summary` chunk for RAG.

## Knowledgebase Population

Chunks match the app's existing ChromaDB schema exactly:

```
text, page_num, x0, y0, x1, y1, source_file, chunk_type, chunk_index
```

`chunk_type` values: existing `header, line_item, totals, payment_terms` plus new `summary`.
Embed with Gemini `text-embedding-004` (batched). Write to a persistent `chroma_db/`,
collection `invoices` — a drop-in replacement for the app's vector store.

## Outputs (for backend integration)

1. `layoutlmv3-invoice.zip` — trained model artifact, loaded by the backend on demand.
2. `chroma_db.zip` — pre-populated knowledgebase.
3. `inference.py` — the `extract_invoice` module the backend's `/api/ingest` imports to
   handle image uploads (it currently handles only PDFs via PyMuPDF).

## Notebook Structure

1. Setup — installs, Gemini key, dataset paths.
2. Dataset exploration — sample each of the four datasets.
3. Unification — parse all four into the unified schema.
4. Training-set build — BIO label assignment, train/test split.
5. Fine-tune LayoutLMv3 (GPU).
6. Evaluate — per-entity F1.
7. Inference function — `extract_invoice`.
8. Gemini context summarization.
9. Embed + populate ChromaDB.
10. Package artifacts (model zip, chroma zip, inference module).

## Out of Scope

- Backend code changes to wire in `inference.py` (separate task; this delivers the module).
- Frontend changes.
- Reconciliation / metrics features.
