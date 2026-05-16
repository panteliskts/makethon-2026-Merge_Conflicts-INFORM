# INFORM Team Handoff

This document captures the current state of the INFORM invoice intelligence app so the team can pick up work without rediscovering the codebase.

## Project Summary

INFORM is a full-stack invoice analysis prototype for Makethon 2026 by team Merge Conflicts. It lets a user upload a PDF invoice, ask grounded questions about it, see source regions highlighted on the rendered PDF, reconcile invoice amounts against a bank statement CSV, and view simple live metrics.

The app is split into:

- `backend/`: FastAPI API, PDF parsing, chunking, embeddings, vector search, LLM calls, reconciliation, and metrics.
- `frontend/`: Next.js 14 app with Google sign-in, dashboard tabs, PDF viewer, chat UI, reconciliation UI, and metrics UI.
- `start.sh`: convenience script to start backend and frontend locally.

## What Is Implemented

### Authentication and Pages

- Landing page at `/` explains the product and links to sign-in.
- Login page at `/login` uses NextAuth Google provider.
- Dashboard at `/dashboard` is protected by `frontend/src/middleware.ts`.
- Auth config lives in `frontend/src/lib/auth.ts`.
- NextAuth API route lives in `frontend/src/app/api/auth/[...nextauth]/route.ts`.

### Invoice Upload and Indexing

- Users upload PDF invoices from the Chat tab.
- Frontend sends the PDF to `POST /api/ingest`.
- Backend saves the file under `backend/uploads`.
- Backend extracts text blocks and bounding boxes with PyMuPDF in `backend/app/services/chunker.py`.
- Each text block is classified as `header`, `line_item`, `totals`, or `payment_terms`.
- Chunks are embedded and stored in ChromaDB by `backend/app/services/embedder.py`.
- Re-uploading the same filename deletes old chunks for that source before adding the new ones.

### RAG Chat and Querying

- Chat UI lives in `frontend/src/components/ChatPanel.tsx`.
- Chat API client lives in `frontend/src/lib/api.ts`.
- Chat requests go to `POST /api/chat`.
- One-shot query support also exists at `POST /api/query`, although the current main UI uses `/api/chat`.
- Backend retrieves similar chunks from ChromaDB, passes them as context, and asks the LLM to answer only from that context.
- Out-of-scope answers should return the Greek refusal phrase: `Δεν βρέθηκε στο έγγραφο.`
- `/api/query` also runs a second self-check pass and records metrics.
- `/api/chat` does not currently run the self-check or update metrics.

### PDF Viewing and Source Highlighting

- PDF rendering is in `frontend/src/components/PDFViewer.tsx`.
- It uses `pdfjs-dist` and a CDN worker.
- Uploaded PDFs are served by FastAPI from `/uploads/{filename}`.
- Returned source chunks include page number and bounding-box coordinates.
- Clicking a source chip in chat highlights the matching area on the PDF canvas overlay.

### Bank Reconciliation

- UI lives in `frontend/src/components/ReconcilePanel.tsx`.
- API endpoint is `POST /api/reconcile`.
- User uploads a bank statement CSV and can optionally select an already uploaded invoice source.
- Backend reads CSV data with pandas.
- It tries to detect amount/date/description columns by common English, German, and Greek column names.
- It queries invoice chunks for total amount information, extracts amounts with regex, and compares invoice amounts against bank amounts.
- Matching currently uses amount tolerance only:
  - exact or near-exact match: `PAID`
  - within 5 percent tolerance: `PARTIAL`
  - no match: `UNPAID`
- Date matching is not actually implemented yet, even though the README mentions date tolerance.

### Metrics

- UI lives in `frontend/src/components/MetricsPanel.tsx`.
- API endpoint is `GET /api/metrics`.
- Metrics currently track:
  - total query count
  - grounded response count
  - refused response count
  - average latency in ms
