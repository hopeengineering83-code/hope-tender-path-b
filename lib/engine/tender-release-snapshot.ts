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
  // totalPages is required to mirror the gate's sourcePage <= totalPages check.
  totalPages: number | null;
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
  /**
   * Count-based validity: ≥1 non-SUPERSEDED GeneratedDocument exists.
   * Retained for backward-compatible UI display (workflow-center stage 6).
   * Does NOT agree with the generation gate — see `gateValid`.
   */
  valid: boolean;
  blocker: string | null;
  /**
   * Gate-aligned strict validity. Mirrors generation-readiness-gate.ts:
   * persisted BuildPlan row exists, contentHash matches the canonical hash,
   * status=CONFIRMED, confirmedRevision/confirmedContentHash match, critical
   * metadata evidence valid, items valid at runtime. Computed via the SAME
   * helpers the gate uses (computeTenderBuildPlanHash + getCurrentConfirmedBuildPlan
   * + validateBuildPlanItemsAtRuntime) so it can never disagree with the gate.
   */
  gateValid: boolean;
  /** First strict-check failure reason, or null when gateValid=true. */
  gateBlocker: string | null;
};

export type SnapshotVaultState = {
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  selectedReviewedExpertCount: number;
  selectedReviewedProjectCount: number;
  matchingBlocked: boolean;
  blocker: string | null;
};

/**
 * Metadata state with gate-aligned strict validity. Extends the canonical
 * resolver's result with a second-layer strict check (validateCriticalMetadataEvidenceForBuildPlan)
 * that mirrors generation-readiness-gate.ts. The existing hasGenerationBlocker
 * (resolver-only) is retained for backward-compatible UI display; gateValid +
 * gateBlocker expose the gate-aligned view so consumers that need gate-parity
 * can read them instead.
 */
