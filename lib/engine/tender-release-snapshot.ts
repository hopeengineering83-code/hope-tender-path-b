/**
 * Unified server-side release snapshot.
 *
 * ONE revisioned payload consumed by ALL metadata/readiness panels.
 * No panel may independently classify title, deadline, submission method,
 * criticality, placeholders, or evidence — they must read from this snapshot
 * or its exact server-derived sub-payload.
 *
 * Architecture:
 *   getTenderReleaseSnapshot(prisma, tenderId, userId)
 *     ├─ resolveCanonicalFieldState()   → metadata field states (single truth)
 *     ├─ resolveTenderAnalysisState()   → analysis state machine
 *     ├─ assessExtractionQuality()      → per-file extraction state
 *     ├─ requirement grounding          → per-requirement source proof
 *     ├─ evidence coverage              → compliance-matrix coverage
 *     ├─ build plan                     → submission plan state
 *     └─ vault matches                  → selected/reviewed match state
 *
 * All fields that appear in the snapshot are authoritative. A panel that
 * derives its own version of any snapshot field introduces contradictions.
 */

import type { PrismaClient } from "@prisma/client";
import { resolveCanonicalFieldState, type CanonicalFieldStateResult } from "./canonical-field-state";
import { resolveTenderAnalysisState, type AnalysisState } from "./analysis-state-resolver";
import { assessExtractionQuality } from "../extraction-quality";
import { isGroundedEvidence } from "./evidence-grounding";
import { createHash } from "node:crypto";

// Local type stubs for Prisma query result shapes — avoids implicit `any` when
// @prisma/client types are not yet generated in the current environment.
type _FileRow = {
  id: string;
  originalFileName: string;
  extractedText: string | null;
  extractionScore: number | null;
  deletionStatus: string | null;
};
type _OverrideRow = {
  field: string;
  fieldState: string;
  overrideValue: string | null;
  reason: string | null;
  overriddenBy: string | null;
  createdAt: Date;
};
type _ComplianceRow = { supportLevel: string | null };
type _ReqRow = {
  id: string;
  priority: string | null;
  requirementType: string | null;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  complianceMatrixRows: _ComplianceRow[];
};
type _ExpertMatchRow = { expert?: { trustLevel: string | null } | null };
type _ProjectMatchRow = { project?: { trustLevel: string | null } | null };

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotExtractionFile = {
  fileId: string;
  fileName: string;
  corrupted: boolean;
  weak: boolean;
  hasOverride: boolean;
  score: number;
};

export type SnapshotExtractionState = {
  activeFileCount: number;
  files: SnapshotExtractionFile[];
  overallOk: boolean;
  /** First blocker found, or null when extraction is clean. */
  blocker: string | null;
};

export type SnapshotAnalysisState = {
  state: AnalysisState;
  canonicalJobId: string | null;
  latestJobHash: string | null;
  currentContentHash: string;
  contentHashMatch: boolean;
  /** True ONLY when state === "AI_SUCCEEDED" AND canonicalJobId is set AND hashes match. */
  eligibleForExport: boolean;
  blocker: string | null;
};

export type SnapshotRequirementsState = {
  total: number;
  mandatory: number;
  /** Mandatory requirements with an active source file + page ≥ 1 + meaningful quote. */
  groundedMandatory: number;
  allMandatoryGrounded: boolean;
  blocker: string | null;
};

export type SnapshotEvidenceState = {
  total: number;
  covered: number;
  coveragePercent: number;
};

export type SnapshotBuildPlanState = {
  documentCount: number;
  valid: boolean;
  blocker: string | null;
};

export type SnapshotVaultState = {
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  selectedReviewedExpertCount: number;
  selectedReviewedProjectCount: number;
  matchingBlocked: boolean;
  blocker: string | null;
};

