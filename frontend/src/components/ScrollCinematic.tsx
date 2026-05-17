"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle, LangToggle } from "@/components/NavControls";
import { ScreenText } from "@/components/ScreenText";
import { WaitlistForm } from "@/components/WaitlistForm";
import { useFrameSequence } from "@/lib/useFrameSequence";
import {
  FRAME_COUNT,
  TRANSITION_MS,
  SCREEN1,
  SCREEN2,
  SeqId,
  FrameView,
  clamp,
  lerp,
  easeSmoothStart,
} from "@/lib/cinematic";

// screen 0 -> seq1 -> screen 1 -> seq2 -> screen 2
const SEQ_FOR_TRANSITION: SeqId[] = ["seq1", "seq2"];
const GESTURE_THRESHOLD = 24; // touch px to arm a transition
const WHEEL_TRIGGER = 60; // accumulated wheel deltaY needed to arm a transition
const MOBILE_MAX_WIDTH = 768; // viewport widths below this use the mobile view
// Mobile crop tuning. The 16:9 frames overflow a portrait screen, so the crop
// pans with the receipt. panX: 0 = show image's left, 1 = show its right.
const MOBILE_PAN_START = 0.72; // screen 1 — keeps the receipt to the right
const MOBILE_PAN_MID = 0.3; // screen 2 — keeps the receipt to the left
const MOBILE_PAN3_SPEED = 0.55; // transition-B pan/zoom completes in this fraction

// Mobile crop for the continuous receipt position `rp` (0 = screen 1 …
// 2 = screen 3): receipt-right on screen 1, receipt-left on screen 2, then
// centred and slightly zoomed on screen 3.
function mobileView(rp: number): FrameView {
  if (rp <= 1) {
    return {
      panX: lerp(MOBILE_PAN_START, MOBILE_PAN_MID, rp),
      panY: lerp(0, 1, rp),
      zoom: 1,
    };
  }
  const t = clamp((rp - 1) / MOBILE_PAN3_SPEED, 0, 1);
  return {
    panX: lerp(MOBILE_PAN_MID, 0.5, t),
    panY: lerp(1, 0.5, t),
    zoom: lerp(1, 1.25, t),
  };
}

// Each text block moves on the SAME timeline as the background receipt
// (driven by `p`): it rises up from below into the centre, then continues
// up and arcs out to its own side as the next transition plays. Reversing
// the scroll reverses the motion, since it is a pure function of `p`.
const TEXT_RISE_VH = 0.5; // vertical swing distance, as a fraction of innerHeight
const TEXT_SLIDE_VW = 0.55; // sideways exit distance, as a fraction of innerWidth
const TEXT_SWING = 0.6; // text completes its swing in this fraction of the transition

