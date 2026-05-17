"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle, LangToggle } from "@/components/NavControls";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIERS = [
  {
    id: "starter",
    name: "Starter",
    label: "Small Business",
    price: "€49",
    period: "/month",
    description: "Perfect for small teams managing a handful of clients.",
    features: [
      "Up to 3 users",
      "100 invoices / month",
      "AI invoice chat",
      "Bank reconciliation",
      "Email support",
    ],
    cta: "Get started",
    ctaHref: "/login",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    label: "Medium Business",
    price: "€149",
    period: "/month",
    description: "For growing accounting firms handling multiple clients.",
    features: [
      "Up to 15 users",
      "500 invoices / month",
      "Everything in Starter",
      "Advanced analytics",
      "Priority support",
      "Custom document types",
    ],
    cta: "Get started",
    ctaHref: "/login",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    label: "Custom",
    price: "Custom",
    period: "",
    description: "Unlimited scale with dedicated infrastructure and SLAs.",
    features: [
      "Unlimited users",
      "Unlimited invoices",
      "Everything in Growth",
      "Dedicated support",
      "Custom integrations",
      "99.9% uptime SLA",
      "On-premise option",
    ],
    cta: "Contact Sales",
    ctaHref: null,
    highlight: false,
  },
];

type FormState = "idle" | "open" | "loading" | "success" | "error";

interface Credentials {
  email: string;
  password: string;
}

