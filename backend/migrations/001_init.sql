-- ============================================================
-- INFORM – initial schema
-- Run once against your Supabase project:
--   psql "$SUPABASE_DB_URL" -f migrations/001_init.sql
--
-- Required env vars (add to backend/.env):
--   SUPABASE_URL          = https://<ref>.supabase.co
--   SUPABASE_SERVICE_KEY  = service_role secret key
--   SUPABASE_DB_URL       = postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
--
-- Create the "invoices" storage bucket in the Supabase dashboard
-- (Storage → New bucket → name "invoices", private).
-- ============================================================

-- pgvector (already enabled on Supabase; safe to run again)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tenants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Documents ─────────────────────────────────────────────────
-- One row per unique file (keyed by tenant + SHA-256 hash).
-- Duplicate uploads are skipped; existing chunk set is reused.
CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  file_hash    text NOT NULL,         -- SHA-256 hex
  storage_path text NOT NULL,         -- path inside "invoices" bucket
  file_type    text NOT NULL,         -- 'pdf' | 'jpg' | 'jpeg' | 'png'
  chunk_count  int  NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (tenant_id, file_hash)       -- dedup key
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant
  ON documents (tenant_id, filename);

-- ── Document chunks ───────────────────────────────────────────
-- 768-dimension embeddings (gemini-embedding-001 with outputDimensionality=768).
-- HNSW index supports up to 2000 dims; 768 gives good quality + small footprint.
CREATE TABLE IF NOT EXISTS document_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  chunk_index   int  NOT NULL,
  chunk_type    text NOT NULL,         -- header | line_item | totals | payment_terms
  text          text NOT NULL,
  page_num      int  NOT NULL DEFAULT 0,
  x0            float4 DEFAULT 0,
  y0            float4 DEFAULT 0,
  x1            float4 DEFAULT 0,
  y1            float4 DEFAULT 0,
  embedding     vector(768),
  -- Full-text search column, auto-maintained by Postgres
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  created_at    timestamptz DEFAULT now()
);

-- HNSW vector index (cosine similarity, best for normalised embeddings)
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Full-text index for hybrid search
CREATE INDEX IF NOT EXISTS idx_chunks_fts
  ON document_chunks USING gin (search_vector);

-- Btree for filtered lookups
CREATE INDEX IF NOT EXISTS idx_chunks_document
  ON document_chunks (tenant_id, document_id, chunk_index);

-- ── Chat messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  document_id uuid          REFERENCES documents(id) ON DELETE SET NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  chunk_ids   uuid[],      -- which document_chunks backed this answer
  grounded    bool,
  cached      bool DEFAULT false,
  latency_ms  float4,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON chat_messages (tenant_id, document_id, created_at);

-- ── Row-level security ────────────────────────────────────────
-- The FastAPI backend connects with the service role key.
-- Application-level WHERE clauses are the primary isolation.
-- RLS provides a defence-in-depth layer for any direct DB access.
ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages   ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically in Supabase.
-- These policies apply to the `anon` / `authenticated` roles only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'documents' AND policyname = 'tenant_documents'
  ) THEN
    CREATE POLICY tenant_documents ON documents
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_chunks' AND policyname = 'tenant_chunks'
  ) THEN
    CREATE POLICY tenant_chunks ON document_chunks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'chat_messages' AND policyname = 'tenant_messages'
  ) THEN
    CREATE POLICY tenant_messages ON chat_messages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
