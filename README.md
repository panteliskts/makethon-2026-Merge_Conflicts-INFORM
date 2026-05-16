# INFORM — Invoice Intelligence

AI-powered invoice analysis with RAG, bounding box highlighting, and bank reconciliation.

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# API runs at http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# UI runs at http://localhost:3000
```

## Architecture

- **FastAPI** backend with `/api/ingest`, `/api/chat`, `/api/query`, `/api/reconcile`, `/api/metrics`
- **ChromaDB** for vector storage with semantic chunking metadata
- **PyMuPDF** for PDF parsing — chunks by invoice section (header, line_item, totals, payment_terms)
- **OpenAI** `text-embedding-3-small` for embeddings, `gpt-4o-mini` for RAG, `gpt-4o` for self-check
- **Next.js 14** frontend with PDF.js bounding box overlay
- Bank reconciliation via CSV upload with amount ±5% and date ±7 day matching

## Demo Flow

1. Upload invoice PDF → indexed in ChromaDB
2. Ask question → answer with source bounding boxes highlighted on PDF
3. Ask out-of-scope question → refusal in Greek
4. Switch to Reconcile tab → upload bank CSV → see PAID/UNPAID/PARTIAL status
5. Switch to Metrics tab → live accuracy and latency dashboard
