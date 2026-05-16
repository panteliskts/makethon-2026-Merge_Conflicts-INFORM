"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { getMetrics, type MetricsResponse } from "@/lib/api";
import { useLocale } from "@/lib/useLocale";

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ─── Animated counter (font-mono per taste-skill §6 density) ── */
function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const diff = value - start;
    const duration = 600;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = Math.round(start + diff * ease);
      setDisplay(current);
      if (t < 1) requestAnimationFrame(tick);
      else ref.current = value;
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{display}{suffix}</>;
}

/* ─── Skeleton shimmer card ─────────────────────────────────────  */
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-6"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}>
      <div className="skeleton h-3 w-24 mb-4 rounded" />
      <div className="skeleton h-8 w-16 mb-2 rounded" />
      <div className="skeleton h-2.5 w-32 rounded" />
    </div>
  );
}

/* ─── Metric card ───────────────────────────────────────────────  */
function MetricCard({ label, value, sub, raw }: { label: string; value: string; sub?: string; raw: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: E }}
      className="rounded-2xl border border-card-border bg-card p-6"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-3"
        style={{ color: "var(--color-text-secondary)" }}>{label}</p>
      <p className="font-mono text-3xl font-bold tracking-tight text-text-primary">
        {value.includes("ms") ? (
          <><AnimatedNumber value={raw} /> ms</>
        ) : (
          <AnimatedNumber value={raw} />
        )}
      </p>
      {sub && <p className="mt-1.5 text-xs" style={{ color: "var(--color-muted)" }}>{sub}</p>}
    </motion.div>
  );
}

/* ─── Animated bar ───────────────────────────────────────────── */
function PercentBar({ value, color }: { value: number; color: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "var(--color-card-border)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={inView ? { width: `${Math.min(100, value)}%` } : {}}
        transition={{ duration: 0.8, ease: E, delay: 0.15 }}
      />
    </div>
  );
}

export default function MetricsPanel() {
  const { t } = useLocale();
  const M = t.metrics;
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMetrics() {
    try {
      const data = await getMetrics();
      setMetrics(data);
    } catch { /* backend might not be ready */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, 10000);
    return () => clearInterval(id);
  }, []);

  const total = metrics?.total_queries ?? 0;
  const groundedPct = total > 0 ? Math.round(((metrics?.grounded_count ?? 0) / total) * 100) : 0;
  const refusedPct  = total > 0 ? Math.round(((metrics?.refused_count  ?? 0) / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-8">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-2"
            style={{ color: "var(--color-accent)" }}>Evaluation loop</p>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">{M.title}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>{M.sub}</p>
        </div>
        <button onClick={fetchMetrics}
          className="pressable focus-ring shrink-0 rounded-xl border border-card-border bg-card px-3.5 py-2 text-xs font-semibold transition-colors"
          style={{ color: "var(--color-text-secondary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.color = ""; }}>
          {M.refresh}
        </button>
      </div>

      {/* stat grid — 2 col, no 3-equal (taste-skill rule) */}
      <div className="grid grid-cols-2 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard label={M.totalQueries} value={`${metrics?.total_queries ?? 0}`} raw={metrics?.total_queries ?? 0} />
            <MetricCard label={M.avgLatency} value={`${metrics?.avg_latency_ms ?? 0} ms`} sub={M.avgLatencySub} raw={metrics?.avg_latency_ms ?? 0} />
            <MetricCard label={M.grounded} value={`${metrics?.grounded_count ?? 0}`} sub={`${groundedPct}% of queries`} raw={metrics?.grounded_count ?? 0} />
            <MetricCard label={M.refused} value={`${metrics?.refused_count ?? 0}`} sub={`${refusedPct}% of queries`} raw={metrics?.refused_count ?? 0} />
          </>
        )}
      </div>

      {/* ratio bars */}
      {!loading && (
        <div className="rounded-2xl border border-card-border bg-card p-6 space-y-5"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}>
          <h3 className="text-sm font-semibold tracking-tight text-text-primary">{M.chartTitle}</h3>

          {[
            { label: M.groundedLabel, pct: groundedPct, color: "#22c55e" },
            { label: M.refusedLabel,  pct: refusedPct,  color: "#f59e0b" },
          ].map(({ label, pct, color }) => (
            <div key={label} className="space-y-1.5">
              <div className="flex justify-between text-xs" style={{ color: "var(--color-text-secondary)" }}>
                <span>{label}</span>
                <span className="font-mono font-semibold" style={{ color: "var(--color-text-primary)" }}>{pct}%</span>
              </div>
              <PercentBar value={pct} color={color} />
            </div>
          ))}
        </div>
      )}

      {!loading && total === 0 && (
        <p className="text-center text-sm py-6" style={{ color: "var(--color-muted)" }}>
          {M.empty}
        </p>
      )}
    </div>
  );
}
