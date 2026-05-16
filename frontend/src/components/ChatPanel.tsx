"use client";

import { useRef, useState, useEffect, KeyboardEvent } from "react";
import { sendChat, getUsage, type ChatMessage, type ChunkResult, type UsageResponse } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  chunks?: ChunkResult[];
  refused?: boolean;
  grounded?: boolean;
}

interface Props {
  sourceFile: string | null;
  onChunksHighlight: (chunks: ChunkResult[]) => void;
}

export default function ChatPanel({ sourceFile, onChunksHighlight }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const u = await getUsage();
        if (!cancelled) setUsage(u);
      } catch { /* backend may not be ready */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const history: Message[] = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const apiMessages: ChatMessage[] = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await sendChat(apiMessages, sourceFile ?? undefined);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          chunks: res.chunks,
          refused: res.refused,
          grounded: res.grounded,
        },
      ]);

      if (res.chunks.length > 0) onChunksHighlight(res.chunks);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "An error occurred. Please try again.", refused: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-card-border bg-sidebar px-4 py-3">
        <span className="text-sm font-semibold text-text-primary">Chat</span>
        <button
          onClick={() => setUsageOpen((o) => !o)}
          className="pressable focus-ring flex items-center gap-1.5 rounded-md border border-card-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent/50 hover:text-text-primary"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Usage
        </button>
      </div>

      {/* ── Usage panel ──────────────────────────────────────────── */}
      {usageOpen && (
        <div className="shrink-0 border-b border-card-border bg-card px-4 py-3 space-y-3">
          {usage ? (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-text-secondary">Session tokens</span>
                  <span className="font-mono text-text-primary">
                    {(usage.total_input_tokens + usage.total_output_tokens).toLocaleString()}
                    <span className="text-muted"> / {usage.context_window_limit.toLocaleString()}</span>
                  </span>
                </div>
                {(() => {
                  const used = usage.total_input_tokens + usage.total_output_tokens;
                  const pct = Math.min(100, (used / usage.context_window_limit) * 100);
                  const color = pct > 80 ? "var(--color-ember)" : pct > 55 ? "#f59e0b" : "var(--color-accent)";
                  return (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-border">
                      <div className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  );
                })()}
                {(() => {
                  const pct = ((usage.total_input_tokens + usage.total_output_tokens) / usage.context_window_limit) * 100;
                  return pct > 80 ? (
                    <p className="mt-1 text-[10px] font-medium" style={{ color: "var(--color-ember)" }}>
                      Approaching token limit — consider starting a new session.
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Requests", value: usage.total_requests },
                  { label: "Cache hits", value: `${usage.cache_hit_rate_pct}%` },
                  { label: "Cached", value: usage.cache_hits },
                  { label: "429 hits", value: usage.rate_limit_hits },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-card-border bg-sidebar px-2 py-2 text-center">
                    <p className="font-mono text-sm font-bold text-text-primary">{value}</p>
                    <p className="mt-0.5 text-[10px] text-text-secondary">{label}</p>
                  </div>
                ))}
              </div>
              {usage.rate_limit_hits > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Quota hit {usage.rate_limit_hits}×. Retrying automatically — if this persists, wait ~60 s.
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-text-secondary">Loading usage…</p>
          )}
        </div>
      )}

      {error && (
        <div className="border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl border border-card-border bg-card flex items-center justify-center"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                style={{ color: "var(--color-accent)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">
                {sourceFile ? "Ready — ask about this invoice" : "Upload an invoice to begin"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                {sourceFile
                  ? "Click a source chip to preview the document section."
                  : "Use the panel on the left to upload a PDF, JPG, or PNG."}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "rounded-br-sm text-white"
                  : msg.refused
                  ? "rounded-bl-sm border text-amber-300"
                  : "rounded-bl-sm border border-card-border bg-card text-text-primary"
              }`}
              style={
                msg.role === "user"
                  ? { background: "var(--color-accent)" }
                  : msg.refused
                  ? { background: "color-mix(in srgb, var(--color-ember) 10%, transparent)", borderColor: "color-mix(in srgb, var(--color-ember) 35%, transparent)" }
                  : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }
              }
            >
              {msg.role === "assistant" && !msg.grounded && !msg.refused && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-red-400">
                  <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Low confidence
                </div>
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {msg.chunks && msg.chunks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-card-border/40">
                  <p className="mb-2 text-[11px] font-medium text-text-secondary">Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {msg.chunks.slice(0, 4).map((chunk, ci) => (
                      <button
                        key={ci}
                        onClick={() => onChunksHighlight([chunk])}
                        className="pressable focus-ring rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                        style={{
                          background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                          borderColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
                          color: "var(--color-accent)",
                        }}
                      >
                        p.{chunk.bbox.page_num + 1} · {chunk.bbox.chunk_type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[70%] space-y-2.5 pt-1">
              <div className="skeleton h-3 rounded-lg w-3/4" />
              <div className="skeleton h-3 rounded-lg w-full" />
              <div className="skeleton h-3 rounded-lg w-1/2" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-card-border bg-sidebar px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sourceFile ? "Ask about this invoice…" : "Upload an invoice first…"}
            disabled={!sourceFile}
            rows={1}
            className="focus-ring max-h-[120px] min-h-[46px] flex-1 resize-none rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-text-primary outline-none placeholder:text-muted transition-colors disabled:opacity-40"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !sourceFile}
            aria-label="Send message"
            className="pressable focus-ring shrink-0 rounded-md bg-accent p-3 text-ink hover:bg-accent-hover disabled:opacity-40"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
