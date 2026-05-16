export const FRAME_COUNT = 151;
export const TRANSITION_MS = 2000;

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

// Smooth ramp-up over the first quarter, then constant (linear) speed to the
// end — no easing/deceleration at the finish.
const RAMP = 0.25;
export function easeSmoothStart(t: number): number {
  const a = 1 / (RAMP * (2 - RAMP)); // makes the curve reach exactly 1 at t=1
  if (t < RAMP) return a * t * t; // quadratic ramp, zero starting velocity
  return 2 * a * RAMP * (t - RAMP) + a * RAMP * RAMP; // linear continuation
}

// How the cover-fitted frame is positioned within the canvas.
export interface FrameView {
  panX: number; // 0 = left edge, 0.5 = centred, 1 = right edge
  panY: number; // 0 = top edge, 0.5 = centred, 1 = bottom edge
  zoom: number; // 1 = plain cover, >1 = zoomed in
}

// object-fit: cover draw rect for an image into a canvas. `view` pans/zooms
// the crop; omitted → centred plain cover.
export function coverRect(
  cw: number,
  ch: number,
  iw: number,
  ih: number,
  view?: FrameView,
): { dx: number; dy: number; dw: number; dh: number } {
  const panX = view?.panX ?? 0.5;
  const panY = view?.panY ?? 0.5;
  const zoom = view?.zoom ?? 1;
  const scale = Math.max(cw / iw, ch / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  return { dx: (cw - dw) * panX, dy: (ch - dh) * panY, dw, dh };
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
