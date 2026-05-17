"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  clearDiagnosticsIdentity,
  getAdminSessions,
  runAdminCommand,
  setDiagnosticsIdentity,
  type AdminCommand,
  type AdminSession,
} from "@/lib/api";
import { LangToggle, ThemeToggle } from "@/components/NavControls";

const COMMANDS: { id: AdminCommand; label: string }[] = [
  { id: "healthcheck", label: "healthcheck" },
  { id: "trace", label: "trace" },
  { id: "errors", label: "errors" },
  { id: "sources", label: "sources" },
  { id: "capture-snapshot", label: "capture-snapshot" },
  { id: "reset-context", label: "reset-context" },
  { id: "mark-reviewed", label: "mark-reviewed" },
];

type TerminalLine = {
  id: string;
  tone: "input" | "output" | "error";
  text: string;
};

function formatTime(value?: string) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function normalizeCommand(value: string): AdminCommand | null {
  const clean = value.trim().toLowerCase();
  return COMMANDS.find((command) => command.id === clean)?.id ?? null;
}

function EventStatus({ status }: { status: string }) {
  const styles =
    status === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : status === "warning"
      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
      : "border-moss/30 bg-moss/10 text-moss";
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {status}
    </span>
  );
}

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("healthcheck");
  const [running, setRunning] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    {
      id: "boot",
      tone: "output",
      text: "Invo.ai admin console ready. Select a client session and run a diagnostic command.",
    },
  ]);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    setDiagnosticsIdentity({
      email: session?.user?.email,
      name: session?.user?.name,
      role: "admin",
    });
  }, [isAdmin, session?.user?.email, session?.user?.name, status]);

  const refreshSessions = useCallback(async (showLoader = false) => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    if (showLoader) setLoading(true);
    try {
      const data = await getAdminSessions();
      setSessions(data.sessions);
      setUptime(data.uptime_seconds);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Could not load admin diagnostics.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    refreshSessions(true);
    const id = window.setInterval(() => refreshSessions(false), 5000);
    return () => window.clearInterval(id);
  }, [isAdmin, refreshSessions, status]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.scrollTo({
      top: terminal.scrollHeight,
      behavior: "smooth",
    });
  }, [terminalLines]);

  useEffect(() => {
    if (!selectedId && sessions.length > 0) setSelectedId(sessions[0].id);
    if (selectedId && !sessions.some((item) => item.id === selectedId)) {
      setSelectedId(sessions[0]?.id ?? "");
    }
  }, [selectedId, sessions]);

  const selected = useMemo(
    () => sessions.find((item) => item.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  const stats = useMemo(() => {
    const active = sessions.filter((item) => item.status === "active").length;
    const requests = sessions.reduce((sum, item) => sum + item.request_count, 0);
    const errors = sessions.reduce((sum, item) => sum + item.error_count, 0);
    const sources = new Set(sessions.map((item) => item.active_source).filter(Boolean));
    return { active, requests, errors, sources: sources.size };
  }, [sessions]);

  async function executeCommand(command: AdminCommand | null = normalizeCommand(commandInput)) {
    if (!selected) {
      setTerminalLines((prev) => [
        ...prev,
        { id: `${Date.now()}-no-session`, tone: "error", text: "No client session selected." },
      ]);
      return;
    }
    if (!command) {
      setTerminalLines((prev) => [
        ...prev,
        { id: `${Date.now()}-bad-command`, tone: "error", text: `Unsupported command: ${commandInput}` },
      ]);
      return;
    }

    setRunning(true);
    setTerminalLines((prev) => [
      ...prev,
      { id: `${Date.now()}-input`, tone: "input", text: `$ ${command} --session ${shortId(selected.id)}` },
    ]);

    try {
      const result = await runAdminCommand(selected.id, command);
      setTerminalLines((prev) => [
        ...prev,
        ...result.output.map((line, index) => ({
          id: `${Date.now()}-${index}`,
          tone: "output" as const,
          text: line,
        })),
      ]);
      await refreshSessions(false);
    } catch (e: any) {
      setTerminalLines((prev) => [
        ...prev,
        { id: `${Date.now()}-run-error`, tone: "error", text: e.message || "Command failed." },
      ]);
    } finally {
      setRunning(false);
    }
  }

  if (status === "loading") {
    return (
      <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border border-card-border bg-card p-6 surface-inset">
          <div className="skeleton mb-3 h-4 w-36" />
          <div className="skeleton h-3 w-full" />
        </div>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-background p-6">
        <div className="max-w-sm rounded-xl border border-card-border bg-card p-6 text-center surface-inset">
          <h1 className="text-lg font-bold text-text-primary">Sign in required</h1>
          <p className="mt-2 text-sm text-text-secondary">Use an admin account to open diagnostics.</p>
          <a
            href="/login"
            className="pressable focus-ring mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-bold text-ink"
          >
            Go to login
          </a>
        </div>
      </main>
    );
  }

  if (status === "authenticated" && !isAdmin) {
    return (
      <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-background p-6">
        <div className="max-w-sm rounded-xl border border-card-border bg-card p-6 text-center surface-inset">
          <h1 className="text-lg font-bold text-text-primary">Admin access required</h1>
          <p className="mt-2 text-sm text-text-secondary">This console is reserved for technical operators.</p>
          <a
            href="/dashboard"
            className="pressable focus-ring mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-bold text-ink"
          >
            Return to dashboard
          </a>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-[100dvh] bg-background text-text-primary">
      <header className="grid gap-3 border-b border-card-border bg-sidebar px-4 py-3 lg:grid-cols-[280px_1fr_auto] lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-ink shadow-accent">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.4 15a1.7 1.7 0 00.34 1.87l.05.05a2 2 0 01-2.83 2.83l-.05-.05a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.08A1.7 1.7 0 008.96 19.36a1.7 1.7 0 00-1.87.34l-.05.05a2 2 0 01-2.83-2.83l.05-.05A1.7 1.7 0 004.6 15 1.7 1.7 0 003.04 14H3a2 2 0 010-4h.04A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.05-.05a2 2 0 012.83-2.83l.05.05a1.7 1.7 0 001.87.34H9A1.7 1.7 0 0010 3.08V3a2 2 0 014 0v.08a1.7 1.7 0 001.04 1.56 1.7 1.7 0 001.87-.34l.05-.05a2 2 0 012.83 2.83l-.05.05A1.7 1.7 0 0019.4 9c.14.56.58 1 1.16 1H21a2 2 0 010 4h-.44A1.7 1.7 0 0019.4 15z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-semibold tracking-tight text-text-primary">Invo.ai Admin</p>
            <p className="text-xs text-text-secondary">Technical session overseer</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-2xl">
          {[
            ["Active", stats.active],
            ["Requests", stats.requests],
            ["Errors", stats.errors],
            ["Sources", stats.sources],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-card-border bg-card px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</p>
              <p className="font-mono text-lg font-bold text-text-primary">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 lg:justify-end">
          <a
            href="/dashboard"
            className="pressable focus-ring rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary"
          >
            Client view
          </a>
          <ThemeToggle />
          <LangToggle />
          <button
            onClick={() => {
              clearDiagnosticsIdentity();
              signOut({ callbackUrl: "/" });
            }}
            className="pressable focus-ring rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="grid min-h-[calc(100dvh-73px)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-card-border bg-sidebar/65 p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Sessions</p>
              <p className="text-xs text-text-secondary">API uptime {uptime}s</p>
            </div>
            <button
              onClick={() => refreshSessions(true)}
              className="pressable focus-ring rounded-md border border-card-border bg-card px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary"
            >
              Refresh
            </button>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            {loading && sessions.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-md border border-card-border bg-card p-3">
                  <div className="skeleton mb-2 h-3 w-28" />
                  <div className="skeleton h-2.5 w-40" />
                </div>
              ))
            ) : sessions.length === 0 ? (
              <div className="rounded-md border border-card-border bg-card p-4 text-sm text-text-secondary">
                No client sessions are streaming yet.
              </div>
            ) : (
              sessions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`pressable focus-ring w-full rounded-md border p-3 text-left transition-colors ${
                    selectedId === item.id
                      ? "border-accent bg-accent/10"
                      : "border-card-border bg-card hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-text-primary">{item.user_email}</p>
                    <span className={`h-2 w-2 rounded-full ${item.status === "active" ? "bg-moss" : "bg-muted"}`} />
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-text-secondary">{shortId(item.id)} · {item.path}</p>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary">
                    <span>{item.request_count} requests</span>
                    <span className={item.error_count > 0 ? "text-red-300" : ""}>{item.error_count} errors</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0 p-4 lg:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">Overseer console</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-text-primary">Client diagnostics</h1>
              <p className="mt-1 max-w-prose text-sm text-text-secondary">
                Inspect live request traces, failed operations, indexed documents, and recovery actions per client session.
              </p>
            </div>
            {selected && (
              <div className="rounded-md border border-card-border bg-card px-3 py-2 text-right">
                <p className="font-mono text-xs text-text-secondary">selected</p>
                <p className="font-mono text-sm font-bold text-text-primary">{shortId(selected.id)}</p>
              </div>
            )}
          </div>

          {!selected ? (
            <div className="rounded-xl border border-card-border bg-card p-8 text-center surface-inset">
              <h2 className="text-lg font-bold text-text-primary">Waiting for client telemetry</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Client activity appears here as soon as the workspace calls the API.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["User", selected.user_name || selected.user_email],
                    ["Status", selected.status],
                    ["Last seen", formatTime(selected.last_seen)],
                    ["Document", selected.active_source || "none"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-card-border bg-card p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</p>
                      <p className="mt-2 truncate text-sm font-semibold text-text-primary">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-card-border bg-card surface-inset">
                  <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
                    <div>
                      <h2 className="text-sm font-bold text-text-primary">Session timeline</h2>
                      <p className="text-xs text-text-secondary">{selected.events.length} recent events captured</p>
                    </div>
                    <EventStatus status={selected.error_count > 0 ? "error" : "ok"} />
                  </div>
                  <div className="divide-y divide-card-border/60">
                    {selected.events.length === 0 ? (
                      <p className="p-4 text-sm text-text-secondary">No events captured.</p>
                    ) : (
                      selected.events.slice().reverse().map((event) => (
                        <div key={event.id} className="grid gap-3 px-4 py-3 md:grid-cols-[96px_104px_minmax(0,1fr)]">
                          <p className="font-mono text-xs text-text-secondary">{formatTime(event.timestamp)}</p>
                          <EventStatus status={event.status} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-text-primary">{event.type}</p>
                            <p className="mt-1 text-sm leading-5 text-text-secondary">{event.message}</p>
                            {Object.keys(event.metadata ?? {}).length > 0 && (
                              <pre className="mt-2 max-h-28 overflow-auto rounded-md border border-card-border bg-sidebar p-2 font-mono text-[11px] leading-5 text-text-secondary">
                                {JSON.stringify(event.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-card-border bg-card surface-inset">
                  <div className="border-b border-card-border px-4 py-3">
                    <h2 className="text-sm font-bold text-text-primary">Debug terminal</h2>
                    <p className="text-xs text-text-secondary">Safe operational commands for the selected session.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-4">
                    {COMMANDS.map((command) => (
                      <button
                        key={command.id}
                        onClick={() => {
                          setCommandInput(command.id);
                          executeCommand(command.id);
                        }}
                        disabled={running}
                        className="pressable focus-ring rounded-md border border-card-border bg-sidebar px-3 py-2 text-left font-mono text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary disabled:opacity-50"
                      >
                        {command.label}
                      </button>
                    ))}
                  </div>

                  <div className="border-y border-card-border bg-[#171411] p-4">
                    <div ref={terminalRef} className="h-[310px] overflow-y-auto rounded-md font-mono text-xs leading-5">
                      {terminalLines.slice(-80).map((line) => (
                        <p
                          key={line.id}
                          className={
                            line.tone === "input"
                              ? "text-accent"
                              : line.tone === "error"
                              ? "text-red-300"
                              : "text-[#d8d0c6]"
                          }
                        >
                          {line.text}
                        </p>
                      ))}
                    </div>
                  </div>

                  <form
                    className="flex gap-2 p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      executeCommand();
                    }}
                  >
                    <input
                      list="admin-commands"
                      value={commandInput}
                      onChange={(event) => setCommandInput(event.target.value)}
                      className="focus-ring min-w-0 flex-1 rounded-md border border-card-border bg-sidebar px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
                    />
                    <datalist id="admin-commands">
                      {COMMANDS.map((command) => (
                        <option key={command.id} value={command.id} />
                      ))}
                    </datalist>
                    <button
                      type="submit"
                      disabled={running}
                      className="pressable focus-ring rounded-md bg-accent px-4 py-2 text-xs font-bold text-ink hover:bg-accent-hover disabled:opacity-50"
                    >
                      {running ? "Running" : "Run"}
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-card-border bg-card p-4 surface-inset">
                  <h2 className="text-sm font-bold text-text-primary">Client environment</h2>
                  <dl className="mt-3 space-y-3 text-sm">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">User agent</dt>
                      <dd className="mt-1 break-words font-mono text-[11px] leading-5 text-text-primary">{selected.user_agent}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">First seen</dt>
                        <dd className="mt-1 font-mono text-xs text-text-primary">{formatTime(selected.first_seen)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Role</dt>
                        <dd className="mt-1 font-mono text-xs text-text-primary">{selected.role}</dd>
                      </div>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
