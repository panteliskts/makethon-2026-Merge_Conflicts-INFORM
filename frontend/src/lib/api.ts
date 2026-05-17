const configuredApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const adminApiToken = process.env.NEXT_PUBLIC_ADMIN_API_TOKEN ?? "";

export const API_BASE = configuredApiBase.replace(/\/$/, "");

type DiagnosticIdentity = {
  email?: string | null;
  name?: string | null;
  role?: "admin" | "client" | string | null;
};

let diagnosticIdentity: DiagnosticIdentity = { role: "client" };

function getBrowserSessionId() {
  if (typeof window === "undefined") return "server-render";
  try {
    const key = "inform.sessionId";
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "browser-session";
  }
}

function readStoredIdentity(): DiagnosticIdentity {
  if (typeof window === "undefined") return {};
  try {
    return {
      email: window.localStorage.getItem("inform.userEmail"),
      name: window.localStorage.getItem("inform.userName"),
      role: window.localStorage.getItem("inform.userRole"),
    };
  } catch {
    return {};
  }
}

function getStoredIdentity(): Required<DiagnosticIdentity> {
  const stored = readStoredIdentity();
  return {
    email: diagnosticIdentity.email ?? stored.email ?? null,
    name: diagnosticIdentity.name ?? stored.name ?? null,
    role: diagnosticIdentity.role ?? stored.role ?? "client",
  };
}

function writeDiagnosticValue(key: string, value?: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {}
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const err = await res.json();
    return err.detail || err.message || fallback;
  } catch {
    return fallback;
  }
}

export function setDiagnosticsIdentity(identity: DiagnosticIdentity) {
  diagnosticIdentity = { ...diagnosticIdentity, ...identity };
  if (typeof window === "undefined") return;
  if ("email" in identity) writeDiagnosticValue("inform.userEmail", identity.email);
  if ("name" in identity) writeDiagnosticValue("inform.userName", identity.name);
  if ("role" in identity) writeDiagnosticValue("inform.userRole", identity.role || "client");
}

export function clearDiagnosticsIdentity() {
  diagnosticIdentity = { role: "client" };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("inform.userEmail");
    window.localStorage.removeItem("inform.userName");
    window.localStorage.removeItem("inform.userRole");
  } catch {}
}

function withDiagnosticHeaders(headers?: HeadersInit, admin = false) {
  const nextHeaders = new Headers(headers);
  if (typeof window !== "undefined") {
    const identity = getStoredIdentity();
    nextHeaders.set("x-inform-session-id", getBrowserSessionId());
    nextHeaders.set("x-inform-user-email", identity.email || "unknown@client");
    nextHeaders.set("x-inform-user-name", identity.name || "Unknown client");
    nextHeaders.set("x-inform-user-role", identity.role || "client");
    nextHeaders.set("x-inform-path", window.location.pathname);
    nextHeaders.set("x-inform-client-time", new Date().toISOString());
  }
  if (admin && adminApiToken) nextHeaders.set("x-admin-token", adminApiToken);
  return nextHeaders;
}

function adminHeaders(headers?: HeadersInit) {
  return withDiagnosticHeaders(headers, true);
}

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
  source_type?: "extracted" | "ocr_block";
  confidence?: number;
  entity?: string;
  verification?: "verified" | "model_only" | "gemini_only" | "disputed";
  agreement?: number;
  model_value?: string;
  gemini_value?: string;
}

export interface IngestResponse {
  source_file: string;
  document_id: string | null;
  chunk_count: number;
  preview_url: string;   // signed Supabase Storage URL (or local fallback)
  status: string;
  cached: boolean;
  verification?: {
    verified?: number;
    model_only?: number;
    gemini_only?: number;
    disputed?: number;
    ocr_block?: number;
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: string;
  chunks: ChunkResult[];
  grounded: boolean;
  refused: boolean;
}

export interface QueryResponse {
  answer: string;
  chunks: ChunkResult[];
  grounded: boolean;
  refused: boolean;
}

export interface ReconcileResult {
  invoice_number: string;
  amount: number;
  date: string;
  status: "PAID" | "PARTIAL" | "UNPAID" | string;
  bank_amount?: number | null;
}

export interface MetricsResponse {
  total_queries: number;
  grounded_count: number;
  refused_count: number;
  avg_latency_ms: number;
}

export interface AdminEvent {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  message: string;
  metadata: Record<string, unknown>;
}

export interface AdminSession {
  id: string;
  user_email: string;
  user_name: string;
  role: string;
  status: "active" | "idle" | string;
  path: string;
  user_agent: string;
  active_source: string | null;
  first_seen: string;
  last_seen: string;
  request_count: number;
  error_count: number;
  events: AdminEvent[];
}

export interface AdminSessionsResponse {
  generated_at: string;
  uptime_seconds: number;
  sessions: AdminSession[];
}

export type AdminCommand =
  | "healthcheck"
  | "trace"
  | "errors"
  | "sources"
  | "capture-snapshot"
  | "reset-context"
  | "mark-reviewed";

export interface AdminCommandResponse {
  session_id: string;
  command: AdminCommand;
  status: string;
  generated_at: string;
  output: string[];
}

export async function ingestFile(file: File): Promise<IngestResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/ingest`, {
    method: "POST",
    headers: withDiagnosticHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Ingest failed"));
  return res.json();
}

export async function sendChat(
  messages: ChatMessage[],
  sourceFile?: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: withDiagnosticHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ messages, source_file: sourceFile ?? null }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Chat request failed"));
  return res.json();
}

export async function queryInvoice(
  q: string,
  sourceFile?: string,
): Promise<QueryResponse> {
  const res = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: withDiagnosticHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query: q, top_k: 5, source_file: sourceFile ?? null }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Query failed"));
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
  const res = await fetch(`${API_BASE}/api/reconcile`, {
    method: "POST",
    headers: withDiagnosticHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Reconcile failed"));
  return res.json();
}

export async function getMetrics(): Promise<MetricsResponse> {
  const res = await fetch(`${API_BASE}/api/metrics`, { headers: withDiagnosticHeaders() });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Metrics fetch failed"));
  return res.json();
}

export interface UsageResponse {
  total_requests: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate_pct: number;
  cache_size: number;
  total_input_tokens: number;
  total_output_tokens: number;
  rate_limit_hits: number;
  context_window_limit: number;
  requests_per_day_limit: number;
}

export async function getUsage(): Promise<UsageResponse> {
  const res = await fetch(`${API_BASE}/api/usage`, { headers: withDiagnosticHeaders() });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Usage fetch failed"));
  return res.json();
}

export interface InvoiceChunk {
  text: string;
  chunk_type: "header" | "line_item" | "totals" | "payment_terms" | string;
  page_num: number;
  chunk_index: number;
}

export async function getDocumentChunks(sourceFile: string): Promise<InvoiceChunk[]> {
  const res = await fetch(
    `${API_BASE}/api/chunks?source_file=${encodeURIComponent(sourceFile)}`,
    { headers: withDiagnosticHeaders() },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.chunks ?? [];
}

export async function listSources(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/sources`, { headers: withDiagnosticHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return data.sources ?? [];
}

export async function getAdminSessions(): Promise<AdminSessionsResponse> {
  const res = await fetch(`${API_BASE}/api/admin/sessions`, {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Admin sessions fetch failed"));
  return res.json();
}

export async function runAdminCommand(
  sessionId: string,
  command: AdminCommand,
): Promise<AdminCommandResponse> {
  const res = await fetch(`${API_BASE}/api/admin/command`, {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ session_id: sessionId, command }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Admin command failed"));
  return res.json();
}
