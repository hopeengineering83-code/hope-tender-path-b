"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, CrossIcon, RefreshIcon, LockIcon } from "./icons";

type FinalPackageReadiness = {
  summary?: { blockerCount?: number };
  requirements?: { blockers?: unknown[] };
  evidence?: { blockers?: unknown[] };
  documents?: {
    required?: unknown[];
    missingRequired?: unknown[];
    exportReady?: unknown[];
    blockers?: unknown[];
  };
  export?: {
    ready?: boolean;
    zipReady?: boolean;
    pdfRequired?: boolean;
    requiredPdfMissing?: boolean;
    blockers?: unknown[];
    manifest?: { ready?: boolean; missingRequiredFiles?: unknown[] };
  };
};

type ReadinessResponse = {
  ok?: boolean;
  model?: FinalPackageReadiness;
  error?: string;
};

function blockerCount(model: FinalPackageReadiness | null): number {
  if (!model) return 0;
  return (
    (model.summary?.blockerCount ?? 0) +
    (model.requirements?.blockers?.length ?? 0) +
    (model.evidence?.blockers?.length ?? 0) +
    (model.documents?.blockers?.length ?? 0) +
    (model.export?.blockers?.length ?? 0)
  );
}

function finalPackageGatesPassed(model: FinalPackageReadiness | null): boolean {
  if (!model) return false;
  const requiredCount = model.documents?.required?.length ?? 0;
  const exportReadyCount = model.documents?.exportReady?.length ?? 0;
  return Boolean(
    requiredCount > 0 &&
      exportReadyCount >= requiredCount &&
      (model.documents?.missingRequired?.length ?? 0) === 0 &&
      blockerCount(model) === 0 &&
      model.export?.ready === true &&
      model.export?.zipReady === true &&
      model.export?.manifest?.ready === true &&
      (model.export?.manifest?.missingRequiredFiles?.length ?? 0) === 0 &&
      model.export?.requiredPdfMissing !== true,
  );
}

export function TenderDownloadActionsPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState<FinalPackageReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const gatesPassed = finalPackageGatesPassed(model);
  const blockers = blockerCount(model);

  async function refreshReadiness() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/final-package-readiness`, { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as ReadinessResponse;
      if (!res.ok || data.ok === false || !data.model) {
        throw new Error(data.error ?? `Final package readiness failed (${res.status})`);
      }
      setModel(data.model);
    } catch {
      setError("Final package gates could not be checked. Resolve blockers in Export Readiness and retry.");
      setModel(null);
    } finally {
      setChecking(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this tender and all generated documents? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}`, { method: "DELETE" });
      if (res.ok) router.push("/dashboard/tenders");
      else {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to delete tender.");
      }
    } catch {
      alert("Network error — could not delete tender.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section id="final-package-download-actions" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Final package download gate</h3>
          <p className="mt-1 max-w-3xl text-xs text-slate-600">
            Final ZIP download stays disabled until the Build Plan, evidence, validation, approval,
            PDF, byte-integrity manifest, and ZIP gates all pass. The download route re-checks these
            gates server-side before serving bytes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshReadiness()}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon /> {checking ? "Checking…" : "Check final package gates"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {gatesPassed ? (
          <a
            href={`/api/tenders/${tenderId}/download?type=zip`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            title="All final-package gates passed — download the final submission ZIP."
          >
            <DownloadIcon /> Download Final ZIP
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-500"
            title="Download blocked until every final-package gate passes."
          >
            <LockIcon /> Download blocked — final package gates not passed
          </button>
        )}
        <span className="text-xs text-slate-500">
          {model
            ? gatesPassed
              ? "All final-package gates passed."
              : `${blockers} blocker(s); required ${model.documents?.required?.length ?? 0}, export-ready ${model.documents?.exportReady?.length ?? 0}.`
            : "Run the final-package gate check before downloading."}
        </span>
        {canMutate && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            title="Delete this tender and all generated documents"
          >
            <CrossIcon /> {deleting ? "Deleting…" : "Delete tender"}
          </button>
        )}
      </div>
    </section>
  );
}