export default function PricingPage() {
  const [formState, setFormState] = useState<FormState>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim()) {
      setErrorMsg("All fields are required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setErrorMsg("Enter a valid email address.");
      return;
    }
    setErrorMsg("");
    setFormState("loading");

    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setFormState("open");
        return;
      }
      setCredentials({ email: data.email, password: data.password });
      setFormState("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setFormState("open");
    }
  }

  const inputCls =
    "w-full rounded-lg border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-[var(--color-accent)]";

  return (
    <main id="main-content" className="min-h-[100dvh] flex flex-col bg-background">
      {/* Nav */}
      <nav className="flex h-[60px] items-center justify-between border-b border-card-border px-6 sticky top-0 z-50 bg-background/90 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity focus-ring rounded-lg">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
            style={{ background: "var(--color-accent)" }}
          >
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-text-primary">INFORM</span>
        </Link>
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

      {/* Hero */}
      <section className="px-6 pt-16 pb-10 text-center">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card px-3 py-1 text-xs font-medium text-text-secondary">
          Simple, transparent pricing
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
          Plans that grow with you
        </h1>
        <p className="mt-4 max-w-xl mx-auto text-base text-text-secondary">
          From solo accountants to enterprise firms — INFORM scales to match your workload without surprises.
        </p>
      </section>

      {/* Pricing cards */}
      <section className="flex-1 px-6 pb-16">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className="relative flex flex-col rounded-2xl border overflow-hidden"
              style={{
                borderColor: tier.highlight
                  ? "var(--color-accent)"
                  : "var(--color-card-border)",
                background: "var(--color-card)",
                boxShadow: tier.highlight
                  ? "0 0 0 1px var(--color-accent), 0 24px 64px -24px rgba(0,0,0,0.18)"
                  : "0 24px 64px -24px rgba(0,0,0,0.1)",
              }}
            >
              {/* Top accent line for highlighted card */}
              {tier.highlight && (
                <>
                  <div
                    className="h-px w-full"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
                    }}
                  />
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span
                      className="rounded-full px-3 py-1 text-xs font-bold text-white"
                      style={{ background: "var(--color-accent)" }}
                    >
                      Most popular
                    </span>
                  </div>
                </>
              )}

              <div className="flex flex-1 flex-col gap-6 p-7">
                {/* Header */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    {tier.label}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-text-primary">{tier.name}</h2>
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-text-primary">{tier.price}</span>
                    {tier.period && (
                      <span className="pb-1 text-sm text-text-secondary">{tier.period}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-text-secondary">{tier.description}</p>
                </div>

                {/* Features */}
                <ul className="flex-1 space-y-2.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-text-primary">
                      <svg
                        className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {tier.ctaHref ? (
                  <Link
                    href={tier.ctaHref}
                    className="pressable focus-ring block rounded-xl px-4 py-3 text-center text-sm font-bold transition-colors"
                    style={
                      tier.highlight
                        ? { background: "var(--color-accent)", color: "#fff" }
                        : {
                            background: "transparent",
                            color: "var(--color-text-primary)",
                            border: "1px solid var(--color-card-border)",
                          }
                    }
                  >
                    {tier.cta}
                  </Link>
                ) : (
                  <button
                    onClick={() => { setFormState("open"); setErrorMsg(""); }}
                    className="pressable focus-ring block w-full rounded-xl border border-card-border px-4 py-3 text-center text-sm font-bold text-text-primary transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    {tier.cta}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* FAQ strip */}
        <p className="mt-10 text-center text-sm text-text-secondary">
          All plans include a 14-day free trial. No credit card required.{" "}
          <button
            onClick={() => { setFormState("open"); setErrorMsg(""); }}
            className="text-accent hover:underline focus-ring"
          >
            Questions? Talk to us.
          </button>
        </p>
      </section>

      {/* Contact Sales overlay */}
      {(formState === "open" || formState === "loading" || formState === "success" || formState === "error") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget && formState !== "loading") {
              setFormState("idle");
            }
          }}
        >
          <div
            className="relative w-full max-w-md rounded-3xl border border-card-border overflow-hidden"
            style={{
              background: "var(--color-card)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 64px -24px rgba(0,0,0,0.36)",
            }}
          >
            {/* accent line */}
            <div
              className="h-px w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
                opacity: 0.6,
              }}
            />

            <div className="p-8">
              {formState === "success" && credentials ? (
                /* ── Success ── */
                <div className="flex flex-col items-center gap-4 text-center">
                  <div
                    className="grid h-14 w-14 place-items-center rounded-2xl border"
                    style={{
                      borderColor: "var(--color-accent)",
                      background:
                        "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                    }}
                  >
                    <svg className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-text-primary">You&apos;re all set!</h2>
                    <p className="mt-1 text-sm text-text-secondary">
                      Your admin account has been created. Save these credentials now — they won&apos;t be shown again.
                    </p>
                  </div>

                  {/* Credentials box */}
                  <div
                    className="w-full rounded-xl border p-4 text-left font-mono text-sm"
                    style={{
                      borderColor: "var(--color-card-border)",
                      background: "var(--color-sidebar)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary">Email</span>
                      <span className="font-semibold text-text-primary select-all">{credentials.email}</span>
                    </div>
                    <div className="my-2 h-px bg-card-border" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary">Password</span>
                      <span className="font-semibold text-text-primary select-all">{credentials.password}</span>
                    </div>
                  </div>

                  <Link
                    href="/login"
                    className="pressable focus-ring w-full rounded-xl px-4 py-3 text-center text-sm font-bold text-white"
                    style={{ background: "var(--color-accent)" }}
                  >
                    Sign in to your account
                  </Link>
                </div>
              ) : (
                /* ── Form ── */
                <>
                  <button
                    onClick={() => setFormState("idle")}
                    disabled={formState === "loading"}
                    className="absolute right-5 top-5 rounded-lg p-1.5 text-text-secondary transition-colors hover:text-text-primary focus-ring disabled:opacity-40"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  <h2 className="text-xl font-bold text-text-primary">Contact Sales</h2>
                  <p className="mt-1 mb-6 text-sm text-text-secondary">
                    Fill in your details and we&apos;ll set up your admin account instantly.
                  </p>

                  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Full name</label>
                      <input
                        className={inputCls}
                        placeholder="Jane Smith"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={formState === "loading"}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Work email</label>
                      <input
                        className={inputCls}
                        type="email"
                        placeholder="jane@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={formState === "loading"}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Company</label>
                      <input
                        className={inputCls}
                        placeholder="Acme Corp"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        disabled={formState === "loading"}
                      />
                    </div>

                    {errorMsg && (
                      <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                        {errorMsg}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={formState === "loading"}
                      className="pressable focus-ring mt-1 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-colors disabled:opacity-60"
                      style={{ background: "var(--color-accent)" }}
                    >
                      {formState === "loading" ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Setting up your account…
                        </>
                      ) : (
                        "Get enterprise access"
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
