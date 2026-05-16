"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle, LangToggle } from "@/components/NavControls";

const SCROLL_PAGES = 8;
const FRAME_COUNT = 151;
const CARD_HALF_H = 70;

const BLOCKS = [
  {
    headline: "Snap the receipt.",
    subtext: "A single photo is all it takes — no typing, no sorting.",
    side: "left" as const,
    at: 0.15,
  },
  {
    headline: "We read every line.",
    subtext: "Merchant, date, tax and totals — extracted in seconds.",
    side: "right" as const,
    at: 0.38,
  },
  {
    headline: "Expenses, organised.",
    subtext: "Every purchase lands in the right category automatically.",
    side: "left" as const,
    at: 0.62,
  },
  {
    headline: "Ready when you are.",
    subtext: "Export a clean report whenever tax season calls.",
    side: "right" as const,
    at: 0.85,
  },
];

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function invLerp(a: number, b: number, v: number) {
  return clamp((v - a) / (b - a), 0, 1);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const lastFrameRef = useRef(-1);
  const readyRef = useRef(false);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [loadProgress, setLoadProgress] = useState(0);
  const [ready, setReady] = useState(false);

  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw === 0 || ch === 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    lastFrameRef.current = index;
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    drawFrame(lastFrameRef.current < 0 ? 0 : lastFrameRef.current);
  }, [drawFrame]);

  useEffect(() => {
    let cancelled = false;
    const imgs: HTMLImageElement[] = new Array(FRAME_COUNT);
    let done = 0;

    const promises = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const img = new Image();
      const num = String(i + 1).padStart(3, "0");
      img.src = `/frames/frame_${num}.jpg`;
      return new Promise<void>((resolve) => {
        const finish = () => {
          imgs[i] = img;
          done++;
          if (!cancelled) setLoadProgress(done / FRAME_COUNT);
          resolve();
        };
        img.decode
          ? img.decode().then(finish, finish)
          : ((img.onload = finish), (img.onerror = finish));
      });
    });

    Promise.all(promises).then(() => {
      if (!cancelled) {
        imagesRef.current = imgs;
        readyRef.current = true;
        setReady(true);
      }
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [ready, resizeCanvas]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollY = container.scrollTop;
    const screenH = container.clientHeight;
    const screenW = container.clientWidth;
    const contentH = screenH * SCROLL_PAGES;
    const scrollable = Math.max(contentH - screenH, 1);
    const progress = scrollY / scrollable;

    if (readyRef.current) {
      const index = Math.round(progress * (FRAME_COUNT - 1));
      if (index !== lastFrameRef.current) drawFrame(index);
    }

    const range = screenH * 0.8;
    const plateau = range * 0.32;
    const travelX = screenW * 0.45;

    BLOCKS.forEach((block, i) => {
      const el = blockRefs.current[i];
      if (!el) return;

      const centerOffset = block.at * scrollable;
      const r0 = centerOffset - range;
      const r1 = centerOffset - plateau;
      const r2 = centerOffset + plateau;
      const r3 = centerOffset + range;

      const offscreen = block.side === "left" ? -travelX : travelX;
      let opacity: number;
      let tx: number;

      if (scrollY <= r0 || scrollY >= r3) {
        opacity = 0; tx = offscreen;
      } else if (scrollY <= r1) {
        const t = invLerp(r0, r1, scrollY);
        opacity = t; tx = lerp(offscreen, 0, t);
      } else if (scrollY <= r2) {
        opacity = 1; tx = 0;
      } else {
        const t = invLerp(r2, r3, scrollY);
        opacity = 1 - t; tx = lerp(0, offscreen, t);
      }

      el.style.opacity = String(opacity);
      el.style.transform = `translateX(${tx}px)`;
    });
  }, [drawFrame]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, ready]);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ backgroundColor: "#0c0c0e" }}>

      {/* Nav — matches login & dashboard in height and structure */}
      <nav className="absolute inset-x-0 top-0 z-50 flex h-[60px] items-center justify-between border-b px-6"
        style={{
          borderColor: "rgba(255,255,255,0.06)",
          background: "rgba(12,12,14,0.75)",
          backdropFilter: "blur(16px) saturate(1.4)",
        }}>

        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
            style={{ background: "var(--color-accent)", boxShadow: "0 4px 16px -4px color-mix(in srgb, var(--color-accent) 50%, transparent)" }}>
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-white">INFORM</span>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
          <Link
            href="/login"
            className="pressable focus-ring rounded-md px-4 py-2 text-sm font-bold text-white transition-colors"
            style={{ background: "var(--color-accent)" }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Receipt animation canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />

      {/* Scrim — keeps text legible */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.28)" }} />

      {/* Scrollable surface */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-scroll"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="relative" style={{ height: `${SCROLL_PAGES * 100}vh` }}>

          {/* Hero — first viewport, text at bottom */}
          <div className="flex h-[100vh] flex-col justify-end px-6 pb-[72px]">
            <h1
              className="mb-3 font-bold tracking-tight text-white"
              style={{
                fontSize: "clamp(2rem,5vw,3rem)",
                fontWeight: 900,
                textShadow: "0 2px 8px rgba(0,0,0,0.85)",
                letterSpacing: "-0.025em",
              }}
            >
              Receipts, in motion.
            </h1>
            <p className="text-sm" style={{ color: "#bdbdc6", textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}>
              Scroll to follow the receipt ↓
            </p>
          </div>

          {/* Scroll-driven text blocks */}
          {BLOCKS.map((block, i) => {
            const scrollableVH = SCROLL_PAGES - 1;
            const centerVH = block.at * scrollableVH;

            return (
              <div
                key={i}
                ref={(el) => { blockRefs.current[i] = el; }}
                className="absolute"
                style={{
                  width: "62%",
                  maxWidth: 520,
                  opacity: 0,
                  willChange: "opacity, transform",
                  top: `calc(${centerVH * 100}vh + 50vh - ${CARD_HALF_H}px)`,
                  ...(block.side === "left" ? { left: 24 } : { right: 24 }),
                }}
              >
                <h2
                  className="mb-2.5 font-extrabold leading-tight text-white"
                  style={{
                    fontSize: "clamp(1.5rem,3vw,1.875rem)",
                    textShadow: "0 2px 8px rgba(0,0,0,0.85)",
                    ...(block.side === "right" ? { textAlign: "right" } : {}),
                  }}
                >
                  {block.headline}
                </h2>
                <p
                  className="text-sm leading-relaxed"
                  style={{
                    color: "#d6d6dc",
                    textShadow: "0 1px 6px rgba(0,0,0,0.85)",
                    ...(block.side === "right" ? { textAlign: "right" } : {}),
                  }}
                >
                  {block.subtext}
                </p>
              </div>
            );
          })}

          {/* End CTA — last viewport */}
          <div
            className="absolute inset-x-0 bottom-0 flex h-[100vh] flex-col items-center justify-center gap-5"
          >
            <p className="text-sm" style={{ color: "#bdbdc6", textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}>
              Invoice intelligence, done right.
            </p>
            <Link
              href="/login"
              className="pressable focus-ring rounded-md px-8 py-3.5 text-sm font-bold text-white transition-colors"
              style={{
                background: "var(--color-accent)",
                boxShadow: "0 8px 32px -8px color-mix(in srgb, var(--color-accent) 55%, transparent)",
              }}
            >
              Get Started →
            </Link>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {!ready && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4" style={{ background: "#0c0c0e" }}>
          <div className="h-0.5 w-48 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-100"
              style={{ width: `${loadProgress * 100}%`, background: "var(--color-accent)" }}
            />
          </div>
          <p className="text-xs" style={{ color: "#bdbdc6" }}>{Math.round(loadProgress * 100)}%</p>
        </div>
      )}
    </div>
  );
}
