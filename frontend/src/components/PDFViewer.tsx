"use client";

import { useEffect, useRef, useState } from "react";
import type { ChunkResult } from "@/lib/api";

const SCALE = 1.5;
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs";

interface Props {
  pdfUrl: string | null;
  highlightedChunks: ChunkResult[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

const IMAGE_RE = /\.(jpe?g|png)(\?|$)/i;

export default function PDFViewer({ pdfUrl, highlightedChunks, currentPage, onPageChange }: Props) {
  const isImage = !!pdfUrl && IMAGE_RE.test(pdfUrl);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pdfUrl || IMAGE_RE.test(pdfUrl)) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN;

      const doc = await pdfjsLib.getDocument(pdfUrl).promise;
      if (cancelled) return;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      onPageChange(1);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [pdfUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    (async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: SCALE });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const overlay = overlayRef.current!;
      overlay.width = viewport.width;
      overlay.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;
      drawOverlay();
    })();
  }, [pdfDoc, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    drawOverlay();
  }, [highlightedChunks, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawOverlay() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const pageChunks = highlightedChunks.filter(
      (c) => c.bbox.page_num === currentPage - 1,
    );

    for (const chunk of pageChunks) {
      const { x0, y0, x1, y1 } = chunk.bbox;
      // skip degenerate gemini-only boxes (no pixel evidence)
      if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;

      const sx = x0 * SCALE;
      const sy = y0 * SCALE;
      const sw = (x1 - x0) * SCALE;
      const sh = (y1 - y0) * SCALE;

      const v = chunk.verification ?? (chunk.source_type === "extracted" ? "model_only" : undefined);
      // verified=green-deep, model_only=green, gemini_only=blue, disputed=amber, ocr=orange
      const palette: Record<string, { fill: string; stroke: string; prefix: string }> = {
        verified:    { fill: "rgba(16, 185, 129, 0.30)", stroke: "#10b981", prefix: "✓✓" },
        model_only:  { fill: "rgba(56, 189, 130, 0.22)", stroke: "#38bd82", prefix: "✓" },
        gemini_only: { fill: "rgba(59, 130, 246, 0.22)", stroke: "#3b82f6", prefix: "~" },
        disputed:    { fill: "rgba(245, 158, 11, 0.28)", stroke: "#f59e0b", prefix: "⚠" },
      };
      const style = (v && palette[v]) || { fill: "rgba(233, 106, 61, 0.22)", stroke: "#e96a3d", prefix: "" };

      ctx.fillStyle = style.fill;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      ctx.fillStyle = style.stroke;
      ctx.font = "bold 10px system-ui, sans-serif";
      const conf = chunk.confidence != null ? ` · ${(chunk.confidence * 100).toFixed(0)}%` : "";
      const label = `${style.prefix} ${chunk.bbox.chunk_type}${conf}`.trim();
      ctx.fillText(label, sx + 4, sy - 4);
    }
  }

  if (isImage) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-card-border bg-sidebar px-4 py-2">
          <span className="font-mono text-sm text-text-secondary">Image Preview</span>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pdfUrl!}
            alt="Invoice"
            className="max-h-full max-w-full rounded-sm object-contain shadow-2xl shadow-black/40"
          />
        </div>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-center text-text-secondary">
        <div className="grid h-20 w-20 place-items-center rounded-lg border border-card-border bg-card">
          <svg className="h-10 w-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">No document loaded</p>
          <p className="mt-1 text-sm">Upload an invoice to render page highlights.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-card-border bg-sidebar px-4 py-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className="pressable focus-ring rounded-md border border-card-border bg-card px-3 py-1 text-sm text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary disabled:opacity-30"
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <span className="font-mono text-sm text-text-secondary">
          {loading ? "Loading..." : `Page ${currentPage} of ${totalPages}`}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          className="pressable focus-ring rounded-md border border-card-border bg-card px-3 py-1 text-sm text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary disabled:opacity-30"
        >
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>

      <div className="flex flex-1 justify-center overflow-auto bg-background p-4">
        <div className="relative" style={{ display: "inline-block" }}>
          <canvas ref={canvasRef} className="block rounded-sm shadow-2xl shadow-black/40" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
}
