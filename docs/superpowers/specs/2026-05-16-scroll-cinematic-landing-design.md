# 3-Screen Scroll Cinematic — INFORM Landing Page

**Date:** 2026-05-16
**Status:** Approved design

## Goal

Replace the current scroll-scrubbed landing animation with a 3-screen cinematic.
Two receipt animations (`frames/` and `frames2/`) act as transitions between three
fixed content screens. Scrolling triggers a transition to auto-play at a fixed
speed and then snap to the next screen; scrolling up plays the transition in
reverse and snaps back.

## Source assets

`Frames.zip` (at repo parent dir) contains:

- `frames/` — 151 PNG frames, 4096×2304. Receipt curls from the right side of
  frame to the left side.
- `frames2/` — 151 PNG frames, 4096×2304. Receipt rests in an open cash-register
  slot, then the slot empties (last frame: empty slot).

`frames/frame_000151.png` and `frames2/frame_000001.png` are near-identical
(receipt on the left), giving visual continuity between the two clips.

## Screen / transition structure

```
SCREEN 1 ──[transition A: frames/]──> SCREEN 2 ──[transition B: frames2/]──> SCREEN 3
```

| State        | Background frame            | Content                                   |
|--------------|-----------------------------|--------------------------------------------|
| Screen 1     | `seq1` frame 1              | Headline + subtext, LEFT side. Nav + hint. |
| Transition A | `seq1` frames 1→151         | Receipt moves right→left.                  |
| Screen 2     | `seq1` frame 151            | Headline + subtext, RIGHT side.            |
| Transition B | `seq2` frames 1→151         | Receipt goes into register, slot empties.  |
| Screen 3     | `seq2` frame 151            | Waitlist form (center/right).              |

## Play mechanic

- The page is a fixed `100vh` surface. Native scroll is disabled; `wheel`,
  `touchstart/move/end`, and keyboard (arrows/space) gestures are intercepted.
- State machine: `screen` (0,1,2), `playing` (bool), `direction` (1 | -1).
- A downward gesture past a small threshold while idle on screen N (N<2) **arms
  and plays** the transition to screen N+1: all 151 frames of that sequence are
  drawn to the canvas on a timed tween (~1.3 s, ease-in-out) via
  `requestAnimationFrame`. On completion, `screen` becomes N+1.
- An upward gesture while idle on screen N (N>0) plays the previous transition
  in **reverse** (frame 151→1) and snaps `screen` to N-1.
- All input is locked while `playing` is true.
- Text: the outgoing screen's text block fades/translates out at the start of a
  transition; the incoming screen's text fades/translates in over the final
  ~30% of the clip. Reverse direction mirrors this.

## Components

All under `frontend/src/`.

- **`components/ScrollCinematic.tsx`** (client) — owns the state machine, canvas
  ref, gesture listeners, and the `requestAnimationFrame` frame tween. Renders
  the canvas, the three `ScreenText`/`WaitlistForm` overlays, the nav, and the
  loading overlay.
- **`lib/useFrameSequence.ts`** — hook that preloads and decodes both frame
  sequences. Exposes `draw(seq, index, canvas)` and a `progress` value (0–1) for
  the loading overlay. Gates readiness on full decode of `seq1` (seq2 may finish
  loading in the background).
- **`components/ScreenText.tsx`** — headline + subtext block. Props: `side`
  (`left` | `right`), `headline`, `subtext`, `eyebrow?`. Opacity and translateX
  are set imperatively by `ScrollCinematic` based on transition progress.
- **`components/WaitlistForm.tsx`** — form with Full name, Email, Company fields.
  Local validation (all required, email format). Submit is a no-op: shows an
  inline success state. No backend call.
- **`app/page.tsx`** — slimmed to render `<ScrollCinematic />`.

## Canvas rendering

Reuse the current `object-fit: cover` math: scale = `max(cw/iw, ch/ih)`, center
the drawn image, `clearRect` before each `drawImage`. Canvas sized to
`clientWidth/Height × devicePixelRatio`; redraw current frame on resize.

## Frame asset pipeline

One-off build script `frontend/scripts/build-frames.mjs` (run manually, not in
CI):

- Reads extracted `frames/` and `frames2/` PNGs.
- Downscales to ~1920px wide, converts to WebP (quality ~82).
- Writes `frontend/public/frames/seq1/001.webp` … `151.webp` and
  `frontend/public/frames/seq2/001.webp` … `151.webp` (3-digit, 1-indexed).
- The old flat `frontend/public/frames/frame_NNN.jpg` files are deleted.

`useFrameSequence` loads `/frames/seq1/${NNN}.webp` and `/frames/seq2/${NNN}.webp`.

## Copy (draft — user may tweak)

**Screen 1 (left):**
- Eyebrow: `Invoice intelligence`
- Headline: `Every receipt tells a story. We read it for you.`
- Subtext: `INFORM turns paper receipts and invoices into structured, searchable data — instantly and accurately.`

**Screen 2 (right):**
- Headline: `From crumpled paper to clean data.`
- Subtext: `Snap it, scan it, forget it. INFORM extracts totals, line items, vendors and dates — verified and ready to reconcile.`

**Screen 3 (waitlist form):**
- Headline: `Be first in line.`
- Subtext: `Join the INFORM waitlist and get early access when we launch.`
- Fields: Full name, Email, Company
- Submit button: `Join waitlist`
- Success state: `You're on the list. We'll be in touch.`

## Edge cases & risks

- **Preload weight:** ~302 images. Keep the existing loading overlay; block
  first interaction until `seq1` is fully decoded.
- **Mid-transition resize:** redraw the current tween frame on resize.
- **Rapid gestures:** ignored while `playing`; threshold + lock prevents
  double-trigger.
- **Reduced motion:** if `prefers-reduced-motion`, jump directly to the target
  frame (skip the tween) and snap.
- **Mobile:** touch gestures map to the same arm/play logic as wheel.

## Out of scope

- Real waitlist backend / persistence.
- Changes to `/login`, `/dashboard`, or other routes.
- Analytics on the funnel.
