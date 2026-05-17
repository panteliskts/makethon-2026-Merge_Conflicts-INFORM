# INFORM — Invoice Intelligence

AI-powered invoice analysis with RAG, bounding box highlighting, bank reconciliation, and an admin diagnostics console for pitch demos.

## Prerequisites

This repo ships a custom-trained LayoutLMv3 model (~500 MB) via **Git LFS**.
**Install Git LFS before cloning**, or you will get a tiny pointer file instead
of the real model and inference will fail:

```bash
# macOS: brew install git-lfs   |   Debian/Ubuntu: sudo apt install git-lfs
git lfs install
git clone git@github.com:panteliskts/makethon-2026-Merge_Conflicts-INFORM.git
```

Already cloned without LFS? Run `git lfs install && git lfs pull` inside the repo.

## Quick Start

### One-command local start

```bash
./start.sh
```

On first run, the script creates `backend/.env` from `backend/.env.example`.
Ask the team lead for the private values and paste them into `backend/.env`.
Do not commit real env files.

Required for full shared-team mode:

```env
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_DB_URL=
```

`frontend/.env.local` is also local-only; the script creates demo auth defaults
when it is missing.

### Manual backend

```bash
cd backend
cp .env.example .env
# Edit .env and set GEMINI_API_KEY plus the private Supabase values.
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# API runs at http://localhost:8000
```

### Manual frontend

```bash
cd frontend
npm install
npm run dev
# UI runs at http://localhost:3000
```

## Architecture

- **FastAPI** backend with `/api/ingest`, `/api/chat`, `/api/query`, `/api/reconcile`, `/api/metrics`, `/api/admin/sessions`, `/api/admin/command`
- **Supabase Postgres + Storage** for vector search, persistence, and invoice previews
- **PyMuPDF** for PDF parsing — chunks by invoice section (header, line_item, totals, payment_terms)
- **Gemini OpenAI-compatible API** for embeddings, RAG answers, and self-checks
- **Next.js 14** frontend with PDF.js bounding box overlay
- **NextAuth** role-aware demo login for client/admin flows
- Bank reconciliation via CSV upload with amount-tolerance matching

## Demo Flow

1. Upload invoice PDF → indexed in ChromaDB
2. Ask question → answer with source bounding boxes highlighted on PDF
3. Ask out-of-scope question → refusal in Greek
4. Switch to Reconcile tab → upload bank CSV → see PAID/UNPAID/PARTIAL status
5. Sign in as `admin@inform.app` / `inform2026` → inspect session telemetry and run safe diagnostics
