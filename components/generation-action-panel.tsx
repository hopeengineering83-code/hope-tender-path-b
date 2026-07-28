"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseRepairMetadataResponse, buildRepairMessage } from "../lib/engine/repair-metadata-contract";
import { GenerationProgressPanel } from "./generation-progress-panel";
import { CanonicalStatusBadge } from "./canonical-status-badge";
import { BlockerActionLink } from "./blocker-action-link";
import { DocumentGenerateIcon, RefreshIcon, WarningIcon, CheckCircleIcon, BanIcon } from "./icons";
import { CANONICAL_STATUS_CONFIG, type CanonicalModuleStatus } from "../lib/engine/canonical-readiness-state";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";

type GenerationReadiness = {
  ready: boolean;
  supportPackageReady?: boolean;
  fullProposalReady?: boolean;
  fullProposalBlockers?: Array<{ code: string; message: string; nextAction?: string }>;
  blockers?: Array<{ code: string; message: string; nextAction?: string }>;
  warnings?: Array<{ code: string; message: string; nextAction?: string }>;
  counts?: {
    selectedExperts?: number;
    reviewedExpertMatches?: number;
    selectedProjects?: number;
    reviewedProjectMatches?: number;
  };
};

type GenerateResponse = {
  jobId?: string;
  error?: string;
  nextAction?: string;
  warnings?: string[];
  diagnosticId?: string;
};

function shortAction(action?: string): string {
  if (action === "RUN_ENGINE") return "Run Engine first.";
  if (action === "REVIEW_MATCHES") return "Review/select matching evidence.";
  if (action === "EDIT_TENDER_METADATA") return "Open Tender Detail and fill missing Tender Details.";
  if (action === "BUILD_SUBMISSION_PLAN") return "Review and confirm the Build Plan first.";
  if (action === "RUN_OCR_OR_UPLOAD_CLEARER_SCAN") return "Run OCR or upload a clearer scan.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Check Extraction Quality.";
  return "Resolve the readiness blockers first.";
}

export function isGenerationActionEnabled(canonicalGenerationState: CanonicalModuleStatus, serverGateAllowsGeneration: boolean): boolean {
  return canonicalGenerationState === "READY" || (canonicalGenerationState === "WARNING" && serverGateAllowsGeneration);
}

type GenerationActionButtonProps = {
  canonicalGenerationState: CanonicalModuleStatus;
  fullProposalReady: boolean;
  busy: boolean;
  blockedReason?: string;
  onClick?: () => void;
};

export function GenerationActionButton({ canonicalGenerationState, fullProposalReady, busy, blockedReason, onClick }: GenerationActionButtonProps) {
  const blocked = !fullProposalReady;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={blocked || busy}
      aria-disabled={blocked || busy}
      className={fullProposalReady
        ? "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        : "inline-flex items-center gap-1.5 cursor-not-allowed rounded-lg border border-red-200 bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"}
      title={blocked ? blockedReason ?? "Generation blocked — resolve the blockers listed below." : "Generate proposal documents."}
    >
      {fullProposalReady ? <DocumentGenerateIcon /> : <BanIcon />} {busy ? "Generating…" : canonicalGenerationState === "RUNNING" ? "Generating…" : blocked ? "Resolve blockers first" : "Generate Docs"}
    </button>
  );
}

