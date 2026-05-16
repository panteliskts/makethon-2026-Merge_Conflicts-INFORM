"use client";

import { useRef, useState, useEffect, KeyboardEvent } from "react";
import { API_BASE, ingestFile, sendChat, type ChatMessage, type ChunkResult } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  chunks?: ChunkResult[];
  refused?: boolean;
  grounded?: boolean;
}

type Verification = "verified" | "model_only" | "gemini_only" | "disputed";

const VERIFY_STYLE: Record<Verification, { label: string; icon: string; fg: string; bg: string; border: string }> = {
  verified:    { label: "Verified",   icon: "✓✓", fg: "#10b981", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.35)" },
  model_only:  { label: "Model",      icon: "✓",  fg: "#38bd82", bg: "rgba(56,189,130,0.10)",  border: "rgba(56,189,130,0.30)" },
  gemini_only: { label: "AI vision",  icon: "~",  fg: "#60a5fa", bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.35)" },
  disputed:    { label: "Disputed",   icon: "⚠",  fg: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.40)" },
};

function summarizeVerification(chunks: ChunkResult[]): Verification | null {
  const extracted = chunks.filter((c) => c.source_type === "extracted" && c.verification);
  if (extracted.length === 0) return null;
  if (extracted.some((c) => c.verification === "disputed")) return "disputed";
  if (extracted.every((c) => c.verification === "verified")) return "verified";
  if (extracted.some((c) => c.verification === "verified")) return "verified";
  if (extracted.some((c) => c.verification === "model_only")) return "model_only";
  return "gemini_only";
}

interface Props {
  onChunksHighlight: (chunks: ChunkResult[]) => void;
  onPdfLoad: (url: string, filename: string) => void;
  sourceFile: string | null;
  onSourceFileChange: (sf: string) => void;
}

export default function ChatPanel({
  onChunksHighlight,
  onPdfLoad,
  sourceFile,
  onSourceFileChange,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      setError("Please upload a PDF, JPG, or PNG file.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const result = await ingestFile(file);
      onSourceFileChange(result.source_file);
      const url = `${API_BASE}/uploads/${encodeURIComponent(result.source_file)}`;
      onPdfLoad(url, result.source_file);
      const v = result.verification ?? {};
      const breakdown: string[] = [];
      if (v.verified) breakdown.push(`${v.verified} verified ✓✓`);
      if (v.model_only) breakdown.push(`${v.model_only} model-only ✓`);
      if (v.gemini_only) breakdown.push(`${v.gemini_only} AI-vision ~`);
      if (v.disputed) breakdown.push(`${v.disputed} disputed ⚠`);
      const trailer = breakdown.length
        ? `\n\nExtraction status: ${breakdown.join(" · ")}`
        : "";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Uploaded ${result.source_file}. ${result.chunk_count} sections indexed. You can now ask questions about this invoice.${trailer}`,
          grounded: true,
        },
      ]);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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

      if (res.chunks.length > 0 && !res.refused) {
        // Only highlight the primary source — the backend already ranks
        // verified ≫ model_only ≫ gemini_only ≫ ocr_block, so chunks[0]
        // is the chunk the system decided drove the answer.
        const primary = res.chunks.find(
          (c) => c.bbox.x1 - c.bbox.x0 > 0 && c.bbox.y1 - c.bbox.y0 > 0,
        );
        onChunksHighlight(primary ? [primary] : []);
      } else {
        onChunksHighlight([]);
      }
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
      <div className="flex shrink-0 items-center gap-3 border-b border-card-border bg-sidebar px-4 py-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="pressable focus-ring flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-bold text-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {uploading ? (
            <span className="flex gap-1">
              <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
              <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
              <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
            </span>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          )}
          {uploading ? "Processing..." : "Upload Invoice (PDF / JPG / PNG)"}
        </button>

        {sourceFile && (
          <span className="max-w-[220px] truncate rounded-md border border-card-border bg-card px-2 py-1 font-mono text-xs text-text-secondary">
            {sourceFile}
          </span>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
      </div>

      {error && (
        <div className="border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

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
              <p className="text-sm font-semibold text-text-primary">Upload an invoice to begin</p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Questions, source chips, and PDF highlights appear here.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
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

              {/* Verification summary chip — the headline trust signal */}
              {msg.role === "assistant" && !msg.refused && msg.chunks && (() => {
                const v = summarizeVerification(msg.chunks);
                if (!v) return null;
                const style = VERIFY_STYLE[v];
                return (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: style.bg, borderColor: style.border, color: style.fg }}>
                    <span className="font-mono">{style.icon}</span> {style.label}
                  </div>
                );
              })()}

              <p className="whitespace-pre-wrap">{msg.content}</p>

              {msg.chunks && msg.chunks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-card-border/40">
                  <p className="mb-2 text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Sources · click to highlight
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {msg.chunks.slice(0, 4).map((chunk, ci) => {
                      const v = (chunk.source_type === "extracted" && chunk.verification
                        ? chunk.verification
                        : null) as Verification | null;
                      const style = v ? VERIFY_STYLE[v] : null;
                      const confPct = chunk.confidence != null ? Math.round(chunk.confidence * 100) : null;
                      return (
                        <button key={ci} onClick={() => onChunksHighlight([chunk])}
                          title={v === "disputed"
                            ? `Model: ${chunk.model_value || "—"}\nGemini: ${chunk.gemini_value || "—"}`
                            : `${chunk.text}`}
                          className="pressable focus-ring rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                          style={style
                            ? { background: style.bg, borderColor: style.border, color: style.fg }
                            : {
                                background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                                borderColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
                                color: "var(--color-accent)",
                              }}>
                          {style && <span className="mr-1 font-mono">{style.icon}</span>}
                          p.{chunk.bbox.page_num + 1} · {chunk.bbox.chunk_type}
                          {confPct != null && v && <span className="ml-1 opacity-70">{confPct}%</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* If any source is disputed, surface the conflict explicitly */}
                  {msg.chunks.some((c) => c.verification === "disputed") && (
                    <div className="mt-3 rounded-md border p-2 text-[11px]"
                      style={{ borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.06)" }}>
                      <p className="mb-1 font-semibold" style={{ color: "#f59e0b" }}>
                        ⚠ Conflicting evidence for this field
                      </p>
                      {msg.chunks
                        .filter((c) => c.verification === "disputed")
                        .slice(0, 3)
                        .map((c, di) => (
                          <div key={di} className="mt-1 grid grid-cols-[80px_1fr] gap-x-2 leading-snug">
                            <span className="text-text-secondary">{c.bbox.chunk_type}</span>
                            <span>
                              <span className="opacity-70">model:</span> {c.model_value || "—"}<br />
                              <span className="opacity-70">vision:</span> {c.gemini_value || "—"}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start gap-2.5">
            {/* skeleton shimmer for assistant response */}
            <div className="flex-1 max-w-[70%] space-y-2.5 pt-1">
              <div className="skeleton h-3 rounded-lg w-3/4" />
              <div className="skeleton h-3 rounded-lg w-full" />
              <div className="skeleton h-3 rounded-lg w-1/2" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-card-border bg-sidebar px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this invoice…"
            rows={1}
            className="focus-ring max-h-[120px] min-h-[46px] flex-1 resize-none rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-text-primary outline-none placeholder:text-muted transition-colors"
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
            disabled={!input.trim() || loading}
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
