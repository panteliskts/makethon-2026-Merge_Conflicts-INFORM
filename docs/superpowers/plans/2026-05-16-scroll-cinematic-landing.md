# 3-Screen Scroll Cinematic Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the INFORM landing page with a 3-screen cinematic where two receipt animations auto-play (and reverse) as transitions between screens, ending in a waitlist form.

**Architecture:** A fixed `100vh` client component (`ScrollCinematic`) owns a state machine (`screen` 0–2, `playing`, `direction`). Wheel/touch/keyboard gestures arm a transition; all 151 frames of a sequence render to a `<canvas>` on a timed `requestAnimationFrame` tween, then the state snaps. Frames are preloaded WebP images served from `public/frames/seq1` and `seq2`.

**Tech Stack:** Next.js 14 (app router), React 18, TypeScript, Tailwind. Frame conversion via a one-off Python/PIL script. No new npm dependencies.

---

## File Structure

- `frontend/scripts/build-frames.py` — **create** — one-off: 4K PNG → downscaled WebP.
- `frontend/public/frames/seq1/001.webp … 151.webp` — **generated** — transition A frames.
- `frontend/public/frames/seq2/001.webp … 151.webp` — **generated** — transition B frames.
- `frontend/public/frames/frame_*.jpg` — **delete** — old flat frame set.
- `frontend/src/lib/cinematic.ts` — **create** — pure helpers (cover-draw math, clamp/lerp, copy + sequence constants).
- `frontend/src/lib/useFrameSequence.ts` — **create** — preload/decode hook + `draw()`.
- `frontend/src/components/ScreenText.tsx` — **create** — side-configurable headline/subtext block.
- `frontend/src/components/WaitlistForm.tsx` — **create** — 3-field form with fake submit.
- `frontend/src/components/ScrollCinematic.tsx` — **create** — state machine, canvas, gestures, tween.
- `frontend/src/app/page.tsx` — **modify** — render `<ScrollCinematic />`; nav stays.

---

## Task 1: Frame conversion script and assets

**Files:**
- Create: `frontend/scripts/build-frames.py`
- Generate: `frontend/public/frames/seq1/*.webp`, `frontend/public/frames/seq2/*.webp`
- Delete: `frontend/public/frames/frame_*.jpg`

- [ ] **Step 1: Write the conversion script**

Create `frontend/scripts/build-frames.py`:

```python
#!/usr/bin/env python3
"""One-off: downscale extracted 4K PNG frames to ~1920px WebP for the web.

Expects frames already extracted to /tmp/newframes/frames and /tmp/newframes/frames2
(unzip Frames.zip there first). Run from the frontend/ directory:
    python3 scripts/build-frames.py
"""
import os
from PIL import Image

SRC = {
    "seq1": "/tmp/newframes/frames",
    "seq2": "/tmp/newframes/frames2",
}
TARGET_WIDTH = 1920
QUALITY = 82
OUT_ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "frames")


def convert(seq_name, src_dir):
    out_dir = os.path.join(OUT_ROOT, seq_name)
    os.makedirs(out_dir, exist_ok=True)
    names = sorted(f for f in os.listdir(src_dir) if f.endswith(".png"))
    for i, name in enumerate(names, start=1):
        img = Image.open(os.path.join(src_dir, name)).convert("RGB")
        scale = TARGET_WIDTH / img.width
        size = (TARGET_WIDTH, round(img.height * scale))
        img = img.resize(size, Image.LANCZOS)
        out = os.path.join(out_dir, f"{i:03d}.webp")
        img.save(out, "WEBP", quality=QUALITY, method=6)
    print(f"{seq_name}: wrote {len(names)} frames to {out_dir}")


if __name__ == "__main__":
    for seq_name, src_dir in SRC.items():
        convert(seq_name, src_dir)
```

- [ ] **Step 2: Extract source frames and run the script**

Run from `frontend/`:

```bash
mkdir -p /tmp/newframes && unzip -q -o ../../Frames.zip -d /tmp/newframes
python3 scripts/build-frames.py
```

Expected output:
```
seq1: wrote 151 frames to .../public/frames/seq1
seq2: wrote 151 frames to .../public/frames/seq2
```

- [ ] **Step 3: Verify output and delete the old flat frame set**

Run from `frontend/`:

```bash
ls public/frames/seq1 | wc -l   # expect 151
ls public/frames/seq2 | wc -l   # expect 151
rm public/frames/frame_*.jpg
```

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/build-frames.py frontend/public/frames
git commit -m "feat: add frame conversion script and webp sequences"
```

---

## Task 2: Pure cinematic helpers and copy constants

**Files:**
- Create: `frontend/src/lib/cinematic.ts`

- [ ] **Step 1: Write the helpers module**

Create `frontend/src/lib/cinematic.ts`:

```typescript
export const FRAME_COUNT = 151;
export const TRANSITION_MS = 1300;

