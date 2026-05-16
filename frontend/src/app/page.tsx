"use client";

import Link from "next/link";
import {
  motion, useMotionValue, useSpring, useInView,
  useTransform, animate,
} from "framer-motion";
import { memo, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/useLocale";
import { ThemeToggle, LangToggle } from "@/components/NavControls";

/* ─── Expo-out easing (impeccable rule) ─────────────────────── */
const E: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ─── Spotlight border card (taste-skill §8) ────────────────── */
function SpotlightCard({
  children,
  className = "",
  innerClass = "",
}: {
  children: React.ReactNode;
  className?: string;
  innerClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-999);
  const mouseY = useMotionValue(-999);

  return (
    <motion.div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        mouseX.set(e.clientX - r.left);
        mouseY.set(e.clientY - r.top);
      }}
      onMouseLeave={() => { mouseX.set(-999); mouseY.set(-999); }}
      className={`group relative overflow-hidden rounded-3xl border border-card-border bg-card ${className}`}
      /* double-bezel — outer border + inner highlight */
      style={{
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.04)",
      }}
    >
      {/* spotlight layer — hardware-accelerated, no layout paint */}
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-300"
        style={{
          opacity: useTransform(mouseX, [-999, 0], [0, 1]),
          background: useTransform(
            [mouseX, mouseY],
            ([x, y]: number[]) =>
              `radial-gradient(260px circle at ${x}px ${y}px, rgba(212,87,42,0.08), transparent 70%)`,
          ),
        }}
      />
      <div className={`relative z-10 ${innerClass}`}>{children}</div>
    </motion.div>
  );
}

/* ─── Magnetic button (taste-skill §4) — isolated client leaf ── */
const MagneticBtn = memo(function MagneticBtn({
  children,
  href,
  primary = true,
}: {
  children: React.ReactNode;
  href: string;
  primary?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 280, damping: 22 });
  const sy = useSpring(y, { stiffness: 280, damping: 22 });

  return (
    <motion.a
      ref={ref}
      href={href}
      style={primary ? { x: sx, y: sy, background: "var(--color-accent)" } : { x: sx, y: sy }}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.20);
        y.set((e.clientY - r.top - r.height / 2) * 0.20);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}
      whileTap={{ scale: 0.97, y: 1 }}
      className={
        primary
          ? "inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl text-sm font-semibold tracking-tight text-white transition-colors pressable"
          : "inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl text-sm font-semibold tracking-tight border border-card-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors pressable"
      }
    >
      {children}
    </motion.a>
  );
});

/* ─── Scroll reveal ──────────────────────────────────────────── */
function Reveal({
  children,
  delay = 0,
  y = 20,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-72px" });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.58, ease: E, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Perpetual typewriter — isolated leaf (taste-skill §9B) ─── */
const TypewriterCard = memo(function TypewriterCard() {
  const prompts = [
    "What is the total amount due?",
    "Who is the vendor on this invoice?",
    "What are the payment terms?",
    "List all line items with amounts.",
  ];
  const [idx, setIdx] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [phase, setPhase] = useState<"typing" | "pause" | "erasing">("typing");

  useEffect(() => {
    const full = prompts[idx];
    if (phase === "typing") {
      if (displayed.length < full.length) {
        const t = setTimeout(() => setDisplayed(full.slice(0, displayed.length + 1)), 38);
        return () => clearTimeout(t);
      } else {
        const t = setTimeout(() => setPhase("pause"), 1600);
        return () => clearTimeout(t);
      }
    }
    if (phase === "pause") {
      const t = setTimeout(() => setPhase("erasing"), 200);
      return () => clearTimeout(t);
    }
    if (phase === "erasing") {
      if (displayed.length > 0) {
        const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 18);
        return () => clearTimeout(t);
      } else {
        setIdx((i) => (i + 1) % prompts.length);
        setPhase("typing");
      }
    }
  });

  return (
    <div className="flex-1 h-8 rounded-xl border border-card-border bg-sidebar flex items-center px-3 gap-1.5 overflow-hidden">
      <span className="text-xs text-text-secondary truncate">{displayed}</span>
      <span className="w-[1px] h-3 bg-accent animate-pulse shrink-0" />
    </div>
  );
});

/* ─── Perpetual status indicator (taste-skill §9C) ─────────────  */
const LiveStatusCard = memo(function LiveStatusCard() {
  const [badge, setBadge] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setBadge(true);
      setTimeout(() => setBadge(false), 2800);
    }, 5000);
    setBadge(true);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2.5 relative">
      <div className="relative w-2 h-2">
        <span className="block w-2 h-2 rounded-full bg-emerald-500" />
        <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
      </div>
      <span className="text-xs font-medium text-text-primary">Pipeline live</span>
      <motion.div
        animate={badge ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
        className="absolute -top-3 left-4 bg-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-none"
      >
        RAG ready
      </motion.div>
    </div>
  );
});