export default function ScrollCinematic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const text1Ref = useRef<HTMLDivElement>(null);
  const text2Ref = useRef<HTMLDivElement>(null);
  const form3Ref = useRef<HTMLDivElement>(null);

  const screenRef = useRef(0); // 0,1,2 — current settled screen
  const playingRef = useRef(false);
  const lastSeqRef = useRef<SeqId>("seq1");
  const lastIndexRef = useRef(0);
  const lastRpRef = useRef(0); // continuous receipt position, for mobile pan
  const isMobileRef = useRef(false); // current viewport is mobile-width
  const cooldownUntilRef = useRef(0); // ignore input until this timestamp
  const lastWheelRef = useRef(0); // timestamp of previous wheel event
  const wheelAccumRef = useRef(0); // accumulated wheel deltaY for current gesture
  const touchArmedRef = useRef(false); // one transition per touch swipe

  const { progress, ready, draw } = useFrameSequence();
  const [hint, setHint] = useState(true);

  // --- canvas sizing -------------------------------------------------------
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    isMobileRef.current = window.innerWidth < MOBILE_MAX_WIDTH;
    const view = isMobileRef.current ? mobileView(lastRpRef.current) : undefined;
    draw(canvas, lastSeqRef.current, lastIndexRef.current, view);
  }, [draw]);

  // --- per-screen text visibility -----------------------------------------
  // applyText: set opacity/translateX for all 3 overlays given a continuous
  // position p in [0,2] (0=screen0, 1=screen1, 2=screen2).
  const applyText = useCallback((p: number) => {
    const rise = window.innerHeight * TEXT_RISE_VH;
    const slide = window.innerWidth * TEXT_SLIDE_VW;
    // place(el, d, side, swingX): position a block given its signed progress
    // d (−1 = entering from below, 0 = centred, +1 = exited up & out).
    const place = (
      el: HTMLDivElement | null,
      d: number,
      side: "left" | "right",
      swingX = true,
      centered = false,
      anchorBottom = false,
    ) => {
      if (!el) return 0;
      // Energetic, not a slow fade: fully opaque across the central swing,
      // fading only in the outer quarter on each side.
      const vis = clamp((1 - Math.abs(d)) / 0.5, 0, 1);
      const dirX = side === "left" ? -1 : 1;
      // Parabolic swing arc: x is symmetric (d²) so it returns to its side at
      // both ends; y is antisymmetric (-d) so it rises from below up through
      // the top. swingX=false → straight vertical, rising from below only.
      const tx = swingX ? dirX * slide * d * d : 0;
      const ty = -d * rise;
      // `centered` blocks are pinned to the horizontal centre (left-1/2).
      const xExpr = centered ? `calc(-50% + ${tx}px)` : `${tx}px`;
      // `anchorBottom` blocks are pinned to the screen bottom (no -50% Y).
      const yExpr = anchorBottom ? `${ty}px` : `calc(-50% + ${ty}px)`;
      el.style.opacity = String(vis);
      el.style.transform = `translateX(${xExpr}) translateY(${yExpr})`;
      return vis;
    };

    // text1 (screen 0): straightforward.
    place(text1Ref.current, p - 0, "left");

    // Transition A (p∈[0,1]) is concurrent: text1 swings out as text2 swings
    // in. Transition B (p∈[1,2]) is sequential: text2 fully exits over the
    // first half, then the form rises in over the second half — so the form
    // waits for screen 2, and on reverse the form drops out before text2
    // returns. f is the progress through transition B.
    const f = p - 1;
    const d2 = p <= 1 ? p - 1 : clamp(2 * f, 0, 1);
    place(text2Ref.current, d2, "right");

    // The contact form rises straight up from below, horizontally centred
    // and pinned just above the screen bottom.
    const dForm = p <= 1 ? -1 : clamp(2 * f - 1, 0, 1) - 1;
    const v3 = place(form3Ref.current, dForm, "right", false, true, true);
    if (form3Ref.current) {
      form3Ref.current.style.pointerEvents = v3 > 0.99 ? "auto" : "none";
    }
  }, []);

  // --- transition tween ----------------------------------------------------
  const play = useCallback(
    (dir: 1 | -1) => {
      const from = screenRef.current;
      const to = from + dir;
      if (to < 0 || to > 2 || playingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const seq = SEQ_FOR_TRANSITION[dir === 1 ? from : to];
      playingRef.current = true;
      setHint(false);

      const base = dir === 1 ? from : to; // transition spans [base, base+1]

      // start is captured from the FIRST animation-frame timestamp, not from
      // performance.now(), so the tween can't collapse if that frame is late.
      let start: number | null = null;

      const step = (now: number) => {
        if (start === null) start = now;
        const raw = clamp((now - start) / TRANSITION_MS, 0, 1);
        const eased = easeSmoothStart(raw);
        // forward: 0->150 ; reverse: 150->0
        const fwd = dir === 1 ? eased : 1 - eased;
        const index = Math.round(fwd * (FRAME_COUNT - 1));
        const rp = base + fwd; // continuous receipt position across 0..2
        lastRpRef.current = rp;
        const view = isMobileRef.current ? mobileView(rp) : undefined;
        draw(canvas, seq, index, view);
        lastSeqRef.current = seq;
        lastIndexRef.current = index;
        // Text leads the receipt: it completes its full swing within the
        // first TEXT_SWING fraction of the transition, then holds settled
        // while the remaining background frames play out.
        const textProg = clamp(eased / TEXT_SWING, 0, 1);
        applyText(base + (dir === 1 ? textProg : 1 - textProg));

        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          screenRef.current = to;
          playingRef.current = false;
          cooldownUntilRef.current = performance.now() + 250;
        }
      };
      requestAnimationFrame(step);
    },
    [draw, applyText],
  );

  // --- gesture capture -----------------------------------------------------
  useEffect(() => {
    if (!ready) return;

    const blocked = () =>
      playingRef.current || performance.now() < cooldownUntilRef.current;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      const gap = now - lastWheelRef.current;
      lastWheelRef.current = now;
      // A pause between events starts a fresh gesture.
      if (gap > 220) wheelAccumRef.current = 0;
      // Ignore (and don't accumulate) input during a transition / cooldown.
      if (blocked()) {
        wheelAccumRef.current = 0;
        return;
      }
      // Accumulate scroll distance; arm a transition once it crosses the
      // threshold, then reset so the rest of the gesture must re-accumulate.
      wheelAccumRef.current += e.deltaY;
      if (wheelAccumRef.current > WHEEL_TRIGGER) {
        wheelAccumRef.current = 0;
        play(1);
      } else if (wheelAccumRef.current < -WHEEL_TRIGGER) {
        wheelAccumRef.current = 0;
        play(-1);
      }
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      touchArmedRef.current = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!touchArmedRef.current || blocked()) return;
      const dy = touchStartY - e.touches[0].clientY;
      if (dy > GESTURE_THRESHOLD) {
        touchArmedRef.current = false; // one transition per swipe
        play(1);
      } else if (dy < -GESTURE_THRESHOLD) {
        touchArmedRef.current = false;
        play(-1);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (blocked()) return;
      if (e.key === "ArrowDown" || e.key === " ") play(1);
      else if (e.key === "ArrowUp") play(-1);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [ready, play]);

  // --- initial draw + resize ----------------------------------------------
  useEffect(() => {
    if (!ready) return;
    resize();
    draw(
      canvasRef.current!,
      "seq1",
      0,
      isMobileRef.current ? mobileView(0) : undefined,
    );
    applyText(0);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [ready, resize, draw, applyText]);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ backgroundColor: "#0c0c0e" }}>
      {/* Nav */}
      <nav
        className="absolute inset-x-0 top-0 z-50 flex h-[60px] items-center justify-between border-b px-6"
        style={{
          borderColor: "rgba(255,255,255,0.06)",
          background: "rgba(12,12,14,0.75)",
          backdropFilter: "blur(16px) saturate(1.4)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
            style={{ background: "var(--color-accent)" }}
          >
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-white">Invo.ai</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
          <Link
            href="/pricing"
            className="focus-ring rounded-md px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="pressable focus-ring rounded-md px-4 py-2 text-sm font-bold text-white transition-colors"
            style={{ background: "var(--color-accent)" }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.28)" }} />

      {/* Screen text overlays */}
      <ScreenText ref={text1Ref} copy={SCREEN1} />
      <ScreenText ref={text2Ref} copy={SCREEN2} />

      {/* Screen 3 — waitlist form */}
      <div
        ref={form3Ref}
        className="absolute bottom-[3vh] left-1/2 z-20 -translate-x-1/2"
        style={{ opacity: 0, pointerEvents: "none", willChange: "opacity" }}
      >
        <div
          className="rounded-xl px-8 py-7"
          style={{ background: "rgba(12,12,14,0.72)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        >
          <WaitlistForm />
        </div>
      </div>

      {/* Scroll hint */}
      {hint && ready && (
        <p
          className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2 text-xs"
          style={{ color: "rgba(189,189,198,0.7)", textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}
        >
          Scroll to explore ↓
        </p>
      )}

      {/* Loading overlay */}
      {!ready && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4"
          style={{ background: "#0c0c0e" }}
        >
          <div className="h-0.5 w-48 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-100"
              style={{ width: `${progress * 100}%`, background: "var(--color-accent)" }}
            />
          </div>
          <p className="text-xs" style={{ color: "#bdbdc6" }}>
            {Math.round(progress * 100)}%
          </p>
        </div>
      )}
    </div>
  );
}
