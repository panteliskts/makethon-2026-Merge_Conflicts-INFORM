"use client";

import { getSession, signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle, LangToggle } from "@/components/NavControls";
import { upsertSavedAccount } from "@/components/AccountSwitcher";
import { useLocale } from "@/lib/useLocale";

type Mode = "options" | "credentials" | "signup" | "signup-role";
type AccountType = "client" | "admin";

const ease = [0.16, 1, 0.3, 1] as const;

function routeForRole(role?: string | null) {
  return role === "admin" ? "/admin" : "/dashboard";
}

const ACCOUNT_TYPES: { id: AccountType; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: "client",
    label: "Client",
    desc: "Upload invoices and ask questions about them",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    id: "admin",
    label: "Accountant / Admin",
    desc: "Manage multiple clients, reconcile statements, access analytics",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
];

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t } = useLocale();
  const L = t.login;

  const [mode, setMode] = useState<Mode>("options");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Signup-specific state
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupRole, setSignupRole] = useState<AccountType>("client");

  useEffect(() => {
    if (status === "authenticated") router.push(routeForRole(session?.user?.role));
  }, [status, router, session?.user?.role]);

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError(L.errorMsg);
    } else {
      const nextSession = await getSession();
      if (nextSession?.user) {
        upsertSavedAccount({
          email: nextSession.user.email ?? email,
          name: nextSession.user.name ?? email,
          role: nextSession.user.role ?? "client",
          image: nextSession.user.image ?? undefined,
        });
      }
      router.push(routeForRole(nextSession?.user?.role));
    }
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (signupPassword !== signupConfirm) {
      setError("Passwords do not match.");
      return;
    }
    if (signupPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: signupName,
          email: signupEmail,
          password: signupPassword,
          role: signupRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-up failed. Please try again.");
        return;
      }
      // Auto-sign in after successful signup
      const signinRes = await signIn("credentials", {
        email: signupEmail,
        password: signupPassword,
        redirect: false,
      });
      if (signinRes?.error) {
        setError("Account created — please sign in.");
        setMode("credentials");
        setEmail(signupEmail);
      } else {
        const nextSession = await getSession();
        if (nextSession?.user) {
          upsertSavedAccount({
            email: nextSession.user.email ?? signupEmail,
            name: nextSession.user.name ?? signupName,
            role: nextSession.user.role ?? signupRole,
            image: nextSession.user.image ?? undefined,
          });
        }
        router.push(routeForRole(nextSession?.user?.role));
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function resetToOptions() {
    setMode("options");
    setError("");
  }

  if (status === "loading" || status === "authenticated") {
    return (
      <main id="main-content" className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.div key={i} className="w-2 h-2 rounded-full bg-accent"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }} />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="flex min-h-[100dvh] flex-col bg-background">
      <nav className="flex h-[60px] items-center justify-between border-b border-card-border px-6">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity focus-ring rounded-lg">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "var(--color-accent)", boxShadow: "0 4px 12px -4px color-mix(in srgb, var(--color-accent) 50%, transparent)" }}>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-text-primary">INFORM</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
        </div>
      </nav>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12">
        {/* grid background */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{ backgroundImage: "linear-gradient(var(--color-card-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-card-border) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-[400px]"
        >
          {/* glow */}
          <div className="absolute -inset-6 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--color-accent) 8%, transparent) 0%, transparent 70%)", filter: "blur(24px)" }} />

          <div className="relative rounded-3xl border border-card-border overflow-hidden bg-card"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 64px -24px rgba(0,0,0,0.18)" }}>
            <div className="h-px w-full"
              style={{ background: "linear-gradient(90deg, transparent, var(--color-accent), transparent)", opacity: 0.5 }} />

            <div className="p-8">
              {/* Logo */}
              <div className="flex justify-center mb-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                  <svg className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>

              <h1 className="text-xl font-bold text-center text-text-primary mb-1">
                {mode === "signup" || mode === "signup-role" ? "Create an account" : L.title}
              </h1>
              <p className="text-sm text-center text-text-secondary mb-6">
                {mode === "signup" ? "Fill in your details to get started" :
                 mode === "signup-role" ? "What best describes you?" :
                 L.sub}
              </p>

              <AnimatePresence mode="wait">

                {/* ── Options ─────────────────────────────────── */}
                {mode === "options" && (
                  <motion.div key="options"
                    initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.28, ease }}
                    className="space-y-3">

                    <motion.button onClick={handleGoogleSignIn} disabled={loading}
                      whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-3 rounded-md bg-paper px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-white disabled:opacity-50">
                      {loading ? (
                        <motion.div animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                          className="h-5 w-5 rounded-full border-2 border-gray-300 border-t-gray-600" />
                      ) : (
                        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      {L.google}
                    </motion.button>

                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-card-border" />
                      <span className="text-xs text-text-secondary">or</span>
                      <div className="h-px flex-1 bg-card-border" />
                    </div>

                    <motion.button onClick={() => setMode("credentials")}
                      whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-3 rounded-md border border-card-border bg-sidebar px-4 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-accent/60">
                      <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                      </svg>
                      {L.email}
                    </motion.button>

                    <div className="pt-1 text-center">
                      <button onClick={() => { setError(""); setMode("signup-role"); }}
                        className="focus-ring text-xs text-text-secondary hover:text-accent transition-colors">
                        Don&apos;t have an account? <span className="font-semibold text-accent">Sign up</span>
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* ── Log in form ──────────────────────────────── */}
                {mode === "credentials" && (
                  <motion.form key="credentials" onSubmit={handleCredentials}
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.28, ease }}
                    className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">{L.emailLabel}</label>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                        placeholder={L.emailPlaceholder}
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">{L.passwordLabel}</label>
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                        placeholder={L.passwordPlaceholder}
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>
                    <AnimatePresence>
                      {error && (
                        <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}
                          className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                    <motion.button type="submit" disabled={loading}
                      whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
                      {loading ? (
                        <motion.div animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                          className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white" />
                      ) : L.submit}
                    </motion.button>
                    <div className="flex items-center justify-between pt-1">
                      <button type="button" onClick={resetToOptions}
                        className="focus-ring text-xs text-text-secondary hover:text-text-primary transition-colors py-1">
                        {L.back}
                      </button>
                      <button type="button" onClick={() => { setError(""); setMode("signup-role"); }}
                        className="focus-ring text-xs text-accent hover:text-accent/80 transition-colors py-1">
                        Sign up instead
                      </button>
                    </div>
                  </motion.form>
                )}

                {/* ── Account type selection ───────────────────── */}
                {mode === "signup-role" && (
                  <motion.div key="signup-role"
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.28, ease }}
                    className="space-y-3">
                    {ACCOUNT_TYPES.map((type) => (
                      <button key={type.id} type="button"
                        onClick={() => { setSignupRole(type.id); setMode("signup"); setError(""); }}
                        className="pressable focus-ring flex w-full items-start gap-4 rounded-xl border px-4 py-4 text-left transition-colors hover:border-accent/60"
                        style={{ borderColor: signupRole === type.id ? "var(--color-accent)" : undefined,
                                 background: signupRole === type.id ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : undefined }}>
                        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-card-border bg-sidebar text-accent">
                          {type.icon}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{type.label}</p>
                          <p className="mt-0.5 text-xs text-text-secondary">{type.desc}</p>
                        </div>
                      </button>
                    ))}
                    <button type="button" onClick={resetToOptions}
                      className="focus-ring w-full text-center text-xs text-text-secondary hover:text-text-primary transition-colors py-1 pt-2">
                      ← Back to sign in
                    </button>
                  </motion.div>
                )}

                {/* ── Sign-up form ─────────────────────────────── */}
                {mode === "signup" && (
                  <motion.form key="signup" onSubmit={handleSignupSubmit}
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.28, ease }}
                    className="space-y-3">

                    {/* Selected role pill */}
                    <div className="flex items-center gap-2 rounded-lg border border-card-border bg-sidebar px-3 py-2">
                      <span className="text-xs text-text-secondary">Account type:</span>
                      <span className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                        style={{ background: "var(--color-accent)" }}>
                        {ACCOUNT_TYPES.find((t) => t.id === signupRole)?.label}
                      </span>
                      <button type="button" onClick={() => setMode("signup-role")}
                        className="ml-auto text-xs text-text-secondary hover:text-accent transition-colors">
                        Change
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Full name</label>
                      <input type="text" value={signupName} onChange={(e) => setSignupName(e.target.value)} required
                        placeholder="Jane Smith"
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                      <input type="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required
                        placeholder="jane@company.com"
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Password</label>
                      <input type="password" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required
                        placeholder="Min. 8 characters"
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Confirm password</label>
                      <input type="password" value={signupConfirm} onChange={(e) => setSignupConfirm(e.target.value)} required
                        placeholder="Repeat password"
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent" />
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}
                          className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <motion.button type="submit" disabled={loading}
                      whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
                      {loading ? (
                        <motion.div animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                          className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white" />
                      ) : "Create account"}
                    </motion.button>

                    <button type="button" onClick={() => { setMode("options"); setError(""); }}
                      className="focus-ring w-full text-center text-xs text-text-secondary hover:text-text-primary transition-colors py-1">
                      Already have an account? Sign in
                    </button>
                  </motion.form>
                )}

              </AnimatePresence>

              {/* Footer demo note — only show on login modes */}
              {(mode === "options" || mode === "credentials") && (
                <div className="mt-6 pt-6 border-t border-card-border">
                  <p className="text-xs text-center text-text-secondary leading-relaxed">
                    {L.demoLabel} <span className="text-text-primary font-mono">demo@inform.app</span> / <span className="text-text-primary font-mono">inform2026</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs" style={{ color: "var(--color-muted)" }}>
            <Link href="/" className="hover:text-text-primary transition-colors focus-ring rounded">
              {L.backHome}
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
