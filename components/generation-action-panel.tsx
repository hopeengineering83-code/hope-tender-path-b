"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CanonicalStatusBadge } from "./canonical-status-badge";
import { CANONICAL_STATUS_CONFIG, type CanonicalModuleStatus } from "../lib/engine/canonical-readiness-state";
import { GenerationProgressPanel } from "./generation-progress-panel";

type GenerateResponse = {
  success?: boolean;
  jobId?: string;
  error?: string;
  code?: string;
  nextAction?: string;
  diagnosticId?: string;
  warnings?: string[];
  plannedRecordCount?: number;
  supportDocumentCount?: number;
  letterheadAppliedCount?: number;
  promotedExpertCount?: number;
  promotedProjectCount?: number;
  readiness?: Record<string, number>;
};

function shortAction(action: string): string {
  if (action === "OPEN_COMPANY_READINESS") return "(Open Company Readiness)";
  if (action === "EDIT_TENDER") return "(Edit Tender)";
  if (action === "RERUN_AI_ANALYZE") return "(Re-run AI Analyze)";
  if (action === "RUN_OCR_OR_UPLOAD_CLEARER_SCAN") return "(Run OCR or Upload Clearer Scan)";
  if (action === "OPEN_EXTRACTION_QUALITY") return "(Check Extraction Quality)";
  return `(${action})`;
}

export function isGenerationActionEnabled(canonicalGenerationState: string, fullProposalReady: boolean): boolean {
    return (canonicalGenerationState === "READY" || canonicalGenerationState === "WARNING") && fullProposalReady;
}

type GenerationActionButtonProps = {
  canonicalGenerationState: string;
  fullProposalReady: boolean;
  busy: boolean;
  blockedReason?: string;
  onClick?: () => void;
};

