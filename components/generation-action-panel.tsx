"use client";

// Gap 2 + Gap 3: Text-based automatic status surface.
//
// Replaces the old GenerationActionPanel that had Generate Docs button,
// BlockerActionLink instances, Repair Tender Details button, support/full-
// proposal pills, duplicated readiness badges, and icons.
//
// The new surface shows exactly one status:
//   PROCESSING_AUTOMATICALLY     — workflow is running
//   GENUINE_SOURCE_BLOCKED       — a genuine source blocker exists
//   LEGAL_RELEASE_REQUIRED       — a legal signature/declaration or ADMIN
//                                  release decision is required
//   READY_TO_DOWNLOAD            — the final ZIP is ready
//   FAILED_SECURITY_OR_INTEGRITY — a security or integrity failure occurred
//
// No icons, badges, emoji, icon packages or decorative graphics.

import React from "react";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import type { CanonicalModuleStatus } from "../lib/engine/canonical-readiness-state";

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

export type ReleaseStatus =
  | "PROCESSING_AUTOMATICALLY"
  | "GENUINE_SOURCE_BLOCKED"
  | "LEGAL_RELEASE_REQUIRED"
  | "READY_TO_DOWNLOAD"
  | "FAILED_SECURITY_OR_INTEGRITY";

/**
 * Derive the single release status from the canonical readiness and
 * generation readiness data. This is the ONE authority the UI reads.
 */
export function deriveReleaseStatus(
  readiness: GenerationReadiness | null,
  canonicalReadiness?: CanonicalTenderReadiness | null,
): ReleaseStatus {
  if (!readiness && !canonicalReadiness) return "PROCESSING_AUTOMATICALLY";

  // READY_TO_DOWNLOAD: canonical readiness says final export is ready.
  if (canonicalReadiness?.readyForFinalExport) return "READY_TO_DOWNLOAD";
  if (readiness?.ready && (readiness.fullProposalReady ?? false)) return "READY_TO_DOWNLOAD";

  // Collect all blocker codes from both sources. canonicalReadiness.blockers
  // is string[] (just codes); readiness.blockers is Array<{code, message}>.
  const blockerCodes: string[] = [];
  for (const b of readiness?.blockers ?? []) blockerCodes.push(b.code);
  for (const b of readiness?.fullProposalBlockers ?? []) blockerCodes.push(b.code);
  for (const code of canonicalReadiness?.blockers ?? []) blockerCodes.push(code);

  // FAILED_SECURITY_OR_INTEGRITY: security or integrity failure.
  const securityFailureCodes = [
    "FAILED_SECURITY_OR_INTEGRITY",
    "CONTENT_HASH_MISMATCH",
    "INVALID_BYTE_SIGNATURE",
    "OFFICIAL_BYTES_LOST",
    "TENANT_SCOPE_VIOLATION",
  ];
  if (blockerCodes.some((code) => securityFailureCodes.includes(code))) {
    return "FAILED_SECURITY_OR_INTEGRITY";
  }

  // GENUINE_SOURCE_BLOCKED: a genuine source blocker exists.
  const genuineSourceBlockerCodes = [
    "SOURCE_REQUIRED_FOR_APPROVAL",
    "MISSING_TENDER_SOURCE_FORM",
    "OFFICIAL_BYTES_LOST",
    "NO_ACTIVE_GENERATED_DOCUMENTS",
    "NO_CURRENT_CONFIRMED_BUILD_PLAN",
    "MISSING_PLANNED_FILES",
    "MISSING_TENDER_FORM_FIELDS",
    "HARD_COMPLIANCE_BLOCKER",
  ];
  if (blockerCodes.some((code) => genuineSourceBlockerCodes.includes(code))) {
    return "GENUINE_SOURCE_BLOCKED";
  }

  // LEGAL_RELEASE_REQUIRED: a legal signature, declaration, or ADMIN release
  // decision is required. These are the ONLY remaining manual steps.
  const legalReleaseCodes = [
    "LEGAL_RELEASE_REQUIRED",
    "LEGAL_SIGNATURE_REQUIRED",
    "ADMIN_RELEASE_REQUIRED",
    "AUTHORITY_REVIEW_REQUIRED",
    "EVALUATOR_OBJECTION_REQUIRES_RESOLUTION",
    "FALLBACK_ANALYSIS_APPROVAL_REQUIRED",
  ];
  if (blockerCodes.some((code) => legalReleaseCodes.includes(code))) {
    return "LEGAL_RELEASE_REQUIRED";
  }

  // If there are any other blockers, still GENUINE_SOURCE_BLOCKED.
  if (blockerCodes.length > 0) return "GENUINE_SOURCE_BLOCKED";

  // Otherwise, the workflow is processing automatically.
  return "PROCESSING_AUTOMATICALLY";
}

