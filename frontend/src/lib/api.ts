const configuredApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export const API_BASE = configuredApiBase.replace(/\/$/, "");

export interface BoundingBox {
  page_num: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  source_file: string;
  chunk_type: string;
}

export interface ChunkResult {
  text: string;
  bbox: BoundingBox;
  score: number;
  chunk_index: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface IngestResponse {
  source_file: string;
  chunk_count: number;
  status: string;
}

export interface QueryResponse {
  answer: string;
  chunks: ChunkResult[];
  grounded: boolean;
  refused: boolean;
}

export interface ChatResponse {
  message: string;
  chunks: ChunkResult[];
  grounded: boolean;
  refused: boolean;
}

export interface ReconcileResult {
  invoice_number: string;
  amount: number;
  date: string;
  status: "PAID" | "UNPAID" | "PARTIAL";
  bank_amount: number | null;
}

export interface MetricsResponse {
  total_queries: number;
  grounded_count: number;
  refused_count: number;
  avg_latency_ms: number;
}

export async function ingestFile(file: File): Promise<IngestResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/ingest`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Ingest failed");
  }
  return res.json();
}

export async function sendChat(
  messages: ChatMessage[],
  sourceFile?: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, source_file: sourceFile ?? null }),
  });
  if (!res.ok) throw new Error("Chat request failed");
  return res.json();
}

export async function queryInvoice(
  q: string,
  sourceFile?: string,
): Promise<QueryResponse> {
  const res = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, top_k: 5, source_file: sourceFile ?? null }),
  });
  if (!res.ok) throw new Error("Query failed");
  return res.json();
}

export async function reconcile(
  bankCsv: File,
  invoiceFile?: File | null,
  sourceFile?: string,
): Promise<ReconcileResult[]> {
  const form = new FormData();
  form.append("bank_statement", bankCsv);
  if (invoiceFile) form.append("invoice", invoiceFile);
  if (sourceFile) form.append("source_file", sourceFile);
  const res = await fetch(`${API_BASE}/api/reconcile`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Reconcile failed");
  return res.json();
}

export async function getMetrics(): Promise<MetricsResponse> {
  const res = await fetch(`${API_BASE}/api/metrics`);
  if (!res.ok) throw new Error("Metrics fetch failed");
  return res.json();
}

export async function listSources(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/sources`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sources ?? [];
}
