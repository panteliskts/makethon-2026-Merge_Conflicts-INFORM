"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession, signOut } from "next-auth/react";
import { clearDiagnosticsIdentity, setDiagnosticsIdentity, type ChunkResult } from "@/lib/api";
import ChatPanel from "@/components/ChatPanel";
import ReconcilePanel from "@/components/ReconcilePanel";
import { ThemeToggle, LangToggle } from "@/components/NavControls";
import { useLocale } from "@/lib/useLocale";

const PDFViewer = dynamic(() => import("@/components/PDFViewer"), { ssr: false });

type Tab = "chat" | "reconcile";

export default function Home() {
  const { data: session } = useSession();
  const { t } = useLocale();
  const TABS: { id: Tab; label: string }[] = [
    { id: "chat", label: t.dashboard.tabs.chat },
    { id: "reconcile", label: t.dashboard.tabs.reconcile },
  ];
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [activeBboxes, setActiveBboxes] = useState<ChunkResult[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const role = session?.user?.role ?? "client";

  useEffect(() => {
    setDiagnosticsIdentity({
      email: session?.user?.email,
      name: session?.user?.name,
      role,
    });
  }, [session?.user?.email, session?.user?.name, role]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
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
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pressable focus-ring flex-1 rounded-md px-4 py-2 text-sm ${
                activeTab === tab.id
                  ? "bg-paper font-bold text-ink shadow-inset"
                  : "text-text-secondary hover:bg-card hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <ThemeToggle />
          <LangToggle />
          {role === "admin" && (
            <a
              href="/admin"
              className="pressable focus-ring hidden rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary md:inline-flex"
            >
              Admin
            </a>
          )}
          {session?.user?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.user.image} alt="avatar" className="h-8 w-8 rounded-md" />
          )}
          {session?.user?.name && (
            <span className="hidden max-w-[9rem] truncate text-xs text-text-secondary lg:block">{session.user.name}</span>
          )}
          <button
            onClick={() => {
              clearDiagnosticsIdentity();
              signOut({ callbackUrl: "/" });
            }}
            className="pressable focus-ring rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary"
          >
            {t.nav.signout}
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1 overflow-hidden">
        {activeTab === "chat" && (
          <div className="flex h-full flex-col lg:flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-card-border lg:border-b-0 lg:border-r">
              <ChatPanel
                onChunksHighlight={setActiveBboxes}
                onPdfLoad={(url) => { setPdfUrl(url); setActiveBboxes([]); }}
                sourceFile={sourceFile}
                onSourceFileChange={setSourceFile}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <PDFViewer
                pdfUrl={pdfUrl}
                highlightedChunks={activeBboxes}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
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