/* ─── App UI preview ──────────────────────────────────────────── */
function UIPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.75, ease: E, delay: 0.25 }}
      className="relative w-full max-w-[520px]"
    >
      {/* diffuse glow — fixed pseudo, never repaint */}
      <div
        className="absolute -inset-8 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--color-accent) 12%, transparent) 0%, transparent 70%)", filter: "blur(32px)" }}
      />
      {/* outer shell — double bezel */}
      <div className="relative rounded-3xl border border-card-border overflow-hidden"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 32px 80px -24px rgba(0,0,0,0.22)" }}>
        {/* inner bezel accent line */}
        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent 0%, var(--color-accent) 40%, transparent 100%)", opacity: 0.4 }} />

        {/* title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border bg-sidebar">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
          </div>
          <div className="flex gap-1 ml-3">
            {["Chat", "Reconcile", "Metrics"].map((t, i) => (
              <span key={t}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${i === 0 ? "text-white" : "text-text-secondary"}`}
                style={i === 0 ? { background: "var(--color-accent)" } : undefined}>
                {t}
              </span>
            ))}
          </div>
          <div className="ml-auto">
            <LiveStatusCard />
          </div>
        </div>

        <div className="flex h-60">
          {/* chat */}
          <div className="flex-1 border-r border-card-border p-4 flex flex-col gap-3">
            <motion.div className="flex justify-end"
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.65, duration: 0.4, ease: E }}>
              <div className="text-white text-xs rounded-2xl rounded-br-sm px-3.5 py-2.5 max-w-[75%]"
                style={{ background: "var(--color-accent)" }}>
                What is the total amount due?
              </div>
            </motion.div>
            <motion.div className="flex justify-start"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.95, duration: 0.4, ease: E }}>
              <div className="bg-sidebar border border-card-border text-text-primary text-xs rounded-2xl rounded-bl-sm px-3.5 py-2.5 max-w-[88%]">
                <p className="leading-relaxed">Total due is <strong className="text-text-primary">€4,250.00</strong> — totals block, page 1.</p>
                <div className="mt-2 flex gap-1 flex-wrap">
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium border"
                    style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", borderColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)", color: "var(--color-accent)" }}>
                    p.1 · totals
                  </span>
                </div>
              </div>
            </motion.div>
            <div className="mt-auto flex gap-2 items-center">
              <TypewriterCard />
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--color-accent)" }}>
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </div>
            </div>
          </div>

          {/* pdf */}
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 bg-background">
            <div className="w-full max-w-[142px] bg-card border border-card-border rounded-xl p-3 space-y-2">
              {([0.72, 0.48, null, 1, 1, "hl", 0.58] as const).map((w, i) =>
                w === null
                  ? <div key={i} className="h-px bg-card-border" />
                  : w === "hl"
                  ? (
                    <motion.div key={i}
                      animate={{ opacity: [0.45, 1, 0.45] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
                      className="h-4 rounded-lg border"
                      style={{ background: "color-mix(in srgb, var(--color-accent) 16%, transparent)", borderColor: "color-mix(in srgb, var(--color-accent) 45%, transparent)" }} />
                  )
                  : <div key={i} className="h-1.5 rounded-full bg-card-border" style={{ width: `${(w as number) * 100}%` }} />
              )}
            </div>
            <p className="text-[10px] font-semibold tracking-tight" style={{ color: "var(--color-accent)" }}>
              Source highlighted
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Feature icons ──────────────────────────────────────────── */
const ICONS = [
  <svg key="a" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  <svg key="b" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>,
  <svg key="c" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  <svg key="d" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  <svg key="e" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
];

/* ─── Page ───────────────────────────────────────────────────── */
export default function LandingPage() {
  const { t } = useLocale();
  const L = t.landing;

  return (
    <div className="min-h-[100dvh] bg-background text-text-primary overflow-x-hidden">

      {/* ── Sticky nav ──────────────────────────────────────── */}
      <nav
        className="fixed top-0 inset-x-0 z-50 border-b border-card-border"
        style={{ background: "color-mix(in srgb, var(--color-bg) 88%, transparent)", backdropFilter: "blur(16px) saturate(1.4)" }}
      >
        <div className="max-w-7xl mx-auto px-6 h-[60px] flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "var(--color-accent)", boxShadow: "0 4px 16px -4px color-mix(in srgb, var(--color-accent) 50%, transparent)" }}>
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-semibold tracking-tight text-text-primary">INFORM</span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LangToggle />
            <Link href="/login"
              className="pressable focus-ring px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ background: "var(--color-accent)" }}>
              {t.nav.signin}
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero — asymmetric split (taste-skill: variance 8) ── */}
      <section className="pt-32 pb-28 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-16 items-center">
        <div>
          {/* badge */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: E }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold mb-10"
            style={{
              background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
              borderColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
              color: "var(--color-accent)",
            }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
            {L.badge}
          </motion.div>

          {/* headline — staggered per-line */}
          <div className="mb-7 space-y-1">
            {L.headline.map((line, i) => (
              <motion.h1 key={i}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.62, ease: E, delay: 0.08 + i * 0.1 }}
                className="text-[clamp(2.6rem,5vw,4.5rem)] font-bold tracking-[-0.025em] leading-[1.02]"
                style={{ color: i === L.headline.length - 1 ? "var(--color-accent)" : "var(--color-text-primary)" }}
              >{line}</motion.h1>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: E, delay: 0.36 }}
            className="text-[1.0625rem] leading-relaxed mb-10 max-w-[52ch]"
            style={{ color: "var(--color-text-secondary)" }}
          >{L.sub}</motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: E, delay: 0.46 }}
            className="flex flex-wrap gap-3"
          >
            <MagneticBtn href="/login" primary>{L.cta} →</MagneticBtn>
            <MagneticBtn href="#features" primary={false}>{L.ctaGhost}</MagneticBtn>
          </motion.div>

          {/* social strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.65, duration: 0.45 }}
            className="mt-14 pt-10 border-t border-card-border flex items-center gap-4"
          >
            <div className="flex -space-x-2.5">
              {["#d4572a","#8aaf5a","#e9a050","#4a90c4"].map((c, i) => (
                <div key={i} className="w-9 h-9 rounded-full border-2 border-background ring-1 ring-card-border"
                  style={{ background: c }} />
              ))}
            </div>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{L.socialProof}</p>
          </motion.div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <UIPreview />
        </div>
      </section>

      {/* ── Bento features — 2-col zig-zag (not 3-equal BANNED) ─ */}
      <section id="features" className="py-28 px-6 border-t border-card-border">
        <div className="max-w-7xl mx-auto">
          <Reveal className="mb-14">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: "var(--color-accent)" }}>
              {L.featuresLabel}
            </p>
            <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-tight text-text-primary">
              {L.featuresTitle}
            </h2>
          </Reveal>

          {/* Row 1: 2fr + 1fr */}
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4 mb-4">
            <Reveal delay={0.05}>
              <SpotlightCard innerClass="p-8 h-full flex flex-col" className="h-full min-h-[240px]">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-6"
                  style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", color: "var(--color-accent)" }}>
                  {ICONS[0]}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: "var(--color-accent)" }}>Core</span>
                <h3 className="text-xl font-semibold tracking-tight text-text-primary mb-2">{L.features[0].label}</h3>
                <p className="text-sm leading-relaxed max-w-[44ch]" style={{ color: "var(--color-text-secondary)" }}>{L.features[0].body}</p>
              </SpotlightCard>
            </Reveal>
            <Reveal delay={0.1}>
              <SpotlightCard innerClass="p-7 h-full flex flex-col justify-between" className="h-full min-h-[200px]">
                <div>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-5"
                    style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", color: "var(--color-accent)" }}>
                    {ICONS[1]}
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight text-text-primary mb-2">{L.features[1].label}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{L.features[1].body}</p>
                </div>
                <div className="mt-6 pt-6 border-t border-card-border">
                  <LiveStatusCard />
                </div>
              </SpotlightCard>
            </Reveal>
          </div>

          {/* Row 2: 1fr + 2fr (reversed — zig-zag) */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4 mb-4">
            <Reveal delay={0.05}>
              <SpotlightCard innerClass="p-7 h-full flex flex-col" className="h-full min-h-[200px]">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-5"
                  style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", color: "var(--color-accent)" }}>
                  {ICONS[2]}
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-text-primary mb-2">{L.features[2].label}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{L.features[2].body}</p>
              </SpotlightCard>
            </Reveal>
            <Reveal delay={0.1}>
              <SpotlightCard innerClass="p-8 h-full flex flex-col" className="h-full min-h-[200px]">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-5"
                  style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", color: "var(--color-accent)" }}>
                  {ICONS[3]}
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-text-primary mb-2">{L.features[3].label}</h3>
                <p className="text-sm leading-relaxed max-w-[42ch]" style={{ color: "var(--color-text-secondary)" }}>{L.features[3].body}</p>
              </SpotlightCard>
            </Reveal>
          </div>

          {/* Row 3: full-width */}
          <Reveal delay={0.06}>
            <SpotlightCard innerClass="p-8 flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", color: "var(--color-accent)" }}>
                {ICONS[4]}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold tracking-tight text-text-primary mb-1">{L.features[4].label}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{L.features[4].body}</p>
              </div>
              <div className="shrink-0 flex gap-4 font-mono text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {[["47.2%", "Grounded"], ["2.1s", "Avg latency"], ["0", "Hallucinations"]].map(([v, l]) => (
                  <div key={l} className="text-center">
                    <div className="text-2xl font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>{v}</div>
                    <div className="text-[10px] uppercase tracking-[0.1em] mt-0.5">{l}</div>
                  </div>
                ))}
              </div>
            </SpotlightCard>
          </Reveal>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="py-28 px-6 border-t border-card-border">
        <div className="max-w-3xl mx-auto">
          <Reveal className="mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: "var(--color-accent)" }}>
              {L.processLabel}
            </p>
            <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-tight text-text-primary">
              {L.processTitle}
            </h2>
          </Reveal>

          <div>
            {L.steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.1} y={16}>
                <div className="flex gap-8 pb-14 last:pb-0 relative">
                  {i < L.steps.length - 1 && (
                    <div className="absolute left-[19px] top-12 bottom-0 w-px border-l border-dashed border-card-border" />
                  )}
                  <div className="w-10 h-10 rounded-2xl border border-card-border bg-card flex items-center justify-center shrink-0 z-10"
                    style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}>
                    <span className="text-[11px] font-bold font-mono" style={{ color: "var(--color-accent)" }}>0{i + 1}</span>
                  </div>
                  <div className="pt-2">
                    <h3 className="font-semibold tracking-tight text-text-primary mb-2">{s.title}</h3>
                    <p className="text-sm leading-relaxed max-w-[52ch]" style={{ color: "var(--color-text-secondary)" }}>{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section className="py-28 px-6 border-t border-card-border">
        <Reveal>
          <div className="max-w-lg mx-auto text-center">
            <h2 className="text-[clamp(1.875rem,4vw,3rem)] font-bold tracking-tight text-text-primary mb-5">
              {L.ctaTitle}
            </h2>
            <p className="mb-10 max-w-[40ch] mx-auto text-[1.0625rem] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              {L.ctaSub}
            </p>
            <MagneticBtn href="/login" primary>{L.cta} →</MagneticBtn>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-card-border py-10 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs" style={{ color: "var(--color-muted)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--color-accent) 15%, transparent)" }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                style={{ color: "var(--color-accent)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            INFORM
          </div>
          <span>{L.footer}</span>
        </div>
      </footer>
    </div>
  );
}