- Metrics are stored in memory in `backend/app/routes/query.py`.
- Metrics reset when the backend restarts.
- Only `/api/query` updates metrics; `/api/chat` does not.

## Tech Stack

### Backend

- FastAPI
- Uvicorn
- PyMuPDF (`fitz`) for PDF text and bounding boxes
- ChromaDB persistent vector store
- OpenAI Python SDK used against Gemini's OpenAI-compatible endpoint
- pandas for CSV parsing
- Pydantic and pydantic-settings for API models and config

### Frontend

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- NextAuth
- pdfjs-dist

## Environment Variables

### Backend

The backend code currently reads these variables from `backend/.env` through `backend/app/config.py`:

```env
GEMINI_API_KEY=...
CHROMA_PERSIST_DIR=./chroma_db
UPLOAD_DIR=./uploads
```

The Gemini config defaults are:

- `GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`
- `GEMINI_EMBED_MODEL=text-embedding-004`
- `GEMINI_CHAT_MODEL=gemini-2.0-flash`

Important mismatch: `README.md` and the root `.env.example` still mention `OPENAI_API_KEY`, but the backend code and `backend/.env.example` use `GEMINI_API_KEY`.

### Frontend

Google sign-in needs a frontend env file, usually `frontend/.env.local`, with at least:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

These are not currently documented in an example file.

## Local Setup

### Option 1: Convenience Script

From the repo root:

```bash
./start.sh
```

The script:

- creates `backend/.env` from `backend/.env.example` if missing
- creates `backend/venv` if missing
- installs backend requirements
- starts FastAPI on `http://localhost:8000`
- installs frontend packages if needed
- starts Next.js on `http://localhost:3000`

### Option 2: Manual Backend

```bash
cd backend
cp .env.example .env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Option 3: Manual Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Reference

Base URL: `http://localhost:8000`

### `GET /health`

Returns backend health:

```json
{ "status": "ok" }
```

### `POST /api/ingest`

Multipart form:

- `file`: PDF invoice

Returns:

```json
{
  "source_file": "invoice.pdf",
  "chunk_count": 12,
  "status": "ok"
}
```

### `GET /api/sources`

Lists invoice filenames known to ChromaDB.

```json
{ "sources": ["invoice.pdf"] }
```

### `POST /api/chat`

JSON body:

```json
{
  "messages": [
    { "role": "user", "content": "What is the total?" }
  ],
  "source_file": "invoice.pdf"
}
```

Returns an assistant message, source chunks, and grounding/refusal flags.

### `POST /api/query`

JSON body:

```json
{
  "query": "What is the total?",
  "top_k": 5,
  "source_file": "invoice.pdf"
}
```

Returns a direct answer, source chunks, and grounding/refusal flags. This route also updates metrics.

### `POST /api/reconcile`

Multipart form:

- `bank_statement`: CSV file
- `invoice`: optional PDF file, currently accepted but not processed directly
- `source_file`: optional uploaded invoice filename

Returns an array of reconciliation rows:

```json
[
  {
    "invoice_number": "INV-001",
    "amount": 4250.0,
    "date": "",
    "status": "PAID",
    "bank_amount": 4250.0
  }
]
```

### `GET /api/metrics`

Returns:

```json
{
  "total_queries": 0,
  "grounded_count": 0,
  "refused_count": 0,
  "avg_latency_ms": 0.0
}
```

## Data Flow

1. User signs in with Google and opens `/dashboard`.
2. User uploads a PDF from the Chat tab.
3. Frontend calls `/api/ingest`.
4. Backend saves the PDF to `uploads`.
5. PyMuPDF extracts text blocks and PDF-space bounding boxes.
6. Chunker labels the blocks by invoice section.
7. Embedder creates Gemini embeddings and stores chunks in ChromaDB.
8. User asks a question.
9. Backend embeds the question, retrieves top chunks from ChromaDB, and sends them to Gemini chat.
10. Frontend renders answer and source chips.
11. Clicking a chip draws the returned bounding box on the PDF overlay.

