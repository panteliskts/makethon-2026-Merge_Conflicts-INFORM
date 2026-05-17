"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { signIn, getSession } from "next-auth/react";

export interface SavedAccount {
  email: string;
  name: string;
  role: string;
  image?: string;
}

// ── Supabase-backed helpers ────────────────────────────────────────────────────

export async function upsertSavedAccount(account: SavedAccount & { password?: string }) {
  try {
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
  } catch { /* non-fatal */ }
}

async function fetchSavedAccounts(): Promise<SavedAccount[]> {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) return [];
    const data = await res.json();
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

async function deleteSavedAccount(email: string) {
  try {
    await fetch(`/api/accounts?email=${encodeURIComponent(email)}`, { method: "DELETE" });
  } catch { /* non-fatal */ }
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

function Avatar({ name, image, size = 6 }: { name: string; image?: string; size?: number }) {
  const px = size * 4; // tailwind h-{size} = size*4px
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name} className="h-full w-full rounded-full object-cover" />;
  }
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return <span className={`text-[${Math.max(10, px / 3)}px] font-bold text-white`}>{initials}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  current: SavedAccount;
  onSignOut: () => void;
}

export default function AccountSwitcher({ current, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<SavedAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Switch to existing saved account
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState("");

  // Add new account
  const [addingAccount, setAddingAccount] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const addEmailRef = useRef<HTMLInputElement>(null);

  const loadOthers = useCallback(async () => {
    setLoadingAccounts(true);
    const all = await fetchSavedAccounts();
    setOthers(all.filter((a) => a.email !== current.email));
    setLoadingAccounts(false);
  }, [current.email]);

  useEffect(() => {
    if (open) loadOthers();
  }, [open, loadOthers]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    if (addingAccount) setTimeout(() => addEmailRef.current?.focus(), 50);
  }, [addingAccount]);

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddLoading(true);
    const res = await signIn("credentials", {
      email: addEmail.trim(),
      password: addPassword,
      redirect: false,
    });
    setAddLoading(false);
    if (res?.error) {
      setAddError("Invalid email or password.");
      return;
    }
    // Save with real name/role from session so future switches don't require re-entry
    const nextSession = await getSession();
    await upsertSavedAccount({
      email: nextSession?.user?.email ?? addEmail.trim(),
      name: nextSession?.user?.name ?? addEmail.trim(),
      role: nextSession?.user?.role ?? "client",
      image: nextSession?.user?.image ?? undefined,
      password: addPassword,
    });
    setAddingAccount(false);
    setAddEmail("");
    setAddPassword("");
    setOpen(false);
    window.location.reload();
  }

  function openAddAccount() {
    setAddingAccount(true);
    setAddEmail("");
    setAddPassword("");
    setAddError("");
    setOpen(false);
  }

  async function handleSwitch(acc: SavedAccount) {
    setSwitchingEmail(acc.email);
    setSwitchError("");
    try {
      const switchRes = await fetch("/api/accounts/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedEmail: acc.email }),
      });
      if (!switchRes.ok) {
        setSwitchError("Could not switch account. Please sign in manually.");
        setSwitchingEmail(null);
        return;
      }
      const { password } = await switchRes.json();
      const res = await signIn("credentials", { email: acc.email, password, redirect: false });
      if (res?.error) {
        setSwitchError("Switch failed. Please sign in manually.");
        setSwitchingEmail(null);
        return;
      }
      setOpen(false);
      window.location.reload();
    } catch {
      setSwitchError("Switch failed. Please try again.");
      setSwitchingEmail(null);
    }
  }

  async function handleRemove(e: React.MouseEvent, email: string) {
    e.stopPropagation();
    setOthers((prev) => prev.filter((a) => a.email !== email));
    await deleteSavedAccount(email);
  }

  const roleLabel = (role: string) => role === "admin" ? "Accountant / Admin" : "Client";
  const accentBg = "var(--color-accent)";
  const dimBg = "color-mix(in srgb, var(--color-accent) 55%, var(--color-sidebar))";

  return (
    <div ref={dropdownRef} className="relative">

      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="pressable focus-ring flex items-center gap-2 rounded-lg border border-card-border bg-card px-2.5 py-1.5 transition-colors hover:border-accent/50"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={{ background: accentBg }}>
          <Avatar name={current.name} image={current.image} size={6} />
        </div>
        <span className="hidden max-w-[7rem] truncate text-xs font-medium text-text-primary lg:block">
          {current.name}
        </span>
        <svg className={`h-3 w-3 shrink-0 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-card-border bg-card"
          style={{ boxShadow: "0 8px 32px -8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)" }}
        >
          {/* Current account */}
          <div className="border-b border-card-border px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              Signed in as
            </p>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full"
                style={{ background: accentBg }}>
                <Avatar name={current.name} image={current.image} size={9} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">{current.name}</p>
                <p className="truncate text-xs text-text-secondary">{current.email}</p>
                <p className="text-[10px] text-text-secondary/60">{roleLabel(current.role)}</p>
              </div>
            </div>
          </div>

          {/* Other saved accounts */}
          {(loadingAccounts || others.length > 0) && (
            <div className="border-b border-card-border px-4 py-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                Switch to
              </p>
              {loadingAccounts ? (
                <div className="flex items-center gap-2 px-2 py-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-card-border border-t-accent" />
                  <span className="text-xs text-text-secondary">Loading…</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {others.map((acc) => (
                    <div key={acc.email} className="group flex items-center gap-1">
                      <button
                        onClick={() => handleSwitch(acc)}
                        disabled={switchingEmail === acc.email}
                        className="pressable focus-ring flex flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar disabled:opacity-60"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full"
                          style={{ background: dimBg }}>
                          {switchingEmail === acc.email
                            ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            : <Avatar name={acc.name} image={acc.image} size={7} />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-text-primary">{acc.name}</p>
                          <p className="truncate text-[10px] text-text-secondary">
                            {switchingEmail === acc.email ? "Switching…" : acc.email}
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleRemove(e, acc.email)}
                        title="Remove"
                        className="hidden shrink-0 rounded p-1.5 text-text-secondary hover:text-red-400 group-hover:flex focus-ring"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {switchError && (
                <p className="mt-1 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {switchError}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="px-4 py-2 space-y-0.5">
            <button
              onClick={openAddAccount}
              className="pressable focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-sidebar hover:text-text-primary"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Add account
            </button>
            <button
              onClick={onSignOut}
              className="pressable focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-sidebar hover:text-red-400"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Add account modal */}
      {addingAccount && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setAddingAccount(false); }}
        >
          <div
            className="w-full max-w-[340px] overflow-hidden rounded-2xl border border-card-border bg-card"
            style={{ boxShadow: "0 24px 64px -24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)" }}
          >
            <div className="h-px w-full"
              style={{ background: "linear-gradient(90deg,transparent,var(--color-accent),transparent)", opacity: 0.5 }} />
            <div className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-card-border bg-sidebar"
                  style={{ color: "var(--color-accent)" }}>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Add another account</p>
                  <p className="text-xs text-text-secondary">Sign in to switch between accounts</p>
                </div>
              </div>

              <form onSubmit={handleAddAccount} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
                  <input
                    ref={addEmailRef}
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    required
                    placeholder="email@example.com"
                    className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Password</label>
                  <input
                    type="password"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    required
                    placeholder="Enter password"
                    className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                  />
                </div>
                {addError && (
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {addError}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setAddingAccount(false)}
                    className="pressable focus-ring flex-1 rounded-md border border-card-border px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-accent/50">
                    Cancel
                  </button>
                  <button type="submit" disabled={addLoading || !addEmail || !addPassword}
                    className="pressable focus-ring flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
                    {addLoading ? (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : "Sign in"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
