"use client";

import { useRef, useState } from "react";
import { API_BASE, ingestFile } from "@/lib/api";

const IMAGE_RE = /\.(jpe?g|png)(\?|$)/i;
const PDFJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs";

/* ── Compact PDF page render ──────────────────────────────────── */
function PdfPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  // Render on first paint
  useState(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN;
        const doc = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setReady(true);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  });

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-background">
      {!ready && (
        <div className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-card-border border-t-accent" />
        </div>
      )}
      <canvas ref={canvasRef} className="w-full rounded-lg shadow-md" />
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */
interface Props {
  sourceFile: string | null;
  pdfUrl: string | null;
  onUpload: (pdfUrl: string, sourceFile: string) => void;
}

export default function InvoiceDataPanel({ sourceFile, pdfUrl, onUpload }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isImage = pdfUrl ? IMAGE_RE.test(pdfUrl) : false;
  const fileExt = sourceFile?.split(".").pop()?.toUpperCase() ?? "";

  async function handleUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      setError("Please upload a PDF, JPG, or PNG file.");
      return;
    }
    setError(null);
    setPreviewOpen(false);
    setUploading(true);
    try {
      const result = await ingestFile(file);
      const url = `${API_BASE}/uploads/${encodeURIComponent(result.source_file)}`;
      onUpload(url, result.source_file);
      setPreviewOpen(true);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">

      {/* ── Header / upload bar ───────────────────────────────── */}
      <div className="shrink-0 border-b border-card-border bg-sidebar px-4 py-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="pressable focus-ring flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-bold text-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {uploading ? (
            <>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
                ))}
              </span>
              Processing…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Invoice
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* Empty state */}
        {!sourceFile && (
          <div
            className="flex h-full min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-card-border text-center transition-colors hover:border-accent/40"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-card-border bg-card"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                strokeWidth={1.5} style={{ color: "var(--color-accent)" }}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">No invoice loaded</p>
              <p className="mt-0.5 text-xs text-text-secondary">PDF · JPG · PNG</p>
            </div>
          </div>
        )}

        {/* File entry + inline preview */}
        {sourceFile && pdfUrl && (
          <div className="space-y-3">

            {/* Clickable file row */}
            <button
              onClick={() => setPreviewOpen((o) => !o)}
              className="pressable focus-ring flex w-full items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 text-left transition-colors hover:border-accent/40"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}
            >
              {/* File type icon */}
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-card-border bg-sidebar">
                {isImage ? (
                  <svg className="h-4 w-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M6.375 6.375h.008v.008h-.008v-.008z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                )}
              </div>

              {/* Name + type */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{sourceFile}</p>
                <p className="text-xs text-text-secondary">{fileExt} · tap to preview</p>
              </div>

              {/* Chevron */}
              <svg
                className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${previewOpen ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Preview */}
            {previewOpen && (
              <div className="overflow-hidden rounded-xl border border-card-border bg-card p-3">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pdfUrl}
                    alt={sourceFile}
                    className="w-full rounded-lg object-contain shadow-md"
                    style={{ maxHeight: 480 }}
                  />
                ) : (
                  <PdfPreview url={pdfUrl} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
