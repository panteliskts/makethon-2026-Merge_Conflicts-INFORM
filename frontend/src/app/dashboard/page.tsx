"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { clearDiagnosticsIdentity, setDiagnosticsIdentity, ingestFile } from "@/lib/api";
import InvoiceDataPanel, { type UploadedSource } from "@/components/InvoiceDataPanel";
import ChatPanel from "@/components/ChatPanel";
import ReconcilePanel from "@/components/ReconcilePanel";
import { ThemeToggle, LangToggle } from "@/components/NavControls";
import AccountSwitcher, { upsertSavedAccount } from "@/components/AccountSwitcher";
import { useLocale } from "@/lib/useLocale";

type Tab = "chat" | "reconcile";

export default function Home() {
  const { data: session } = useSession();
  const { t } = useLocale();
  const TABS: { id: Tab; label: string }[] = [
    { id: "chat", label: t.dashboard.tabs.chat },
    { id: "reconcile", label: t.dashboard.tabs.reconcile },
  ];

  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [sources, setSources] = useState<UploadedSource[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Shared file input ref lives here so both ChatPanel and InvoiceDataPanel can use it
  const fileInputRef = useRef<HTMLInputElement>(null);

  const role = session?.user?.role ?? "client";

  useEffect(() => {
    if (!session?.user?.email) return;
    setDiagnosticsIdentity({ email: session.user.email, name: session.user.name, role });
    upsertSavedAccount({
      email: session.user.email,
      name: session.user.name ?? session.user.email,
      role,
      image: session.user.image ?? undefined,
    });
  }, [session?.user?.email, session?.user?.name, role, session?.user?.image]);

  const activeSource = sources[activeIndex] ?? null;

  async function handleFilesSelected(files: FileList) {
    const allowed = ["pdf", "jpg", "jpeg", "png"];
    const validFiles = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return allowed.includes(ext);
    });

    if (validFiles.length === 0) {
      setUploadError("Please upload PDF, JPG, or PNG files only.");
      return;
    }

    setUploadError(null);
    setUploading(true);

    const newSources: UploadedSource[] = [];
    for (const file of validFiles) {
      try {
        const result = await ingestFile(file);
        // Use backend storage URL when available, else fall back to a local object URL
        const pdfUrl = result.preview_url || URL.createObjectURL(file);
        newSources.push({ sourceFile: result.source_file, pdfUrl });
      } catch (e: any) {
        setUploadError(e.message || `Failed to upload ${file.name}`);
      }
    }

    if (newSources.length > 0) {
      setSources((prev) => {
        const combined = [...prev, ...newSources];
        // Auto-select the first newly uploaded file
        setActiveIndex(combined.length - newSources.length);
        return combined;
      });
    }

    setUploading(false);

    // Reset the file input so the same file can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background">

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="grid shrink-0 grid-cols-[1fr_auto] gap-3 border-b border-card-border bg-sidebar px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-ink shadow-glow">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary">INFORM</p>
            <p className="hidden text-xs text-text-secondary sm:block">{t.dashboard.tagline}</p>
          </div>
        </div>

        <nav className="order-3 col-span-2 flex rounded-lg border border-card-border bg-background p-1 sm:order-none sm:col-span-1">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`pressable focus-ring flex-1 rounded-md px-4 py-2 text-sm ${
                activeTab === tab.id
                  ? "bg-paper font-bold text-ink shadow-inset"
                  : "text-text-secondary hover:bg-card hover:text-text-primary"
              }`}>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <ThemeToggle />
          <LangToggle />
          {role === "admin" && (
            <a href="/admin"
              className="pressable focus-ring hidden rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary md:inline-flex">
              Admin
            </a>
          )}
          {session?.user && (
            <AccountSwitcher
              current={{
                email: session.user.email ?? "",
                name: session.user.name ?? session.user.email ?? "",
                role,
                image: session.user.image ?? undefined,
              }}
              onSignOut={() => { clearDiagnosticsIdentity(); signOut({ callbackUrl: "/" }); }}
            />
          )}
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main id="main-content" className="flex-1 overflow-hidden">

        {activeTab === "chat" && (
          <div className="flex h-full flex-col lg:flex-row">
            {/* Left: invoice list */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-card-border lg:max-w-[320px] lg:border-b-0 lg:border-r">
              <InvoiceDataPanel
                sources={sources}
                activeIndex={activeIndex}
                onSelectSource={setActiveIndex}
                fileInputRef={fileInputRef}
                uploading={uploading}
                uploadError={uploadError}
                onFilesSelected={handleFilesSelected}
              />
            </div>

            {/* Right: chat */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ChatPanel
                sourceFile={activeSource?.sourceFile ?? null}
                onChunksHighlight={() => {}}
                onAttachClick={() => fileInputRef.current?.click()}
                onFileDrop={handleFilesSelected}
              />
            </div>
          </div>
        )}

        {activeTab === "reconcile" && (
          <div className="h-full overflow-y-auto">
            <ReconcilePanel />
          </div>
        )}

      </main>
    </div>
  );
}
