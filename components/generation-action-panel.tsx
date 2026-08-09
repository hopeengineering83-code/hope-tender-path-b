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
import { classifyReleaseStatus } from "../lib/release-status-classifier";
import { releaseBlockerLabel } from "../lib/ui/human-labels";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";

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
 *
 * Gap 5: delegates to classifyReleaseStatus from canonical-release-decision.ts
 * so the UI and the server use the SAME classification logic.
 */
export function deriveReleaseStatus(
  readiness: GenerationReadiness | null,
  canonicalReadiness?: CanonicalTenderReadiness | null,
): ReleaseStatus {
  if (!readiness && !canonicalReadiness) return "PROCESSING_AUTOMATICALLY";

  const readyForFinalExport = Boolean(
    canonicalReadiness?.readyForFinalExport ??
      (readiness?.ready && (readiness.fullProposalReady ?? false)),
  );

  // Collect all blocker codes from both sources.
  const blockerCodes: string[] = [];
  for (const b of readiness?.blockers ?? []) blockerCodes.push(b.code);
  for (const b of readiness?.fullProposalBlockers ?? []) blockerCodes.push(b.code);
  for (const code of canonicalReadiness?.blockers ?? []) blockerCodes.push(code);

  return classifyReleaseStatus(blockerCodes, readyForFinalExport);
}

const EVIDENCE_BLOCKER_CODES = new Set([
  "NO_EXPERT_MATCHES_FOUND",
  "NO_REVIEWED_EXPERT_MATCHES",
  "ALL_EXPERTS_UNREVIEWED",
  "NO_PROJECT_MATCHES_FOUND",
  "NO_REVIEWED_PROJECT_MATCHES",
  "ALL_PROJECTS_UNREVIEWED",
  "NO_SELECTED_REVIEWED_EXPERTS",
  "NO_SELECTED_REVIEWED_PROJECTS",
  "FULL_PROPOSAL_NO_VAULT",
  "FULL_PROPOSAL_MATCHES_WEAK",
  "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
]);

function collectedBlockerCodes(
  readiness: GenerationReadiness | null,
  canonicalReadiness?: CanonicalTenderReadiness | null,
  releaseDecision?: { blockerCodes: string[] } | null,
): string[] {
  return [
    ...(readiness?.blockers ?? []).map((blocker) => blocker.code),
    ...(readiness?.fullProposalBlockers ?? []).map((blocker) => blocker.code),
    ...(releaseDecision?.blockerCodes ?? []),
    ...(canonicalReadiness?.blockers ?? []),
  ];
}

/** Presentation-only truth reconciliation. Eligibility remains owned by the
 * server readiness calculator and its canonical canUseVaultRecord predicate. */
export function deriveTruthfulReleaseStatus(
  readiness: GenerationReadiness | null,
  canonicalReadiness: CanonicalTenderReadiness | null | undefined,
  releaseDecision: { status: ReleaseStatus; blockerCodes: string[] } | null | undefined,
  activeDownstreamWork: boolean,
): ReleaseStatus {
  const status = releaseDecision?.status ?? deriveReleaseStatus(readiness, canonicalReadiness);
  const evidenceBlocked = collectedBlockerCodes(readiness, canonicalReadiness, releaseDecision)
    .some((code) => EVIDENCE_BLOCKER_CODES.has(code));
  return status === "PROCESSING_AUTOMATICALLY" && evidenceBlocked && !activeDownstreamWork
    ? "GENUINE_SOURCE_BLOCKED"
    : status;
}

export function truthfulEvidenceMessage(
  code: string | undefined,
  message: string,
  counts: GenerationReadiness["counts"],
): string {
  if ((code === "ALL_EXPERTS_UNREVIEWED" || code === "NO_SELECTED_REVIEWED_EXPERTS")
      && (counts?.selectedExperts ?? 0) === 0) {
    return (counts?.reviewedExpertMatches ?? 0) > 0
      ? "Eligible source-backed expert matches exist, but none are selected."
      : "No eligible source-backed expert evidence exists for the required roles. Add genuine owned source evidence for unsupported requirements.";
  }
  if (code === "ALL_EXPERTS_UNREVIEWED" || code === "NO_SELECTED_REVIEWED_EXPERTS") {
    return "Selected expert evidence is stale or ineligible. Add genuine owned source evidence for unsupported requirements.";
  }
  return message
    .replace(/Confirm\s+more\s+evidence\.?/gi, "Add genuine owned source evidence for unsupported requirements.")
    .replace(/reviewed expert(?:\/project)? evidence/gi, "SOURCE_VERIFIED / current REVIEWED evidence")
    .replace(/reviewed expert matches/gi, "eligible source-backed expert matches")
    .replace(/reviewed experts/gi, "eligible source-backed experts")
    .replace(/reviewed projects/gi, "eligible source-backed projects");
}

