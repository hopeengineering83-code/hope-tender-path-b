"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { startQueuedVaultIngestion } from "../lib/ui/auto-pipeline";

type Diagnostics = {
  importVersion?: string;
  totals?: {
    documents?: number;
    extractedDocuments?: number;
    currentExperts?: number;
    currentProjects?: number;
    sourceVerifiedExperts?: number;
    sourceVerifiedProjects?: number;
    sourceVerifiedLegalRecords?: number;
    sourceVerifiedFinancialRecords?: number;
    sourceVerifiedComplianceRecords?: number;
  };
  gaps?: Array<{ severity: string; title: string; detail: string }>;
};

function automaticGapCopy(gap: { severity: string; title: string; detail: string }) {
  const legacyPolicy = /human review|review board|await human|re-reviewed|auto-approved|draft\/stale.*ready for use|records? available for use/i.test(
    `${gap.title} ${gap.detail}`,
  );
  if (!legacyPolicy) return gap;
  return {
    ...gap,
    severity: gap.severity === "CRITICAL" ? "HIGH" : gap.severity,
    title: "Automatic source verification required",
    detail: "Source verification runs automatically when a document is ingested — it remaps the source and checks the current exact values without any action here. Source-verified records are usable immediately; draft, stale, altered, expired, source-less, or unmatched records remain blocked until verification succeeds. Reprocess and verify re-runs it if a record is stuck.",
  };
}

export default function CompanyVaultVerificationPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/company/knowledge/repair", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { diagnostics?: Diagnostics; error?: string };
      if (!response.ok || !data.diagnostics) throw new Error(data.error || "Could not load Company Vault verification status.");
      setDiagnostics(data.diagnostics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Company Vault verification status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 30 seconds — no manual Refresh button needed.
  useEffect(() => {
    const interval = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function reprocess() {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      // Re-import owns the strong repair path: it re-reads stored file bytes,
      // re-runs extraction/OCR, rebuilds records, remaps sources, and lets the
      // ingestion worker promote only evidence that verifies successfully.
      const response = await fetch("/api/company/reimport", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Automatic source verification could not be queued.");
      void startQueuedVaultIngestion();
      // Reprocessing re-reads stored file bytes. With no documents there are no
      // bytes to re-read, so it will complete and verify nothing — promising
      // "no further action is needed" there is how an owner ends up clicking
      // Reprocess repeatedly against a vault that can never move off zero.
      setMessage(
        (diagnostics?.totals?.documents ?? 0) === 0
          ? "Reprocessing was queued, but this vault has no uploaded documents, so there is nothing to verify against and the verified counts will stay at zero. Upload the original source files under Company Vault → Documents; verification then runs automatically, with no approval step."
          : "Source-byte reprocessing and automatic verification were queued. Matching refreshes source authority again before it runs, so no further action is needed here.",
      );
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Automatic source verification could not be queued.");
    } finally {
      setWorking(false);
    }
  }

  const totals = diagnostics?.totals;
  const supportVerified =
    (totals?.sourceVerifiedLegalRecords ?? 0) +
    (totals?.sourceVerifiedFinancialRecords ?? 0) +
    (totals?.sourceVerifiedComplianceRecords ?? 0);
  const gaps = useMemo(
    () => (diagnostics?.gaps ?? []).map(automaticGapCopy),
    [diagnostics?.gaps],
  );

  if (loading && !diagnostics) {
    return (
      <div role="status" aria-live="polite" className="py-24 text-center text-sm text-slate-700">
        <svg className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading automatic verification status…
        <span className="sr-only">Loading automatic verification status</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Vault</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Automatic Verification</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Company Vault records are promoted automatically when their current exact values match owned, byte-verified source evidence. No human approval step is required between the Vault and Run Engine.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void reprocess()} disabled={working} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {working ? "Queuing…" : "Reprocess and verify"}
          </button>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm">Back to Vault</Link>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        <h2 className="font-semibold">Runtime authority</h2>
        <p className="mt-1 leading-6">Current SOURCE_VERIFIED evidence and current authenticated REVIEWED evidence are equally eligible for matching, generation, export, and Final ZIP. Draft, source-less, stale, altered, expired, or unmatched evidence remains blocked.</p>
        <p className="mt-2 leading-6">
          <span className="font-semibold">Partial verification (per-field trust):</span> when a record&rsquo;s identity field (expert name, project name, legal/compliance title, or financial year+type) is verified against source bytes but some inferred fields are not, the record is SOURCE_VERIFIED on its identity. Inferred fields that could not be verified remain non-authoritative — they are listed in the record&rsquo;s provenance payload and <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">canUseVaultRecordField</code> returns <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">false</code> for them. Consumers that cite a specific field (e.g., an expert&rsquo;s years of experience) check the per-field trust before using it.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5"><p className="text-xs uppercase text-slate-400">Documents</p><p className="mt-1 text-3xl font-bold">{totals?.documents ?? 0}</p><p className="text-xs text-slate-500">{totals?.extractedDocuments ?? 0} extracted</p></div>
        <div className="rounded-2xl border bg-white p-5"><p className="text-xs uppercase text-slate-400">Verified experts</p><p className="mt-1 text-3xl font-bold">{totals?.sourceVerifiedExperts ?? 0}</p><p className="text-xs text-slate-500">{totals?.currentExperts ?? 0} total</p></div>
        <div className="rounded-2xl border bg-white p-5"><p className="text-xs uppercase text-slate-400">Verified projects</p><p className="mt-1 text-3xl font-bold">{totals?.sourceVerifiedProjects ?? 0}</p><p className="text-xs text-slate-500">{totals?.currentProjects ?? 0} total</p></div>
        <div className="rounded-2xl border bg-white p-5"><p className="text-xs uppercase text-slate-400">Verified support</p><p className="mt-1 text-3xl font-bold">{supportVerified}</p><p className="text-xs text-slate-500">legal · financial · compliance</p></div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">Evidence gaps</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{gaps.length}</span></div>
        <div className="mt-4 space-y-3">
          {gaps.length === 0 ? (
            <p className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">No source-authority gaps detected.</p>
          ) : gaps.map((gap, index) => (
            <article key={`${gap.title}-${index}`} className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">{gap.severity}</p>
              <p className="mt-1 font-medium text-slate-900">{gap.title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{gap.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