/**
 * The status label shown to the user. Plain text — no icons, no badges.
 */
function statusLabel(status: ReleaseStatus): string {
  switch (status) {
    case "PROCESSING_AUTOMATICALLY":
      return "Processing automatically";
    case "GENUINE_SOURCE_BLOCKED":
      return "Genuine source blocked";
    case "LEGAL_RELEASE_REQUIRED":
      return "Legal release required";
    case "READY_TO_DOWNLOAD":
      return "Ready to download";
    case "FAILED_SECURITY_OR_INTEGRITY":
      return "Security or integrity failure";
  }
}

/**
 * A plain-text explanation of what the status means. No icons.
 */
function statusExplanation(status: ReleaseStatus): string {
  switch (status) {
    case "PROCESSING_AUTOMATICALLY":
      return "The workflow is running. Byte verification, extraction, analysis, matching, generation, validation, PDF finalization, and package reconciliation proceed automatically. You may close or refresh this page — processing continues server-side.";
    case "GENUINE_SOURCE_BLOCKED":
      return "A genuine source blocker exists. Upload the missing source document or tender intake file, then processing resumes automatically.";
    case "LEGAL_RELEASE_REQUIRED":
      return "A legal signature, declaration, or ADMIN release decision is required. No further automatic processing can occur until this is resolved.";
    case "READY_TO_DOWNLOAD":
      return "The final ZIP package is ready. Download it below.";
    case "FAILED_SECURITY_OR_INTEGRITY":
      return "A security or integrity failure occurred. The package cannot be downloaded. Contact support with the request ID.";
  }
}

// Preserve the export name for backward compatibility with page.tsx imports.
// The button is gone — this function now always returns false because there
// is no manual generate action.
export function isGenerationActionEnabled(
  _canonicalGenerationState: CanonicalModuleStatus,
  _serverGateAllowsGeneration: boolean,
): boolean {
  return false;
}

// Preserve the export name. The button component is now a no-op — it renders
// nothing. This avoids breaking imports in page.tsx while removing the button.
export function GenerationActionButton() {
  return null;
}

// Preserve the export name. The panel is now the text-based status surface.
export function GenerationActionPanel({
  tenderId: _tenderId,
  readiness,
  canonicalReadiness,
  canMutate: _canMutate = false,
}: {
  tenderId: string;
  readiness: GenerationReadiness | null;
  canonicalReadiness?: CanonicalTenderReadiness | null;
  canMutate?: boolean;
}) {
  const status = deriveReleaseStatus(readiness, canonicalReadiness);

  // Collect any genuine source blockers or legal release items to show
  // as a plain-text list (no icons, no action links).
  const visibleBlockers: string[] = [];
  for (const b of readiness?.blockers ?? []) {
    if (b.code !== "NO_REQUIREMENTS") visibleBlockers.push(b.message);
  }
  for (const b of readiness?.fullProposalBlockers ?? []) {
    if (b.code !== "NO_REQUIREMENTS") visibleBlockers.push(b.message);
  }
  // canonicalReadiness.blockers are string codes — show them as-is.
  for (const code of canonicalReadiness?.blockers ?? []) {
    if (code !== "NO_REQUIREMENTS") visibleBlockers.push(code);
  }
  const truncatedBlockers = visibleBlockers.slice(0, 8);

  return (
    <section id="generated-documents" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Release status</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">{statusLabel(status)}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{statusExplanation(status)}</p>
      {truncatedBlockers.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending items</p>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {truncatedBlockers.map((msg, idx) => (
              <li key={`blk-${idx}`} className="before:content-['•'] before:mr-1.5 before:text-slate-400">{msg}</li>
            ))}
          </ul>
        </div>
      )}
      {status === "READY_TO_DOWNLOAD" && (
        <div className="mt-4">
          <a
            href={`/api/tenders/${_tenderId}/download?type=zip`}
            className="inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Download Final ZIP
          </a>
        </div>
      )}
    </section>
  );
}
