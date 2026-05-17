"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ingestFile } from "@/lib/api";

const IMAGE_RE = /\.(jpe?g|png)(\?|$)/i;
function isImageSource(url: string, filename: string) {
  return IMAGE_RE.test(url) || /\.(jpe?g|png)$/i.test(filename);
}
const PDFJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs";

/* ── Fullscreen preview modal ─────────────────────────────────── */
function PreviewModal({
  sourceFile,
  pdfUrl,
  onClose,
}: {
  sourceFile: string;
  pdfUrl: string;
  onClose: () => void;
}) {
  const isImage = isImageSource(pdfUrl, sourceFile);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  const renderPage = useCallback(async (doc: any, pageNum: number) => {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;
    setPdfReady(true);
  }, []);

  // Load PDF on mount
  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN;
        const doc = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        await renderPage(doc, 1);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, isImage, renderPage]);

  async function goToPage(num: number) {
    if (!pdfDoc || num < 1 || num > totalPages) return;
    setCurrentPage(num);
    setPdfReady(false);
    await renderPage(pdfDoc, num);
  }

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-5 py-3 backdrop-blur">
        <span className="max-w-[60vw] truncate text-sm font-semibold text-white">{sourceFile}</span>
        <div className="flex items-center gap-3">
          {!isImage && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                className="rounded-md border border-white/20 px-2.5 py-1 text-xs text-white transition hover:bg-white/10 disabled:opacity-30">
                ‹ Prev
              </button>
              <span className="text-xs text-white/60">{currentPage} / {totalPages}</span>
              <button
                onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                className="rounded-md border border-white/20 px-2.5 py-1 text-xs text-white transition hover:bg-white/10 disabled:opacity-30">
                Next ›
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">
            ✕ Close
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pdfUrl} alt={sourceFile}
            className="max-h-full max-w-full rounded-xl shadow-2xl object-contain" />
        ) : (
          <div className="relative min-h-[60vh] min-w-[40vw]">
            {!pdfReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              </div>
            )}
            <canvas ref={canvasRef} className="rounded-xl shadow-2xl" />
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

/* ── Main component ───────────────────────────────────────────── */
export interface UploadedSource {
  sourceFile: string;
  pdfUrl: string;
}

interface Props {
  sources: UploadedSource[];
  activeIndex: number;
  onSelectSource: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  uploading: boolean;
  uploadError: string | null;
  onFilesSelected: (files: FileList) => void;
}

export default function InvoiceDataPanel({
  sources,
  activeIndex,
  onSelectSource,
  fileInputRef,
  uploading,
  uploadError,
  onFilesSelected,
}: Props) {
  const [previewSource, setPreviewSource] = useState<UploadedSource | null>(null);

  return (
    <div className="flex h-full flex-col">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-card-border bg-sidebar px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Invoices
        </p>
      </div>

      {/* Hidden file input (triggered by ChatPanel's attach button) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && e.target.files.length > 0 && onFilesSelected(e.target.files)}
      />

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">

        {sources.length === 0 && !uploading && (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-card-border text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-card-border bg-card"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                strokeWidth={1.5} style={{ color: "var(--color-accent)" }}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">No invoices loaded</p>
              <p className="mt-0.5 text-xs text-text-secondary">Use the attach button in chat to upload</p>
              <p className="mt-0.5 text-xs text-text-secondary">PDF · JPG · PNG · multiple files supported</p>
            </div>
          </div>
        )}

        {/* Uploading spinner */}
        {uploading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3">
            <div className="flex gap-1 shrink-0">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              ))}
            </div>
            <p className="text-sm text-text-secondary">Processing…</p>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <p className="mb-3 text-xs text-red-400">{uploadError}</p>
        )}

        {/* File list */}
        {sources.length > 0 && (
          <div className="space-y-2">
            {sources.map((src, idx) => {
              const isImage = isImageSource(src.pdfUrl, src.sourceFile);
              const ext = src.sourceFile.split(".").pop()?.toUpperCase() ?? "";
              const isActive = idx === activeIndex;
              return (
                <div key={idx}
                  className={`group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-accent/50 bg-accent/5"
                      : "border-card-border bg-card hover:border-accent/30"
                  }`}
                  style={isActive ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" } : undefined}
                >
                  {/* File icon — click to set active */}
                  <button onClick={() => onSelectSource(idx)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-card-border bg-sidebar focus-ring">
                    {isImage ? (
                      <svg className="h-4 w-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M6.375 6.375h.008v.008h-.008v-.008z" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    )}
                  </button>

                  {/* Name + type — click to set active */}
                  <button onClick={() => onSelectSource(idx)} className="min-w-0 flex-1 text-left focus-ring rounded">
                    <p className="truncate text-sm font-semibold text-text-primary">{src.sourceFile}</p>
                    <p className="text-xs text-text-secondary">
                      {ext} {isActive && <span className="ml-1 text-accent font-medium">· active</span>}
                    </p>
                  </button>

                  {/* Fullscreen preview button */}
                  <button
                    onClick={() => setPreviewSource(src)}
                    title="Preview fullscreen"
                    className="pressable focus-ring shrink-0 rounded-lg border border-card-border bg-sidebar p-2 text-text-secondary opacity-0 transition group-hover:opacity-100 hover:border-accent/50 hover:text-accent">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fullscreen preview modal */}
      {previewSource && (
        <PreviewModal
          sourceFile={previewSource.sourceFile}
          pdfUrl={previewSource.pdfUrl}
          onClose={() => setPreviewSource(null)}
        />
      )}
    </div>
  );
}