export type SeqId = "seq1" | "seq2";

export function framePath(seq: SeqId, index1: number): string {
  return `/frames/${seq}/${String(index1).padStart(3, "0")}.webp`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ease-in-out cubic
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// object-fit: cover draw rect for an image into a canvas
export function coverRect(
  cw: number,
  ch: number,
  iw: number,
  ih: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

export interface ScreenCopy {
  eyebrow?: string;
  headline: string;
  subtext: string;
  side: "left" | "right";
}

export const SCREEN1: ScreenCopy = {
  eyebrow: "Invoice intelligence",
  headline: "Every receipt tells a story. We read it for you.",
  subtext:
    "INFORM turns paper receipts and invoices into structured, searchable data — instantly and accurately.",
  side: "left",
};

export const SCREEN2: ScreenCopy = {
  headline: "From crumpled paper to clean data.",
  subtext:
    "Snap it, scan it, forget it. INFORM extracts totals, line items, vendors and dates — verified and ready to reconcile.",
  side: "right",
};
```

- [ ] **Step 2: Typecheck**

Run from `frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/cinematic.ts
git commit -m "feat: add pure cinematic helpers and screen copy"
```

---

## Task 3: Frame sequence preload hook

**Files:**
- Create: `frontend/src/lib/useFrameSequence.ts`

- [ ] **Step 1: Write the hook**

Create `frontend/src/lib/useFrameSequence.ts`:

```typescript
import { useEffect, useRef, useState } from "react";
import { FRAME_COUNT, SeqId, framePath, coverRect } from "./cinematic";

type FrameStore = Record<SeqId, HTMLImageElement[]>;

function loadSeq(
  seq: SeqId,
  onOne: () => void,
): Promise<HTMLImageElement[]> {
  const imgs: HTMLImageElement[] = new Array(FRAME_COUNT);
  const tasks = Array.from({ length: FRAME_COUNT }, (_, i) => {
    const img = new Image();
    img.src = framePath(seq, i + 1);
    return new Promise<void>((resolve) => {
      const finish = () => {
        imgs[i] = img;
        onOne();
        resolve();
      };
      if (img.decode) img.decode().then(finish, finish);
      else {
        img.onload = finish;
        img.onerror = finish;
      }
    });
  });
  return Promise.all(tasks).then(() => imgs);
}

export function useFrameSequence() {
  const storeRef = useRef<FrameStore>({ seq1: [], seq2: [] });
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false); // seq1 fully decoded

  useEffect(() => {
    let cancelled = false;
    let done = 0;
    const total = FRAME_COUNT * 2;
    const onOne = () => {
      done++;
      if (!cancelled) setProgress(done / total);
    };

    loadSeq("seq1", onOne).then((imgs) => {
      if (cancelled) return;
      storeRef.current.seq1 = imgs;
      setReady(true);
    });
    loadSeq("seq2", onOne).then((imgs) => {
      if (!cancelled) storeRef.current.seq2 = imgs;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function draw(canvas: HTMLCanvasElement, seq: SeqId, index0: number) {
    const img = storeRef.current[seq][index0];
    if (!img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw === 0 || ch === 0) return;
    const { dx, dy, dw, dh } = coverRect(
      cw,
      ch,
      img.naturalWidth,
      img.naturalHeight,
    );
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  return { progress, ready, draw };
}
```

- [ ] **Step 2: Typecheck**

Run from `frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/useFrameSequence.ts
git commit -m "feat: add frame sequence preload hook"
```

---

## Task 4: ScreenText component

**Files:**
- Create: `frontend/src/components/ScreenText.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/ScreenText.tsx`. It renders an absolutely-positioned headline/subtext block; opacity and transform are set imperatively by the parent via the forwarded ref.

```tsx
import { forwardRef } from "react";
import { ScreenCopy } from "@/lib/cinematic";

export const ScreenText = forwardRef<HTMLDivElement, { copy: ScreenCopy }>(
  function ScreenText({ copy }, ref) {
    const right = copy.side === "right";
    return (
      <div
        ref={ref}
        className="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2"
        style={{
          width: "56%",
          maxWidth: 540,
          opacity: 0,
          willChange: "opacity, transform",
          ...(right ? { right: 48 } : { left: 48 }),
          textAlign: right ? "right" : "left",
        }}
      >
        {copy.eyebrow && (
          <p
            className="mb-3 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--color-accent)" }}
          >
            {copy.eyebrow}
          </p>
        )}
        <h2
          className="mb-3 font-extrabold leading-tight text-white"
          style={{
            fontSize: "clamp(1.75rem,3.6vw,2.75rem)",
            textShadow: "0 2px 10px rgba(0,0,0,0.85)",
            letterSpacing: "-0.02em",
          }}
        >
          {copy.headline}
        </h2>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "#d6d6dc", textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}
        >
          {copy.subtext}
        </p>
      </div>
    );
  },
);
```

- [ ] **Step 2: Typecheck**

Run from `frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ScreenText.tsx
git commit -m "feat: add ScreenText component"
```

---

## Task 5: WaitlistForm component

**Files:**
- Create: `frontend/src/components/WaitlistForm.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/WaitlistForm.tsx`:

```tsx
import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim()) {
      setError("All fields are required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setSubmitted(true); // fake submit — no backend
  }

  const inputCls =
    "w-full rounded-md border px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-[var(--color-accent)]";
  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.12)",
  };

  if (submitted) {
    return (
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-extrabold text-white">
          You&apos;re on the list.
        </h2>
        <p className="text-sm" style={{ color: "#bdbdc6" }}>
          We&apos;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-3">
      <div>
        <h2 className="mb-1.5 text-2xl font-extrabold text-white">
          Be first in line.
        </h2>
        <p className="mb-2 text-sm" style={{ color: "#bdbdc6" }}>
          Join the INFORM waitlist and get early access when we launch.
        </p>
      </div>
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
      />
      {error && (
        <p className="text-xs" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        className="pressable focus-ring rounded-md px-6 py-3 text-sm font-bold text-white transition-colors"
        style={{ background: "var(--color-accent)" }}
      >
        Join waitlist
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run from `frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/WaitlistForm.tsx
git commit -m "feat: add WaitlistForm component"
```

---

## Task 6: ScrollCinematic — state machine, canvas, transitions

**Files:**
- Create: `frontend/src/components/ScrollCinematic.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/ScrollCinematic.tsx`. This owns everything: canvas sizing, gesture capture, the frame tween, text fades, and renders the nav + overlays + loading screen.

```tsx
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
  clamp,
  easeInOut,
  lerp,
} from "@/lib/cinematic";

// screen 0 -> seq1 -> screen 1 -> seq2 -> screen 2
const SEQ_FOR_TRANSITION: SeqId[] = ["seq1", "seq2"];
const GESTURE_THRESHOLD = 24; // wheel deltaY / touch px to arm a transition
const TEXT_FADE_PORTION = 0.3; // last 30% of clip fades incoming text in

export default function ScrollCinematic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const text1Ref = useRef<HTMLDivElement>(null);
  const text2Ref = useRef<HTMLDivElement>(null);
  const form3Ref = useRef<HTMLDivElement>(null);

  const screenRef = useRef(0); // 0,1,2 — current settled screen
  const playingRef = useRef(false);
  const lastSeqRef = useRef<SeqId>("seq1");
  const lastIndexRef = useRef(0);

  const { progress, ready, draw } = useFrameSequence();
  const [hint, setHint] = useState(true);

  // --- canvas sizing -------------------------------------------------------
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    draw(canvas, lastSeqRef.current, lastIndexRef.current);
  }, [draw]);

  // --- per-screen text visibility -----------------------------------------
  // applyText: set opacity/translateX for all 3 overlays given a continuous
  // position p in [0,2] (0=screen0, 1=screen1, 2=screen2).
  const applyText = useCallback((p: number) => {
    const set = (
      el: HTMLDivElement | null,
      vis: number,
      side: "left" | "right",
    ) => {
      if (!el) return;
      const off = side === "left" ? -60 : 60;
      el.style.opacity = String(vis);
      el.style.transform = `translateY(-50%) translateX(${lerp(off, 0, vis)}px)`;
    };
    // screen 0 text visible only at p===0, fades out over first 30% of seq1
    set(text1Ref.current, clamp(1 - p / TEXT_FADE_PORTION, 0, 1), "left");
    // screen 1 text visible at p===1: fades in over last 30% of seq1,
    // fades out over first 30% of seq2
    const v2 =
      p <= 1
        ? clamp((p - (1 - TEXT_FADE_PORTION)) / TEXT_FADE_PORTION, 0, 1)
        : clamp(1 - (p - 1) / TEXT_FADE_PORTION, 0, 1);
    set(text2Ref.current, v2, "right");
    // screen 2 form: fades in over last 30% of seq2
    const v3 = clamp((p - (2 - TEXT_FADE_PORTION)) / TEXT_FADE_PORTION, 0, 1);
    if (form3Ref.current) {
      form3Ref.current.style.opacity = String(v3);
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

      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const start = performance.now();

      const step = (now: number) => {
        const raw = reduced ? 1 : clamp((now - start) / TRANSITION_MS, 0, 1);
        const eased = easeInOut(raw);
        // forward: 0->150 ; reverse: 150->0
        const fwd = dir === 1 ? eased : 1 - eased;
        const index = Math.round(fwd * (FRAME_COUNT - 1));
        draw(canvas, seq, index);
        lastSeqRef.current = seq;
        lastIndexRef.current = index;
        // continuous position p across the whole 0..2 range
        const base = dir === 1 ? from : to; // transition spans [base, base+1]
        applyText(base + fwd);

        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          screenRef.current = to;
          playingRef.current = false;
        }
      };
      requestAnimationFrame(step);
    },
    [draw, applyText],
  );

  // --- gesture capture -----------------------------------------------------
  useEffect(() => {
    if (!ready) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (playingRef.current) return;
      if (e.deltaY > GESTURE_THRESHOLD) play(1);
      else if (e.deltaY < -GESTURE_THRESHOLD) play(-1);
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (playingRef.current) return;
      const dy = touchStartY - e.touches[0].clientY;
      if (dy > GESTURE_THRESHOLD) play(1);
      else if (dy < -GESTURE_THRESHOLD) play(-1);
    };

    const onKey = (e: KeyboardEvent) => {
      if (playingRef.current) return;
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
    draw(canvasRef.current!, "seq1", 0);
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

      {/* Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0,0,0,0.28)" }} />

      {/* Screen text overlays */}
      <ScreenText ref={text1Ref} copy={SCREEN1} />
      <ScreenText ref={text2Ref} copy={SCREEN2} />

      {/* Screen 3 — waitlist form */}
      <div
        ref={form3Ref}
        className="absolute right-[48px] top-1/2 z-20 -translate-y-1/2"
        style={{ opacity: 0, pointerEvents: "none", willChange: "opacity" }}
      >
        <WaitlistForm />
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
```

- [ ] **Step 2: Typecheck**

Run from `frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ScrollCinematic.tsx
git commit -m "feat: add ScrollCinematic state machine component"
```

---

## Task 7: Wire ScrollCinematic into the landing page

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Replace page.tsx contents**

Replace the entire contents of `frontend/src/app/page.tsx` with:

```tsx
import ScrollCinematic from "@/components/ScrollCinematic";

export default function LandingPage() {
  return <ScrollCinematic />;
}
```

- [ ] **Step 2: Typecheck and build**

Run from `frontend/`:
```bash
npx tsc --noEmit
npm run build
```
Expected: typecheck clean; build succeeds with no errors.

- [ ] **Step 3: Manual browser verification**

Run `npm run dev` from `frontend/`, open the landing page, and confirm:
- Loading bar reaches 100%, then screen 1 shows (receipt right, text left).
- One scroll-down gesture auto-plays transition A; receipt moves right→left; on completion text 2 appears on the right.
- Another scroll-down auto-plays transition B (receipt into register); waitlist form fades in.
- Scroll-up at each stage plays the transition in reverse and returns to the prior screen.
- The waitlist form submits to an inline "You're on the list." success state.
- No console errors; no native page scrolling occurs.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: wire ScrollCinematic into landing page"
```

---

## Self-Review Notes

- **Spec coverage:** Screens 1–3 (Tasks 4–6), transitions A/B + reverse + auto-play tween (Task 6 `play`), text fades (Task 6 `applyText`), waitlist form with Full name/Email/Company + fake submit (Task 5), frame WebP pipeline + old-asset deletion (Task 1), reduced-motion (Task 6 `reduced`), canvas cover math (Task 2 `coverRect`), preload + loading overlay (Task 3 + Task 6). All spec sections mapped.
- **Type consistency:** `SeqId`, `framePath`, `coverRect`, `draw(canvas, seq, index0)`, `ScreenCopy`, `SCREEN1/SCREEN2`, `FRAME_COUNT`, `TRANSITION_MS`, `easeInOut`, `clamp`, `lerp` are defined in Tasks 2–3 and consumed with matching signatures in Tasks 3–6.
- **`page.tsx.bak`** in the app dir is pre-existing and left untouched (out of scope).
- No test framework exists in this project; verification is via `tsc --noEmit`, `npm run build`, and the explicit manual browser checklist in Task 7 — appropriate for a canvas/gesture visual feature.
```