export type SnapshotMetadataState = CanonicalFieldStateResult & {
  /**
   * Gate-aligned strict validity. Mirrors generation-readiness-gate.ts:
   * resolver's hasGenerationBlocker is false AND
   * validateCriticalMetadataEvidenceForBuildPlan returns ok (quote containment
   * + page <= totalPages + override/effective-value aware). Computed via the
   * SAME pure helper the gate uses so it can never disagree with the gate.
   */
  gateValid: boolean;
  /** First strict-check failure reason, or null when gateValid=true. */
  gateBlocker: string | null;
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
  metadata: SnapshotMetadataState;
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
      clientNameSourceFileId: true,
      submissionMethodSourcePage: true,
      submissionMethodSourceQuote: true,
      submissionMethodSourceFileId: true,
      submissionAddressSourcePage: true,
      submissionAddressSourceQuote: true,
      submissionAddressSourceFileId: true,
      submissionEmailSourcePage: true,
      submissionEmailSourceFileId: true,
      submissionEmailSourceQuote: true,
      titleSourcePage: true,
      titleSourceQuote: true,
      titleSourceFileId: true,
      deadlineSourcePage: true,
      deadlineSourceQuote: true,
      deadlineSourceFileId: true,
      // Reference number source evidence — dedicated columns read first by the
      // canonical resolver's getSourceEvidence for fieldKey="reference".
      // Without these, the reference field can only reach EXTRACTED_AND_GROUNDED
      // via the contactDetailsSourceJson fallback, which diverges from the
      // strict BuildPlan validator that reads the dedicated columns.
      referenceSourcePage: true,
      referenceSourceQuote: true,
      referenceSourceFileId: true,
      // Email-subject source evidence — read by validateCriticalMetadataEvidenceForBuildPlan
      // via the dedicated-column path (mirrors the gate, which include's all Tender columns).
      // Without these, the snapshot's metadata.gateValid could disagree with the gate when
      // the subject evidence is in these columns rather than contactDetailsSourceJson.
      submissionEmailSubjectSourcePage: true,
      submissionEmailSubjectSourceQuote: true,
      submissionEmailSubjectSourceFileId: true,
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
          // totalPages is required to mirror the gate's sourcePage <= totalPages
          // check in the requirements grounding filter.
          totalPages: true,
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

  // Extraction overrides require a separate query. Batch the lookup for all
  // weak files into ONE query instead of N per-file count queries (was N+1).
  const activeFiles = (tender.files as _FileRow[]).filter((f) => f.deletionStatus === "ACTIVE");

  // Pre-compute quality for all files to identify weak ones.
  const fileQualities = activeFiles.map((f) => {
    const quality = assessExtractionQuality(f.extractedText, f.originalFileName);
    const score = Math.min(f.extractionScore ?? quality.score, quality.score);
    const corrupted = quality.corrupted;
    const weak = !corrupted && score < WEAK_EXTRACTION_SCORE_THRESHOLD;
    return { f, quality, score, corrupted, weak };
  });

  // Batch query: get ALL active overrides for weak files in one shot.
  const weakFileIds = fileQualities.filter((fq) => fq.weak).map((fq) => fq.f.id);
  const overrideFileIds = weakFileIds.length > 0
    ? new Set(
        (await prisma.extractionQualityOverride.findMany({
          where: { tenderId, tenderFileId: { in: weakFileIds }, status: "ACTIVE" },
          select: { tenderFileId: true },
          distinct: ["tenderFileId"],
        })).map((o) => o.tenderFileId),
      )
    : new Set<string>();

  const extractionFiles: SnapshotExtractionFile[] = fileQualities.map(({ f, score, corrupted, weak }) => ({
    fileId: f.id,
    fileName: f.originalFileName,
    corrupted,
    weak,
    hasOverride: weak ? overrideFileIds.has(f.id) : false,
    score,
  }));

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
  const metadataResult = resolveCanonicalFieldState({
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
      clientNameSourceFileId: (tender as any).clientNameSourceFileId ?? null,
      submissionMethodSourcePage: tender.submissionMethodSourcePage,
      submissionMethodSourceQuote: tender.submissionMethodSourceQuote,
      submissionMethodSourceFileId: (tender as any).submissionMethodSourceFileId ?? null,
      submissionAddressSourcePage: tender.submissionAddressSourcePage,
      submissionAddressSourceQuote: tender.submissionAddressSourceQuote,
      submissionAddressSourceFileId: (tender as any).submissionAddressSourceFileId ?? null,
      submissionEmailSourcePage: tender.submissionEmailSourcePage,
      submissionEmailSourceQuote: (tender as any).submissionEmailSourceQuote ?? null,
      submissionEmailSourceFileId: (tender as any).submissionEmailSourceFileId ?? null,
      titleSourcePage: (tender as any).titleSourcePage ?? null,
      titleSourceQuote: (tender as any).titleSourceQuote ?? null,
      titleSourceFileId: (tender as any).titleSourceFileId ?? null,
      deadlineSourcePage: (tender as any).deadlineSourcePage ?? null,
      deadlineSourceQuote: (tender as any).deadlineSourceQuote ?? null,
      deadlineSourceFileId: (tender as any).deadlineSourceFileId ?? null,
      // Forward reference source-evidence columns to the resolver so the
      // dedicated-column path in getSourceEvidence is taken (not just the
      // contactDetailsSourceJson fallback). Matches the strict BuildPlan
      // validator's view of the reference field.
      referenceSourcePage: (tender as any).referenceSourcePage ?? null,
      referenceSourceQuote: (tender as any).referenceSourceQuote ?? null,
      referenceSourceFileId: (tender as any).referenceSourceFileId ?? null,
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
    overrides: ((tender.metadataOverrides ?? []) as any[]).map((o) => ({
      field: o.field,
      fieldState: o.fieldState,
      overrideValue: o.overrideValue,
      reason: o.reason,
      overriddenBy: o.overriddenBy,
      createdAt: o.createdAt,
    })),
    hasExtractedRequirements: tender.requirements.length > 0,
    submissionMethodContext: tender.submissionMethod ?? undefined,
    // Same canonical active-file grounding rule as the gates so the release
    // snapshot's metadata states match generation/export exactly.
    activeTenderFileIds: new Set(activeFiles.map((f) => f.id)),
    // Full active-file rows enable the STRONGEST shared grounding check
    // (quote containment + page <= totalPages) — the same evidence rules the
    // gate-aligned strict metadata check below applies via the validator.
    activeFiles: activeFiles.map((f) => ({ id: f.id, extractedText: f.extractedText, totalPages: f.totalPages })),
  });

  // GATE-ALIGNED STRICT METADATA CHECK — mirrors generation-readiness-gate.ts:716-732.
  // Uses the SAME pure helper the gate uses (validateCriticalMetadataEvidenceForBuildPlan)
  // so the snapshot's metadata.gateValid can never disagree with the gate's criticalMetadataOk.
  // Short-circuits when the resolver already flags a blocker (defense in depth — same as the gate).
  // Zero new DB queries: the validator is pure and the snapshot already loaded all needed data.
  let metadataGateValid = !metadataResult.hasGenerationBlocker;
  let metadataGateBlocker: string | null = metadataResult.hasGenerationBlocker
    ? "One or more critical metadata fields are invalid or ungrounded."
    : null;
  if (metadataGateValid) {
    try {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("./build-plan");
      const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(
        tender as any,
        activeFiles,
        ((tender.metadataOverrides ?? []) as any[]).map((o) => ({
          field: o.field,
          fieldState: o.fieldState,
          overrideValue: o.overrideValue,
        })),
      );
      if (!metaValidation.ok) {
        metadataGateValid = false;
        metadataGateBlocker = metaValidation.blockers[0]
          ?? "Critical metadata evidence is missing or invalid.";
      }
    } catch {
      // Fail closed — never let a thrown error read as gateValid=true.
      metadataGateValid = false;
      metadataGateBlocker = "Metadata gate check failed (internal error).";
    }
  }
  const metadata: SnapshotMetadataState = {
    ...metadataResult,
    gateValid: metadataGateValid,
    gateBlocker: metadataGateBlocker,
  };

  // Requirements grounding — mirrors generation-readiness-gate.ts (page <= totalPages
  // + normalized quote containment in the source file's extractedText). Keeps the
  // release snapshot's requirements.allMandatoryGrounded in lock-step with the gate
  // so the UI never shows a requirement as grounded when the gate would block on it.
  const allReqs = tender.requirements as _ReqRow[];
  const mandatory = allReqs.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  const activeFileIds = new Set(activeFiles.map((f) => f.id));
  // O(1) lookup of extractedText + totalPages per requirement's source file.
  const activeFileById = new Map(activeFiles.map((f) => [f.id, f]));
  const groundedMandatory = mandatory.filter((r) => {
    const quote = (r.sourceExactQuote ?? "").trim();
    if (
      !r.sourceTenderFileId ||
      !activeFileIds.has(r.sourceTenderFileId) ||
      !isGroundedEvidence(r.sourcePageNumber, quote) ||
      quote.length < MIN_MEANINGFUL_QUOTE_CHARS
    ) {
      return false;
    }
    const file = activeFileById.get(r.sourceTenderFileId);
    if (!file) return false;
    // ENFORCE sourcePage <= totalPages when totalPages exists — fabricated page
    // references must be blocked (mirrors the gate).
    if (
      typeof r.sourcePageNumber === "number" &&
      typeof file.totalPages === "number" &&
      file.totalPages > 0 &&
      r.sourcePageNumber > file.totalPages
    ) {
      return false;
    }
    // QUOTE CONTAINMENT: the normalized quote must appear in the file's
    // extracted text (mirrors the gate). Foreign / guessed / unsupported
    // evidence is rejected.
    const fileText = (file.extractedText ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedQuote = quote.toLowerCase().replace(/\s+/g, " ").trim();
    if (fileText.length === 0 || !fileText.includes(normalizedQuote)) {
      return false;
    }
    return true;
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

  // GATE-ALIGNED STRICT CHECK — mirrors generation-readiness-gate.ts lines 647-702.
  // Uses the SAME shared helpers so the snapshot's gateValid can never disagree
  // with the gate's hasCurrentConfirmedBuildPlan + confirmedBuildPlanItemsValid.
  // Fail-closed: any thrown error or missing step leaves gateValid=false.
  let gateValid = false;
  let gateBlocker: string | null = "No submission plan / generated documents exist. Build the plan first.";
  try {
    const buildPlanModule: typeof import("./build-plan") = await import("./build-plan");
    const recordedBuildPlan = await prisma.buildPlan.findUnique({
      where: { tenderId },
      select: {
        contentHash: true,
        status: true,
        revision: true,
        confirmedRevision: true,
        confirmedContentHash: true,
        itemsJson: true,
      },
    });
    if (!recordedBuildPlan) {
      gateBlocker = "No Build Plan exists. Build and confirm the plan first.";
    } else {
      const persistedItems = recordedBuildPlan.itemsJson
        ? (JSON.parse(recordedBuildPlan.itemsJson) as any[])
        : [];
      const currentPlanHash = await buildPlanModule.computeTenderBuildPlanHash(
        prisma,
        tenderId,
        userId,
        persistedItems as any,
      );
      if (recordedBuildPlan.contentHash !== currentPlanHash) {
        gateBlocker = "Build Plan is stale — tender data changed since the plan was built. Rebuild and re-confirm.";
      } else {
        const confirmed = await buildPlanModule.getCurrentConfirmedBuildPlan(
          prisma,
          tenderId,
          userId,
        );
        if (!confirmed.ok) {
          gateBlocker = confirmed.blocker;
        } else {
          const itemValidation = await buildPlanModule.validateBuildPlanItemsAtRuntime(
            prisma,
            tenderId,
            userId,
            confirmed.items,
          );
          if (!itemValidation.ok) {
            gateBlocker = itemValidation.blockers[0] ?? "Build Plan items are invalid.";
          } else {
            gateValid = true;
            gateBlocker = null;
          }
        }
      }
    }
  } catch {
    // Fail closed — never let a thrown error read as gateValid=true.
    gateValid = false;
    gateBlocker = "Build Plan gate check failed (internal error).";
  }

  const buildPlan: SnapshotBuildPlanState = {
    documentCount: buildPlanCount,
    // Count-based validity — retained for backward-compatible UI display.
    valid: buildPlanCount > 0,
    blocker: buildPlanCount < 1 ? "No submission plan / generated documents exist. Build the plan first." : null,
    gateValid,
    gateBlocker,
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
    overrides: ((tender.metadataOverrides ?? []) as any[]).map((o) => ({
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