/**
 * The status label shown to the user. Plain text — no icons, no badges.
 */
function statusLabel(status: ReleaseStatus): string {
  switch (status) {
    case "PROCESSING_AUTOMATICALLY":
      return "Processing automatically";
    case "GENUINE_SOURCE_BLOCKED":
      return "Blocked — source evidence required";
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
      return "The automatic workflow is stopped at its first authoritative blocker. Add genuine owned source evidence for unsupported requirements.";
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
// Blocker 3: when releaseDecision is provided, use it directly — no
// client-side recomputation. When not provided (backward compat), fall
// back to deriveReleaseStatus from the raw readiness data.
export async function GenerationActionPanel({
  tenderId: _tenderId,
  readiness,
  canonicalReadiness,
  canMutate: _canMutate = false,
  releaseDecision,
  activeDownstreamWork = false,
}: {
  tenderId: string;
  readiness: GenerationReadiness | null;
  canonicalReadiness?: CanonicalTenderReadiness | null;
  canMutate?: boolean;
  // Blocker 3: the server-computed CanonicalReleaseDecision. When provided,
  // the UI uses it directly — no client-side recomputation.
  releaseDecision?: {
    status: ReleaseStatus;
    blockerCodes: string[];
  } | null;
  activeDownstreamWork?: boolean;
}) {
  let hasActiveDownstreamWork = activeDownstreamWork;
  if (!hasActiveDownstreamWork) {
    const userId = await getSession();
    if (userId) {
      await prismaReady;
      hasActiveDownstreamWork = Boolean(await prisma.aiJob.findFirst({
        where: {
          userId,
          tenderId: _tenderId,
          jobType: { in: ["ENGINE_RUN", "PROPOSAL_GENERATION", "AUTO_FINALIZE"] },
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      }).catch(() => null));
    }
  }
  // Blocker 3: prefer the server-computed releaseDecision. Only fall back to
  // client-side derivation when the server hasn't provided one (backward compat
  // for routes that haven't been updated yet).
  const status = deriveTruthfulReleaseStatus(
    readiness,
    canonicalReadiness,
    releaseDecision,
    hasActiveDownstreamWork,
  );

  // Collect blockers for display, keyed by code so the SAME blocker cannot be
  // listed twice in two different forms.
  //
  // Previously this pushed raw UPPER_SNAKE codes from the code-bearing sources
  // and human sentences from the message-bearing ones, into one flat list. The
  // owner saw "Full proposal generation is blocked: …" followed by
  // FULL_PROPOSAL_ENGINE_NOT_RUN, ENGINE_NOT_COMPLETED,
  // NO_TENDER_SPECIFIC_EXPERT_MATCHES, NO_SELECTED_REVIEWED_EXPERTS,
  // NO_ACTIVE_GENERATED_DOCUMENTS and NO_CURRENT_CONFIRMED_BUILD_PLAN — the
  // first item restated as an internal identifier, next to five more.
  //
  // Message sources are read FIRST so a real sentence always wins; code sources
  // only fill codes nothing has described yet, and are humanised on the way out.
  const blockersByCode = new Map<string, string>();
  const addMessage = (code: string | undefined, message: string) => {
    const key = code ?? message;
    if (key === "NO_REQUIREMENTS") return;
    if (!blockersByCode.has(key)) blockersByCode.set(key, truthfulEvidenceMessage(code, message, readiness?.counts));
  };
  const addCode = (code: string) => {
    if (code === "NO_REQUIREMENTS") return;
    if (!blockersByCode.has(code)) {
      blockersByCode.set(code, truthfulEvidenceMessage(code, releaseBlockerLabel(code), readiness?.counts));
    }
  };

  for (const b of readiness?.blockers ?? []) addMessage(b.code, b.message);
  for (const b of readiness?.fullProposalBlockers ?? []) addMessage(b.code, b.message);
  for (const code of releaseDecision?.blockerCodes ?? []) addCode(code);
  for (const code of canonicalReadiness?.blockers ?? []) addCode(code);

  const truncatedBlockers = [...blockersByCode.values()].slice(0, 8);

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