export function GenerationActionPanel({ tenderId, readiness, canonicalReadiness, canMutate = false }: { tenderId: string; readiness: GenerationReadiness | null; canonicalReadiness?: CanonicalTenderReadiness | null; canMutate?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");
  const [jobId, setJobId] = useState<string | null>(null);

  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const supportReady = readiness?.supportPackageReady ?? readiness?.ready ?? false;
  const serverGateAllowsGeneration = readiness?.fullProposalReady ?? readiness?.ready ?? false;
  const canonicalGenerationState: CanonicalModuleStatus = canonicalReadiness?.modules.generation.state ?? (serverGateAllowsGeneration ? "READY" : "BLOCKED");
  const fullProposalReady = isGenerationActionEnabled(canonicalGenerationState, serverGateAllowsGeneration);
  const fullProposalBlockers = readiness?.fullProposalBlockers ?? [];
  const blocked = !fullProposalReady;
  const metadataBlockerPresent = fullProposalBlockers.some((b) => b.code === "FINAL_PACKAGE_FACTS_UNCONFIRMED" || b.code === "FULL_PROPOSAL_METADATA_INCOMPLETE");

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
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        setKind("error");
        setMessage(errBody.error ?? `Repair failed (HTTP ${res.status}).`);
        return;
      }
      const raw = await res.json().catch(() => null);
      const parsed = parseRepairMetadataResponse(raw);
      if (!parsed) {
        setKind("error");
        setMessage("Repair returned a malformed response. Try again or correct manually.");
        return;
      }
      const outcome = parsed.outcomesByField["evaluationMethodology"];
      if (outcome?.status === "REPAIRED") {
        setKind("success");
        setMessage("Evaluation criteria repaired from source.");
        startTransition(() => router.refresh());
      } else if (outcome?.status === "NOT_FOUND") {
        setKind("info");
        setMessage("Evaluation criteria not found in the tender source.");
      } else if (outcome?.status === "SKIPPED") {
        setKind("info");
        setMessage("Evaluation criteria repair was skipped (field already has a value).");
      } else if (outcome?.status === "REJECTED") {
        setKind("info");
        setMessage("Evaluation criteria value was rejected (placeholder pattern).");
      } else {
        setKind("error");
        setMessage("Repair failed — no valid outcome returned.");
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
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        setKind("error");
        setMessage(errBody.error ?? `Repair failed (HTTP ${res.status}). The blocker remains — review and correct manually.`);
        return;
      }
      const raw = await res.json().catch(() => null);
      const parsed = parseRepairMetadataResponse(raw);
      if (!parsed) {
        setKind("error");
        setMessage("Repair returned a malformed response. The blocker remains — try again or correct manually.");
        return;
      }
      const { message, kind } = buildRepairMessage(parsed.outcomes);
      setKind(kind);
      setMessage(message);
      if (parsed.success) {
        startTransition(() => router.refresh());
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
      setMessage("Review optional warnings before proceeding.");
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

  const canonicalConfig = CANONICAL_STATUS_CONFIG[canonicalGenerationState];
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
          {/* Generate Docs disable invariant: disabled={!fullProposalReady || running || isPending} */}
          {canMutate ? (
            <GenerationActionButton
              canonicalGenerationState={canonicalGenerationState}
              fullProposalReady={fullProposalReady}
              busy={running || isPending}
              blockedReason={blocked ? canonicalReadiness?.modules.generation.reason : undefined}
              onClick={runGenerate}
            />
          ) : (
            <p className="text-xs text-slate-500 italic">Read-only — generation requires ADMIN or PROPOSAL_MANAGER role</p>
          )}
        </div>

        {!fullProposalReady && fullProposalBlockers.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Full proposal blocked because:</p>
            <ul className="mt-2 space-y-1.5 text-sm text-red-800">
              {fullProposalBlockers.slice(0, 6).map((item, index) => (
                <li key={`fp-${item.code}-${index}`} className="flex flex-wrap items-start gap-1">
                  <span className="before:content-['•'] before:mr-1.5 before:text-red-400">{item.message}</span>
                  {item.nextAction && (
                    <BlockerActionLink
                      tenderId={tenderId}
                      actionCode={item.nextAction}
                      canMutate={canMutate}
                      onDone={() => router.refresh()}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fullProposalReady && !supportReady && blockers.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm text-red-800">
            {blockers.slice(0, 4).map((item, index) => (
              <li key={`b-${item.code}-${index}`} className="flex flex-wrap items-start gap-1">
                <span className="before:content-['•'] before:mr-1.5 before:text-red-400">{item.message}</span>
                {item.nextAction && (
                  <BlockerActionLink
                    tenderId={tenderId}
                    actionCode={item.nextAction}
                    canMutate={canMutate}
                    onDone={() => router.refresh()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {(fullProposalReady || supportReady) && warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm text-emerald-800">
            {warnings.slice(0, 3).map((item, index) => (
              <li key={`w-${item.code}-${index}`} className="flex flex-wrap items-start gap-1">
                <span className="before:content-['•'] before:mr-1.5 before:text-emerald-400">{item.message}</span>
                {item.nextAction && (
                  <BlockerActionLink
                    tenderId={tenderId}
                    actionCode={item.nextAction}
                    canMutate={canMutate}
                    onDone={() => router.refresh()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {canMutate && metadataBlockerPresent && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-700">Tender Details incomplete — source-grounded repair available</p>
            <p className="mt-1 text-xs text-amber-600">Use the source-grounded repair to extract missing Tender Details fields directly from the tender document.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runRepairMetadata}
                disabled={running || isPending}
                className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-60"
                title="Repair evaluation criteria fields from the tender source"
              >
                <RefreshIcon /> Repair evaluation criteria only
              </button>
              <button
                type="button"
                onClick={runRepairAllMetadata}
                disabled={running || isPending}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                title="Repair all empty Tender Details fields from the tender source"
              >
                <RefreshIcon /> Repair all empty fields from source
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