export function GenerationActionButton({ canonicalGenerationState, fullProposalReady, busy, blockedReason, onClick }: GenerationActionButtonProps) {
  const disabled = !isGenerationActionEnabled(canonicalGenerationState, fullProposalReady) || busy;
  const label = busy ? "Generating…" : canonicalGenerationState === "READY" ? "Generate Docs" : "Resolve blockers first";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={blockedReason}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        fullProposalReady ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500"
      }`}
    >
      {label}
    </button>
  );
}

export function GenerationActionPanel({
  tenderId,
  readiness,
  canonicalReadiness,
}: {
  tenderId: string;
  readiness: any;
  canonicalReadiness: any;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");
  const [jobId, setJobId] = useState<string | null>(null);

  const fullProposalReady = Boolean(readiness?.fullProposalReady);
  const supportReady = Boolean(readiness?.supportPackageReady);
  const fullProposalBlockers = readiness?.fullProposalBlockers ?? [];
  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const canonicalGenerationState = (canonicalReadiness?.modules.generation.status ?? "NOT_RUN") as CanonicalModuleStatus;
  const blocked = canonicalGenerationState === "BLOCKED";

  const metadataBlockerPresent = readiness?.blockers?.some((b: any) => b.code === "TENDER_METADATA_INCOMPLETE");

  const autoPromotionAvailable = Boolean(
    readiness?.counts &&
    (((readiness.counts.selectedExperts ?? 0) === 0 && (readiness.counts.reviewedExpertMatches ?? 0) > 0) ||
      ((readiness.counts.selectedProjects ?? 0) === 0 && (readiness.counts.reviewedProjectMatches ?? 0) > 0)),
  );

  const ALL_REPAIRABLE_FIELDS = [
    "evaluationMethodology",
    "reference",
    "deadline",
    "submissionEmails",
    "submissionMethod",
    "pageLimit",
    "validityDays",
    "bidBondAmount",
    "numberOfCopiesRequired",
    "mandatorySiteVisit",
  ] as const;

  async function runRepairMetadata() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/repair-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["evaluationMethodology"] }),
      });
      const result = await res.json().catch(() => ({})) as { status: string; value?: string };
      if (result.status === "REPAIRED") {
        setKind("success");
        setMessage("evaluationMethodology repaired from source.");
        startTransition(() => router.refresh());
      } else if (result.status === "NOT_FOUND") {
        setKind("info");
        setMessage("evaluationMethodology not found in the tender source.");
      } else if (result.status === "SKIPPED") {
        setKind("info");
        setMessage("evaluationMethodology repair was skipped (field already has a value).");
      } else {
        setKind("error");
        setMessage("Repair failed.");
      }
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? error.message : "Repair failed due to a network error.");
    } finally {
      setRunning(false);
    }
  }

  async function runRepairAllMetadata() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/repair-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ALL_REPAIRABLE_FIELDS }),
      });
      const data = await res.json().catch(() => ({ results: [] })) as { results: Array<{ field: string; status: string }> };
      const results = data.results ?? [];
      const repairedFields = results.filter((r) => r.status === "REPAIRED");
      const notFoundFields = results.filter((r) => r.status === "NOT_FOUND");
      const skippedFields = results.filter((r) => r.status === "SKIPPED");
      if (repairedFields.length > 0) {
        setKind("success");
        setMessage(`Repaired ${repairedFields.length} field(s). ${notFoundFields.length} not found, ${skippedFields.length} skipped.`);
        startTransition(() => router.refresh());
      } else if (notFoundFields.length > 0) {
        setKind("info");
        setMessage(`${notFoundFields.length} field(s) not found in source. ${skippedFields.length} skipped.`);
      } else {
        setKind("info");
        setMessage(`All fields skipped (${skippedFields.length} already have values).`);
      }
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? error.message : "Batch repair failed due to a network error.");
    } finally {
      setRunning(false);
    }
  }

  async function runGenerate() {
    if (!fullProposalReady) {
      setKind("error");
      setMessage("Generation is blocked by canonical readiness. Resolve the listed blockers first.");
      return;
    }
    setRunning(true);
    setMessage(null);
    setJobId(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/generate`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as GenerateResponse;
      if (!res.ok) {
        const hint = data.nextAction ? ` ${shortAction(data.nextAction)}` : "";
        const diag = data.diagnosticId ? ` [diag ${data.diagnosticId}]` : "";
        setKind("error");
        setMessage(`${data.error || "Generation failed."}${hint}${diag}`.trim());
        return;
      }
      if (data.jobId) setJobId(data.jobId);
      const warningText = Array.isArray(data.warnings) && data.warnings.length > 0 ? ` Warnings: ${data.warnings.slice(0, 2).join(" ")}` : "";
      setKind("success");
      setMessage(`Generation completed.${warningText}`.trim());
      startTransition(() => router.refresh());
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? `Generation failed. ${error.message}` : "Generation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  const canonicalConfig = CANONICAL_STATUS_CONFIG[canonicalGenerationState] || CANONICAL_STATUS_CONFIG.NOT_RUN;
  const panelClass = `${canonicalConfig.borderClass} ${canonicalConfig.bgClass}`;
  const labelClass = canonicalConfig.textClass;
  const headlineText = canonicalGenerationState === "READY"
    ? "Canonical generation readiness: ready"
    : canonicalGenerationState === "WARNING"
      ? "Canonical generation readiness: warnings present"
      : canonicalGenerationState === "RUNNING"
        ? "Generation is running"
        : "Canonical generation readiness: not ready";

  return (
    <>
      <section id="generated-documents" className={`mb-4 rounded-2xl border p-5 shadow-sm ${panelClass}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>Generation action</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900">{headlineText}</h2><CanonicalStatusBadge status={canonicalGenerationState} size="sm" /></div>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              The Generate Docs action is controlled by canonical generation readiness and the existing strict server gate. When canonical readiness is not READY, no enabled green action state is shown.
            </p>
            {autoPromotionAvailable && (
              <p className="mt-2 text-xs font-medium text-emerald-700">Reviewed matches are available for automatic promotion if no manual selection has been made.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 font-semibold ${supportReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>Support evidence: {supportReady ? "available" : "blocked"}</span>
              <span className={`rounded-full px-3 py-1 font-semibold ${fullProposalReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>Full proposal: {fullProposalReady ? "ready" : "blocked"}</span>
            </div>
          </div>
          <GenerationActionButton
            canonicalGenerationState={canonicalGenerationState}
            fullProposalReady={fullProposalReady}
            busy={running || isPending}
            blockedReason={blocked ? (canonicalReadiness?.modules.generation.reason as string) : undefined}
            onClick={runGenerate}
          />
        </div>

        {!fullProposalReady && (
            <div className="mt-4 rounded-xl border border-red-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Proposal Generation Blocked:</p>
                <p className="mt-1 text-sm text-red-800">Prerequisites are not met. Review and resolve the blockers below before generating the proposal documents.</p>

                {fullProposalBlockers.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
                        {fullProposalBlockers.slice(0, 6).map((item: any, index: number) => <li key={`fp-${item.code}-${index}`}>{item.message}</li>)}
                    </ul>
                )}

                {!fullProposalBlockers.length && blockers.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
                        {blockers.slice(0, 4).map((item: any, index: number) => <li key={`b-${item.code}-${index}`}>{item.message}</li>)}
                    </ul>
                )}
            </div>
        )}

        {(fullProposalReady || supportReady) && warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-800">
            {warnings.slice(0, 3).map((item: any, index: number) => <li key={`w-${item.code}-${index}`}>{item.message}</li>)}
          </ul>
        )}

        {metadataBlockerPresent && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-700">Metadata incomplete — source-grounded repair available</p>
            <p className="mt-1 text-xs text-amber-600">Use the source-grounded repair to extract missing metadata fields directly from the tender document.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runRepairMetadata}
                disabled={running || isPending}
                className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-50"
              >
                Repair evaluationMethodology only
              </button>
              <button
                type="button"
                onClick={runRepairAllMetadata}
                disabled={running || isPending}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Repair all empty fields from source
              </button>
            </div>
          </div>
        )}

        {message && (
          <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${kind === "success" ? "border-emerald-200 bg-white text-emerald-800" : kind === "error" ? "border-red-200 bg-white text-red-700" : "border-slate-200 bg-white text-slate-700"}`}>
            {message}
          </div>
        )}
      </section>
      <GenerationProgressPanel tenderId={tenderId} jobId={jobId} />
    </>
  );
}
