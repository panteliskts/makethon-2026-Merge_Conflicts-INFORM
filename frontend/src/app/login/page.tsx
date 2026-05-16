"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle, LangToggle } from "@/components/NavControls";
import { useLocale } from "@/lib/useLocale";

type Mode = "options" | "credentials";

const ease = [0.16, 1, 0.3, 1] as const;

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();
  const { t } = useLocale();
  const L = t.login;
  const [mode, setMode] = useState<Mode>("options");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.push("/dashboard");
  }, [status, router]);

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError(L.errorMsg);
    } else {
      router.push("/dashboard");
    }
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

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-16">
        {/* subtle grid pattern */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{ backgroundImage: "linear-gradient(var(--color-card-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-card-border) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-[360px]"
        >
          {/* outer glow */}
          <div className="absolute -inset-6 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--color-accent) 8%, transparent) 0%, transparent 70%)", filter: "blur(24px)" }} />

          {/* double-bezel card */}
          <div className="relative rounded-3xl border border-card-border overflow-hidden bg-card"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 64px -24px rgba(0,0,0,0.18)" }}>
            {/* inner accent hairline */}
            <div className="h-px w-full"
              style={{ background: "linear-gradient(90deg, transparent, var(--color-accent), transparent)", opacity: 0.5 }} />

            <div className="p-8">
              <div className="flex justify-center mb-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                  <svg className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>

              <h1 className="text-xl font-bold text-center text-text-primary mb-1">
                {L.title}
              </h1>
              <p className="text-sm text-center text-text-secondary mb-7">
                {L.sub}
              </p>

              <AnimatePresence mode="wait">

                {/* ── Option chooser ────────────────────────── */}
                {mode === "options" && (
                  <motion.div key="options"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.28, ease }}
                    className="space-y-3">

                    <motion.button
                      onClick={handleGoogleSignIn}
                      disabled={loading}
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-3 rounded-md bg-paper px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-white disabled:opacity-50"
                    >
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

                    {/* Email / Password */}
                    <motion.button
                      onClick={() => setMode("credentials")}
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-3 rounded-md border border-card-border bg-sidebar px-4 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-accent/60"
                    >
                      <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                      </svg>
                      {L.email}
                    </motion.button>
                  </motion.div>
                )}

                {/* ── Credentials form ──────────────────────── */}
                {mode === "credentials" && (
                  <motion.form key="credentials"
                    onSubmit={handleCredentials}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.28, ease }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        {L.emailLabel}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder={L.emailPlaceholder}
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        {L.passwordLabel}
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder={L.passwordPlaceholder}
                        className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                      />
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.p
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                          className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="pressable focus-ring flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      {loading ? (
                        <motion.div animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                          className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white" />
                      ) : L.submit}
                    </motion.button>

                    <button
                      type="button"
                      onClick={() => { setMode("options"); setError(""); }}
                      className="focus-ring w-full text-center text-xs text-text-secondary hover:text-text-primary transition-colors py-1"
                    >
                      {L.back}
                    </button>
                  </motion.form>
                )}

              </AnimatePresence>

              {/* Footer note */}
              <div className="mt-6 pt-6 border-t border-card-border">
                <p className="text-xs text-center text-text-secondary leading-relaxed">
                  {L.demoLabel} <span className="text-text-primary font-mono">demo@inform.app</span> / <span className="text-text-primary font-mono">inform2026</span>
                </p>
              </div>
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
