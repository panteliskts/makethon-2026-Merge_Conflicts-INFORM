"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError("Missing reset token. Please request a new link.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error || "Something went wrong."); return; }
    setDone(true);
    setTimeout(() => router.push("/login"), 3000);
  }

  return (
    <div className="relative w-full max-w-[380px]">
      <div className="absolute -inset-6 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--color-accent) 8%, transparent) 0%, transparent 70%)", filter: "blur(24px)" }} />

      <div className="relative rounded-3xl border border-card-border overflow-hidden bg-card"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 64px -24px rgba(0,0,0,0.18)" }}>
        <div className="h-px w-full"
          style={{ background: "linear-gradient(90deg,transparent,var(--color-accent),transparent)", opacity: 0.5 }} />

        <div className="p-8">
          <div className="flex justify-center mb-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
              <svg className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {done ? (
              <motion.div key="done"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
                  <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-text-primary">Password updated!</p>
                <p className="text-xs text-text-secondary">Redirecting you to sign in…</p>
              </motion.div>
            ) : (
              <motion.form key="form" onSubmit={handleSubmit}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-text-primary mb-1">Set new password</h1>
                  <p className="text-sm text-text-secondary mb-5">Choose a strong password for your account.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">New password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    required placeholder="Min. 8 characters" disabled={!token}
                    className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-40" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Confirm password</label>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    required placeholder="Repeat password" disabled={!token}
                    className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-40" />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button type="submit" disabled={loading || !token}
                  className="pressable focus-ring flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
                  {loading ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : "Update password"}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="mt-6 text-center text-xs" style={{ color: "var(--color-muted)" }}>
        <Link href="/login" className="hover:text-text-primary transition-colors focus-ring rounded">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-16">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