## Important Files

- `backend/app/main.py`: FastAPI app setup, CORS, router registration, static upload mount.
- `backend/app/config.py`: environment settings and Gemini model defaults.
- `backend/app/models.py`: Pydantic request/response models.
- `backend/app/routes/ingest.py`: PDF upload and indexing.
- `backend/app/routes/chat.py`: conversational RAG endpoint.
- `backend/app/routes/query.py`: direct query endpoint, self-check, and metrics updates.
- `backend/app/routes/reconcile.py`: CSV reconciliation.
- `backend/app/routes/metrics.py`: metrics endpoint.
- `backend/app/services/chunker.py`: PDF text and bounding-box extraction.
- `backend/app/services/embedder.py`: ChromaDB and embedding logic.
- `backend/app/services/llm.py`: Gemini chat prompts, refusal behavior, self-check.
- `frontend/src/app/page.tsx`: landing page.
- `frontend/src/app/login/page.tsx`: Google login page.
- `frontend/src/app/dashboard/page.tsx`: tabbed dashboard shell.
- `frontend/src/components/ChatPanel.tsx`: upload and chat UI.
- `frontend/src/components/PDFViewer.tsx`: PDF render and highlight overlay.
- `frontend/src/components/ReconcilePanel.tsx`: bank reconciliation UI.
- `frontend/src/components/MetricsPanel.tsx`: metrics dashboard.
- `frontend/src/lib/api.ts`: frontend API client and shared TypeScript types.
- `frontend/src/lib/auth.ts`: NextAuth Google provider config.

## Current Limitations and Known Gaps

- README and root `.env.example` mention OpenAI, but the running backend is configured for Gemini.
- Frontend auth env variables are not documented in an example file.
- `/api/chat` does not update metrics, so the Metrics tab may stay empty during normal dashboard chat usage.
- `/api/chat` does not run the second self-check that `/api/query` runs.
- Reconciliation accepts an `invoice` upload but currently ignores it; it only uses chunks already in ChromaDB.
- Reconciliation does not use dates yet.
- Invoice number extraction is regex-based and can fall back to the source filename.
- Amount extraction is regex-based and may pick up a line item instead of the final total.
- ChromaDB and uploads are local filesystem state, not shared across machines or deployments.
- Generated folders such as `frontend/node_modules`, `backend/venv`, `backend/uploads`, `backend/chroma_db`, and `__pycache__` should not be committed.
- There are no automated tests yet.
- CORS allows only `http://localhost:3000`.
- API base URL is hardcoded in `frontend/src/lib/api.ts`.
- PDF.js worker is loaded from a CDN, so the frontend needs network access for PDF rendering.

## Recommended Next Steps

1. Align documentation and env examples around Gemini or switch the code back to OpenAI consistently.
2. Add `frontend/.env.example` for NextAuth/Google OAuth.
3. Add or update `.gitignore` to exclude generated dependencies, caches, uploads, local DBs, and env files.
4. Decide whether the dashboard should use `/api/query` or whether `/api/chat` should gain self-check and metrics updates.
5. Make reconciliation process the optional uploaded invoice or remove that upload field from the UI.
6. Improve reconciliation to extract a single invoice total and use date tolerance.
7. Move `API_BASE` to a frontend environment variable.
8. Add a small test set with sample PDFs and CSVs for ingest, query refusal, grounding, and reconciliation.
9. Add deployment notes once the target host is chosen.

## Demo Script

Use this flow for demos:

1. Start both servers and sign in with Google.
2. Upload a PDF invoice in the Chat tab.
3. Ask a direct invoice question such as "What is the total amount due?"
4. Click a source chip and show the PDF highlight.
5. Ask an out-of-scope question and show the refusal behavior.
6. Open Reconcile, upload a bank CSV, select the uploaded invoice source, and run reconciliation.
7. Open Metrics and explain the current caveat: metrics update through `/api/query`, not the main chat route yet.