export type TenderReleaseSnapshot = {
  // ─── Identity ────────────────────────────────────────────────────────────
  tenderId: string;
  /**
   * Stable revision token: SHA-256 of all input values used to build this
   * snapshot. When the token changes between renders, the UI knows data changed.
   */
  snapshotRevision: string;
  generatedAt: string;

  // ─── Sub-states (consumed by panels independently) ─────────────────────
  extraction: SnapshotExtractionState;
  analysis: SnapshotAnalysisState;
  /** Authoritative metadata field states — consumed by ALL panels. */
  metadata: CanonicalFieldStateResult;
  requirements: SnapshotRequirementsState;
  evidence: SnapshotEvidenceState;
  buildPlan: SnapshotBuildPlanState;
  vault: SnapshotVaultState;

  // ─── Aggregated eligibility ──────────────────────────────────────────────
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;

  generationBlockers: string[];
  exportBlockers: string[];
  finalZipBlockers: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const WEAK_EXTRACTION_SCORE_THRESHOLD = 70;
const MIN_MEANINGFUL_QUOTE_CHARS = 10;

// ─── Main resolver ────────────────────────────────────────────────────────────

export async function getTenderReleaseSnapshot(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<TenderReleaseSnapshot | null> {
  // Single comprehensive query — avoids N+1 round trips.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      reference: true,
      description: true,
      intakeSummary: true,
      clientName: true,
      procuringEntityName: true,
      deadline: true,
      currency: true,
      country: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      submissionEmailSubject: true,
      clientContactName: true,
      clientContactEmail: true,
      metadataContaminated: true,
      clientNameSourcePage: true,
      clientNameSourceQuote: true,
      submissionMethodSourcePage: true,
      submissionMethodSourceQuote: true,
      submissionAddressSourcePage: true,
      submissionAddressSourceQuote: true,
      submissionEmailSourcePage: true,
      contactDetailsSourceJson: true,
      // Extended panel fields
      legalClientName: true,
      donorAgency: true,
      implementingAgency: true,
      clientContactTitle: true,
      clientContactPhone: true,
      clientCity: true,
      clientAddress: true,
      clientWebsite: true,
      clientRepresentative: true,
      preBidChannel: true,
      preBidMeetingDate: true,
      preBidMeetingLocation: true,
      evaluationMethodology: true,
      files: {
        select: {
          id: true,
          originalFileName: true,
          extractedText: true,
          extractionScore: true,
          deletionStatus: true,
        },
      },
      metadataOverrides: {
        select: {
          field: true,
          fieldState: true,
          overrideValue: true,
          reason: true,
          overriddenBy: true,
          createdAt: true,
        },
      },
      requirements: {
        select: {
          id: true,
          priority: true,
          requirementType: true,
          sourceTenderFileId: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          complianceMatrixRows: {
            select: { supportLevel: true },
          },
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, generationStatus: true },
      },
      expertMatches: {
        where: { isSelected: true },
        include: { expert: { select: { trustLevel: true } } },
      },
      projectMatches: {
        where: { isSelected: true },
        include: { project: { select: { trustLevel: true } } },
      },
    },
  });
  if (!tender) return null;

  // Extraction overrides require a separate query (hasActiveExtractionOverride).
  const activeFiles = (tender.files as _FileRow[]).filter((f) => f.deletionStatus === "ACTIVE");

  const extractionFiles: SnapshotExtractionFile[] = await Promise.all(
    activeFiles.map(async (f) => {
      const quality = assessExtractionQuality(f.extractedText, f.originalFileName);
      const score = Math.min(f.extractionScore ?? quality.score, quality.score);
      const corrupted = quality.corrupted;
      const weak = !corrupted && score < WEAK_EXTRACTION_SCORE_THRESHOLD;
      // Lazy override check: only query DB when the file is actually weak.
      let hasOverride = false;
      if (weak) {
        const overrideCount = await prisma.extractionQualityOverride.count({
          where: { tenderId, tenderFileId: f.id, status: "ACTIVE" },
        });
        hasOverride = overrideCount > 0;
      }
      return { fileId: f.id, fileName: f.originalFileName, corrupted, weak, hasOverride, score };
    }),
  );

  // Build extraction state.
  let extractionBlocker: string | null = null;
  if (activeFiles.length < 1) {
    extractionBlocker = "No active tender file exists. Upload and extract the tender document first.";
  } else {
    for (const f of extractionFiles) {
      if (f.corrupted) { extractionBlocker = "At least one tender file has corrupted extraction."; break; }
      if (f.weak && !f.hasOverride) { extractionBlocker = "At least one tender file has weak extraction without a human override."; break; }
    }
  }
  const extraction: SnapshotExtractionState = {
    activeFileCount: activeFiles.length,
    files: extractionFiles,
    overallOk: extractionBlocker === null,
    blocker: extractionBlocker,
  };

  // Analysis state — canonical state machine.
  const analysisDetail = await resolveTenderAnalysisState(prisma, tenderId, userId);

  // Content hash — same computation as the generation gate.
  const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("./tender-analysis-content");
  const company = await prisma.company.findUnique({
    where: { userId },
    select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
  });
  const currentContentHash = computeAnalysisContentHash(
    buildTenderAnalysisContent(
      { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: activeFiles },
      company ?? undefined,
    ),
  );

  const latestJob = await prisma.aiJob.findFirst({
    where: { tenderId, jobType: "AI_ANALYZE", tender: { userId } },
    orderBy: { createdAt: "desc" },
    select: { analysisInputHash: true },
  });
  const latestJobHash = latestJob?.analysisInputHash ?? null;
  const contentHashMatch = !!(latestJobHash && latestJobHash === currentContentHash);
  const analysisEligible =
    analysisDetail.state === "AI_SUCCEEDED" &&
    !!analysisDetail.canonicalJobId &&
    contentHashMatch;
  let analysisBlocker: string | null = null;
  if (analysisDetail.state === "HUMAN_APPROVED_FALLBACK") {
    analysisBlocker = "Analysis used a regex fallback which cannot authorize generation or export. Re-run AI Analyze.";
  } else if (analysisDetail.state !== "AI_SUCCEEDED") {
    analysisBlocker = `AI Analyze is not in a release-ready state (current: ${analysisDetail.state}).`;
  } else if (!analysisDetail.canonicalJobId) {
    analysisBlocker = "No promoted AI Analyze job found. Re-run AI Analyze.";
  } else if (!contentHashMatch) {
    analysisBlocker = "Tender content changed since the last analysis. Re-run AI Analyze.";
  }
  const analysis: SnapshotAnalysisState = {
    state: analysisDetail.state,
    canonicalJobId: analysisDetail.canonicalJobId,
    latestJobHash,
    currentContentHash,
    contentHashMatch,
    eligibleForExport: analysisEligible,
    blocker: analysisBlocker,
  };

  // Metadata field states — canonical, single truth for all panels.
  const metadata = resolveCanonicalFieldState({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      procuringEntityName: tender.procuringEntityName,
      deadline: tender.deadline,
      currency: tender.currency,
      country: tender.country,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: tender.submissionEmailSubject,
      clientContactName: tender.clientContactName,
      clientContactEmail: tender.clientContactEmail,
      metadataContaminated: tender.metadataContaminated ?? false,
      clientNameSourcePage: tender.clientNameSourcePage,
      clientNameSourceQuote: tender.clientNameSourceQuote,
      submissionMethodSourcePage: tender.submissionMethodSourcePage,
      submissionMethodSourceQuote: tender.submissionMethodSourceQuote,
      submissionAddressSourcePage: tender.submissionAddressSourcePage,
      submissionAddressSourceQuote: tender.submissionAddressSourceQuote,
      submissionEmailSourcePage: tender.submissionEmailSourcePage,
      contactDetailsSourceJson: tender.contactDetailsSourceJson,
      // Extended panel fields
      evaluationMethodology: tender.evaluationMethodology,
      legalClientName: tender.legalClientName,
      donorAgency: tender.donorAgency,
      implementingAgency: tender.implementingAgency,
      clientContactTitle: tender.clientContactTitle,
      clientContactPhone: tender.clientContactPhone,
      clientCity: tender.clientCity,
      clientAddress: tender.clientAddress,
      clientWebsite: tender.clientWebsite,
      clientRepresentative: tender.clientRepresentative,
      preBidChannel: tender.preBidChannel,
      preBidMeetingDate: tender.preBidMeetingDate?.toISOString() ?? null,
      preBidMeetingLocation: tender.preBidMeetingLocation,
    },
    overrides: ((tender.metadataOverrides ?? []) as _OverrideRow[]).map((o) => ({
      field: o.field,
      fieldState: o.fieldState,
      overrideValue: o.overrideValue,
      reason: o.reason,
      overriddenBy: o.overriddenBy,
      createdAt: o.createdAt,
    })),
    hasExtractedRequirements: tender.requirements.length > 0,
    submissionMethodContext: tender.submissionMethod ?? undefined,
  });

  // Requirements grounding.
  const allReqs = tender.requirements as _ReqRow[];
  const mandatory = allReqs.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  const activeFileIds = new Set(activeFiles.map((f) => f.id));
  const groundedMandatory = mandatory.filter((r) => {
    const quote = (r.sourceExactQuote ?? "").trim();
    return (
      !!r.sourceTenderFileId &&
      activeFileIds.has(r.sourceTenderFileId) &&
      isGroundedEvidence(r.sourcePageNumber, quote) &&
      quote.length >= MIN_MEANINGFUL_QUOTE_CHARS
    );
  }).length;

  const requirementsBlocker: string | null =
    allReqs.length < 1
      ? "No requirements have been extracted."
      : groundedMandatory < mandatory.length
        ? `${mandatory.length - groundedMandatory} mandatory requirement(s) are missing active source evidence.`
        : null;

  const requirements: SnapshotRequirementsState = {
    total: allReqs.length,
    mandatory: mandatory.length,
    groundedMandatory,
    allMandatoryGrounded: groundedMandatory === mandatory.length && mandatory.length > 0,
    blocker: requirementsBlocker,
  };

  // Evidence coverage (compliance-matrix rows with STRONG support).
  const STRONG_SUPPORT = new Set(["FULL", "SUBSTANTIAL", "COMPLIANT", "STRONG"]);
  const covered = mandatory.filter((r) =>
    r.complianceMatrixRows.some((row) => STRONG_SUPPORT.has((row.supportLevel ?? "").toUpperCase())),
  ).length;
  const evidence: SnapshotEvidenceState = {
    total: mandatory.length,
    covered,
    coveragePercent: mandatory.length === 0 ? 0 : Math.round((covered / mandatory.length) * 100),
  };

  // Build plan / submission plan.
  const buildPlanCount = tender.generatedDocuments.length;
  const buildPlan: SnapshotBuildPlanState = {
    documentCount: buildPlanCount,
    valid: buildPlanCount > 0,
    blocker: buildPlanCount < 1 ? "No submission plan / generated documents exist. Build the plan first." : null,
  };

  // Vault matches.
  const expertReqExists = allReqs.some((r) => r.requirementType === "EXPERT");
  const projectReqExists = allReqs.some((r) => r.requirementType === "PROJECT_EXPERIENCE");
  const selectedReviewedExperts = (tender.expertMatches as _ExpertMatchRow[]).filter(
    (m) => m.expert?.trustLevel === "REVIEWED",
  ).length;
  const selectedReviewedProjects = (tender.projectMatches as _ProjectMatchRow[]).filter(
    (m) => m.project?.trustLevel === "REVIEWED",
  ).length;
  const vaultBlocked =
    (expertReqExists && selectedReviewedExperts === 0) ||
    (projectReqExists && selectedReviewedProjects === 0);
  const vault: SnapshotVaultState = {
    expertRequirementExists: expertReqExists,
    projectRequirementExists: projectReqExists,
    selectedReviewedExpertCount: selectedReviewedExperts,
    selectedReviewedProjectCount: selectedReviewedProjects,
    matchingBlocked: vaultBlocked,
    blocker: vaultBlocked
      ? "Tender requires expert/project evidence but no selected reviewed Vault matches exist."
      : null,
  };

  // Aggregate generation/export/zip eligibility.
  const generationBlockers: string[] = [
    ...(extraction.blocker ? [extraction.blocker] : []),
    ...(analysis.blocker ? [analysis.blocker] : []),
    ...(metadata.hasGenerationBlocker ? ["One or more critical metadata fields are invalid or ungrounded."] : []),
    ...(requirements.blocker ? [requirements.blocker] : []),
    ...(buildPlan.blocker ? [buildPlan.blocker] : []),
    ...(vault.blocker ? [vault.blocker] : []),
  ];

  const exportBlockers: string[] = [
    ...generationBlockers,
    // Export requires evidence coverage ≥ 50% on mandatory requirements when any exist.
    ...(mandatory.length > 0 && evidence.coveragePercent < 50
      ? [`Evidence coverage is ${evidence.coveragePercent}% (need ≥ 50% for export).`]
      : []),
  ];

  const finalZipBlockers: string[] = [
    ...exportBlockers,
    // Final ZIP requires ALL mandatory requirements grounded, not just ≥ 50%.
    ...(!requirements.allMandatoryGrounded && mandatory.length > 0
      ? ["All mandatory requirements must be source-grounded for Final ZIP."]
      : []),
  ];

  const generationEligible = generationBlockers.length === 0;
  const exportEligible = exportBlockers.length === 0;
  const finalZipEligible = finalZipBlockers.length === 0;

  // Snapshot revision: stable hash of all inputs used to build this snapshot.
  const revisionInput = JSON.stringify({
    currentContentHash,
    metadataContaminated: tender.metadataContaminated,
    analysisState: analysisDetail.state,
    analysisJobId: analysisDetail.canonicalJobId,
    requirementCount: allReqs.length,
    overrides: (tender.metadataOverrides ?? []).map((o) => ({
      field: o.field,
      fieldState: o.fieldState,
      overrideValue: o.overrideValue,
    })),
    documentCount: buildPlanCount,
  });
  const snapshotRevision = createHash("sha256").update(revisionInput).digest("hex").slice(0, 16);

  return {
    tenderId,
    snapshotRevision,
    generatedAt: new Date().toISOString(),
    extraction,
    analysis,
    metadata,
    requirements,
    evidence,
    buildPlan,
    vault,
    generationEligible,
    exportEligible,
    finalZipEligible,
    generationBlockers,
    exportBlockers,
    finalZipBlockers,
  };
}
