"use client";

import { useState } from "react";
import { reconcile, listSources, type ReconcileResult } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-green-500/20 text-green-400 border border-green-500/30",
  UNPAID: "bg-red-500/20 text-red-400 border border-red-500/30",
  PARTIAL: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
};

export default function ReconcilePanel() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<string>("");
  const [sources, setSources] = useState<string[]>([]);
  const [results, setResults] = useState<ReconcileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSources() {
    const s = await listSources();
    setSources(s);
  }

  async function handleReconcile() {
    if (!bankFile) {
      setError("Please upload a bank statement CSV.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await reconcile(bankFile, null, sourceFile || undefined);
      setResults(data);
    } catch (e: any) {
      setError(e.message || "Reconciliation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase text-ember">Payment review</p>
          <h2 className="mt-2 text-2xl font-black text-text-primary">Bank Reconciliation</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Compare an indexed invoice against bank statement rows.
          </p>
        </div>
        <button
          onClick={loadSources}
          className="pressable focus-ring rounded-md border border-card-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent/60 hover:text-text-primary"
        >
          Refresh invoices
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.05fr_0.95fr]">
        <div className="surface-inset rounded-xl border border-card-border bg-card p-5">
          <p className="mb-3 text-sm font-semibold text-text-primary">Bank statement CSV</p>
          <label className="block cursor-pointer">
            <div className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              bankFile ? "border-accent bg-accent/10" : "border-card-border hover:border-accent/50"
            }`}>
              {bankFile ? (
                <p className="font-mono text-sm text-accent">{bankFile.name}</p>
              ) : (
                <p className="text-sm text-text-secondary">Select a CSV export from the bank</p>
              )}
            </div>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setBankFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="surface-inset rounded-xl border border-card-border bg-card p-5">
          <p className="mb-3 text-sm font-semibold text-text-primary">Indexed invoice source</p>
          <div>
            <select
              value={sourceFile}
              onFocus={loadSources}
              onChange={(e) => setSourceFile(e.target.value)}
              className="focus-ring w-full rounded-md border border-card-border bg-sidebar px-3 py-3 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="">Use all indexed invoices</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <p className="mt-3 text-xs leading-5 text-text-secondary">
              Upload invoices in the Chat tab first. This panel reads the invoice chunks already stored in ChromaDB.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={handleReconcile}
        disabled={loading || !bankFile}
        className="pressable focus-ring rounded-md bg-accent px-6 py-3 text-sm font-bold text-ink hover:bg-accent-hover disabled:opacity-40"
      >
        {loading ? "Reconciling..." : "Run Reconciliation"}
      </button>

      {results.length > 0 && (
        <div className="surface-inset overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text-primary">Results</h3>
            <div className="flex gap-2 text-xs">
              <span className="text-green-400">{results.filter((r) => r.status === "PAID").length} Paid</span>
              <span className="text-yellow-400">{results.filter((r) => r.status === "PARTIAL").length} Partial</span>
              <span className="text-red-400">{results.filter((r) => r.status === "UNPAID").length} Unpaid</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-xs text-text-secondary">
                <th className="px-4 py-2 text-left">Invoice #</th>
                <th className="px-4 py-2 text-right">Invoice Amount</th>
                <th className="px-4 py-2 text-right">Bank Amount</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-card-border/40 hover:bg-sidebar/50">
                  <td className="px-4 py-3 text-text-primary font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-4 py-3 text-right text-text-primary">
                    {r.amount.toLocaleString("el-GR", { style: "currency", currency: "EUR" })}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {r.bank_amount != null
                      ? r.bank_amount.toLocaleString("el-GR", { style: "currency", currency: "EUR" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
