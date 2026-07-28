/**
 * Unified server-side release snapshot.
 *
 * This is the authoritative workflow/readiness payload. It deliberately keeps
 * machine/source verification separate from genuine human review:
 * - SOURCE_VERIFIED may support matching and draft generation.
 * - REVIEWED satisfies final approval only when its current durable provenance
 *   still matches the owned source bytes, extraction revision, fields, and spans.
 */

import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { resolveCanonicalFieldState, type CanonicalFieldStateResult } from "./canonical-field-state";
import { resolveTenderAnalysisState, type AnalysisState } from "./analysis-state-resolver";
import { assessExtractionQuality } from "../extraction-quality";
import { mapRequirementsToEvidence } from "./final-package-readiness-model";
import { buildPageLedger, type PageLedger } from "./page-ledger";
import { classifyTender, type TenderClassification } from "./tender-classification";
import { buildReleaseSnapshotEligibility } from "./release-snapshot-eligibility";
import { EXTRACTION_OVERRIDE_MAX_AGE_MS } from "./readiness-overrides";
import {
  isDurablyReviewed,
  isDurablySourceVerified,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../vault-review-provenance";

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
  blocker: string | null;
};

export type SnapshotAnalysisState = {
  state: AnalysisState;
  canonicalJobId: string | null;
  latestJobHash: string | null;
  currentContentHash: string;
  contentHashMatch: boolean;
  eligibleForExport: boolean;
  blocker: string | null;
};

export type SnapshotRequirementsState = {
  total: number;
  mandatory: number;
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
  gateValid: boolean;
  gateBlocker: string | null;
};

export type SnapshotVaultState = {
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  /** Backward-compatible names; these are current durable HUMAN review counts. */
  selectedReviewedExpertCount: number;
  selectedReviewedProjectCount: number;
  matchingBlocked: boolean;
  blocker: string | null;
};

export type SnapshotMetadataState = CanonicalFieldStateResult & {
  gateValid: boolean;
  gateBlocker: string | null;
};

export type TenderReleaseSnapshot = {
  tenderId: string;
  snapshotRevision: string;
  generatedAt: string;
  extraction: SnapshotExtractionState;
  analysis: SnapshotAnalysisState;
  metadata: SnapshotMetadataState;
  requirements: SnapshotRequirementsState;
  evidence: SnapshotEvidenceState;
  buildPlan: SnapshotBuildPlanState;
  vault: SnapshotVaultState;
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;
  generationBlockers: string[];
  exportBlockers: string[];
  finalZipBlockers: string[];
  pageLedgers: PageLedger[];
  tenderClassification: TenderClassification;
};

const WEAK_EXTRACTION_SCORE_THRESHOLD = 70;

function firstBlocker(values: string[]): string | null {
  return values.length > 0 ? values[0] : null;
}

export async function getTenderReleaseSnapshot(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<TenderReleaseSnapshot | null> {
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
      referenceSourcePage: true,
      referenceSourceQuote: true,
      referenceSourceFileId: true,
      submissionEmailSubjectSourcePage: true,
      submissionEmailSubjectSourceQuote: true,
      submissionEmailSubjectSourceFileId: true,
      contactDetailsSourceJson: true,
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
          totalPages: true,
          pageStatusJson: true,
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
          confirmationBasis: true,
          authorityClass: true,
          confirmedAt: true,
        },
      },
      requirements: {
        select: {
          id: true,
          title: true,
          priority: true,
          requirementType: true,
          sourceTenderFileId: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          complianceMatrixRows: { select: { supportLevel: true } },
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, generationStatus: true },
      },
      expertMatches: {
        where: { isSelected: true },
        include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } },
      },
      projectMatches: {
        where: { isSelected: true },
        include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } },
      },
    },
  });
  if (!tender) return null;

  const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");
  const fileQualities = activeFiles.map((file) => {
    const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
    const score = Math.min(file.extractionScore ?? quality.score, quality.score);
    return {
      file,
      score,
      corrupted: quality.corrupted,
      weak: !quality.corrupted && score < WEAK_EXTRACTION_SCORE_THRESHOLD,
    };
  });

  const weakFileIds = fileQualities.filter((item) => item.weak).map((item) => item.file.id);
  const overrideFileIds = weakFileIds.length > 0
    ? new Set(
        (await prisma.extractionQualityOverride.findMany({
          // ExtractionQualityOverride has no status column -- one row per
          // (tenderId, tenderFileId) IS the active override (see the
          // unique index in its migration and the canonical single-file
          // check in hasActiveExtractionOverride()). "Active" here means
          // "exists and not yet stale," matching that same helper.
          where: {
            tenderId,
            tenderFileId: { in: weakFileIds },
            overriddenAt: { gte: new Date(Date.now() - EXTRACTION_OVERRIDE_MAX_AGE_MS) },
          },
          select: { tenderFileId: true },
          distinct: ["tenderFileId"],
        })).map((row) => row.tenderFileId),
      )
    : new Set<string>();

  const extractionFiles: SnapshotExtractionFile[] = fileQualities.map((item) => ({
    fileId: item.file.id,
    fileName: item.file.originalFileName,
    corrupted: item.corrupted,
    weak: item.weak,
    hasOverride: item.weak && overrideFileIds.has(item.file.id),
    score: item.score,
  }));

  let extractionBlocker: string | null = null;
  if (activeFiles.length === 0) {
    extractionBlocker = "No active tender file exists. Upload and extract the tender document first.";
  } else {
    for (const file of extractionFiles) {
      if (file.corrupted) {
        extractionBlocker = "At least one tender file has corrupted extraction.";
        break;
      }
      if (file.weak && !file.hasOverride) {
        extractionBlocker = "At least one tender file has weak extraction without a human override.";
        break;
      }
    }
  }

  const pageLedgers = activeFiles.map((file) =>
    buildPageLedger(file.totalPages, file.pageStatusJson, file.extractionScore),
  );
  const hasUnsafePageLedger = pageLedgers.some((ledger) => !ledger.isSafeForAnalysis);
  if (!extractionBlocker && hasUnsafePageLedger) {
    const unsafeSummary = pageLedgers.find((ledger) => !ledger.isSafeForAnalysis)?.summary;
    extractionBlocker = unsafeSummary || "Extraction page coverage is incomplete.";
  }

  const extraction: SnapshotExtractionState = {
    activeFileCount: activeFiles.length,
    files: extractionFiles,
    overallOk: extractionBlocker === null,
    blocker: extractionBlocker,
  };

  const combinedText = activeFiles
    .map((file) => file.extractedText ?? "")
    .join("\n\n")
    .slice(0, 50_000);
  const tenderClassification = classifyTender(combinedText);

  const analysisDetail = await resolveTenderAnalysisState(prisma, tenderId, userId);
  const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("./tender-analysis-content");
  const company = await prisma.company.findUnique({
    where: { userId },
    select: {
      documents: {
        select: { originalFileName: true, category: true, extractedText: true },
      },
    },
  });
  const currentContentHash = computeAnalysisContentHash(
    buildTenderAnalysisContent(
      {
        title: tender.title,
        description: tender.description,
        intakeSummary: tender.intakeSummary,
        files: activeFiles,
      },
      company ?? undefined,
    ),
  );

  const latestJob = await prisma.aiJob.findFirst({
    where: { tenderId, userId, jobType: "AI_ANALYZE" },
    orderBy: { createdAt: "desc" },
    select: { analysisInputHash: true },
  });
  const latestJobHash = latestJob?.analysisInputHash ?? null;
  const contentHashMatch = Boolean(latestJobHash && latestJobHash === currentContentHash);
  const analysisEligible =
    analysisDetail.state === "AI_SUCCEEDED" &&
    Boolean(analysisDetail.canonicalJobId) &&
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

  const activeTenderFileIds = new Set(activeFiles.map((f) => f.id));
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
      clientNameSourcePage: tender.clientNameSourcePage ?? null,
      clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
      clientNameSourceFileId: tender.clientNameSourceFileId ?? null,
      submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
      submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
      submissionMethodSourceFileId: tender.submissionMethodSourceFileId ?? null,
      submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
      submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
      submissionAddressSourceFileId: tender.submissionAddressSourceFileId ?? null,
      submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
      submissionEmailSourceQuote: tender.submissionEmailSourceQuote ?? null,
      submissionEmailSourceFileId: tender.submissionEmailSourceFileId ?? null,
      titleSourcePage: tender.titleSourcePage ?? null,
      titleSourceQuote: tender.titleSourceQuote ?? null,
      titleSourceFileId: tender.titleSourceFileId ?? null,
      deadlineSourcePage: tender.deadlineSourcePage ?? null,
      deadlineSourceQuote: tender.deadlineSourceQuote ?? null,
      deadlineSourceFileId: tender.deadlineSourceFileId ?? null,
      referenceSourcePage: tender.referenceSourcePage ?? null,
      referenceSourceQuote: tender.referenceSourceQuote ?? null,
      referenceSourceFileId: tender.referenceSourceFileId ?? null,
      contactDetailsSourceJson: tender.contactDetailsSourceJson,
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
    overrides: tender.metadataOverrides.map((override) => ({
      field: override.field,
      fieldState: override.fieldState,
      overrideValue: override.overrideValue,
      reason: override.reason,
      overriddenBy: override.overriddenBy,
      createdAt: override.createdAt,
      confirmationBasis: override.confirmationBasis,
      authorityClass: override.authorityClass,
      confirmedAt: override.confirmedAt,
    })),
    hasExtractedRequirements: tender.requirements.length > 0,
    submissionMethodContext: tender.submissionMethod ?? undefined,
    activeTenderFileIds,
    activeFiles: activeFiles.map((file) => ({
      id: file.id,
      extractedText: file.extractedText,
      totalPages: file.totalPages,
    })),
  });

  let metadataGateValid = !metadataResult.hasExportBlocker;
  let metadataGateBlocker: string | null = metadataResult.hasExportBlocker
    ? "One or more final Tender Facts are missing, invalid, or lack sufficient audit authority."
    : null;
  if (metadataGateValid) {
    try {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("./build-plan");
      const validation = validateCriticalMetadataEvidenceForBuildPlan(
        tender as never,
        activeFiles as never,
        tender.metadataOverrides.map((override) => ({
          field: override.field,
          fieldState: override.fieldState,
          overrideValue: override.overrideValue,
          reason: override.reason,
          confirmationBasis: override.confirmationBasis,
          authorityClass: override.authorityClass,
          confirmedAt: override.confirmedAt,
        })) as never,
        "final",
      );
      if (!validation.ok) {
        metadataGateValid = false;
        metadataGateBlocker =
          validation.blockers[0] ?? "Final Tender Facts are not source-grounded or audit-authorized.";
      }
    } catch {
      metadataGateValid = false;
      metadataGateBlocker = "Final Tender Facts gate check failed (internal error).";
    }
  }
  const metadata: SnapshotMetadataState = {
    ...metadataResult,
    gateValid: metadataGateValid,
    gateBlocker: metadataGateBlocker,
  };

  const mandatory = tender.requirements.filter(
    (requirement) => (requirement.priority ?? "").toUpperCase() === "MANDATORY",
  );
  const requirementEvidenceStatuses = mapRequirementsToEvidence(
    tender.requirements,
    tender.expertMatches,
    tender.projectMatches,
    activeFiles.map((file) => ({
      id: file.id,
      extractedText: file.extractedText,
      totalPages: file.totalPages,
    })),
  );
  const groundedMandatory = requirementEvidenceStatuses.filter(
    (status) => status.mandatory && status.hasSourceTrace,
  ).length;

  const requirementsBlocker =
    tender.requirements.length === 0
      ? "No requirements have been extracted."
      : groundedMandatory < mandatory.length
        ? `${mandatory.length - groundedMandatory} mandatory requirement(s) are missing active source evidence.`
        : null;
  const requirements: SnapshotRequirementsState = {
    total: tender.requirements.length,
    mandatory: mandatory.length,
    groundedMandatory,
    allMandatoryGrounded: mandatory.length === 0 || groundedMandatory === mandatory.length,
    blocker: requirementsBlocker,
  };

  const covered = requirementEvidenceStatuses.filter(
    (status) => status.mandatory && status.displayStatus === "FULLY_MET",
  ).length;
  const evidence: SnapshotEvidenceState = {
    total: mandatory.length,
    covered,
    coveragePercent: mandatory.length === 0 ? 0 : Math.round((covered / mandatory.length) * 100),
  };

  const buildPlanCount = tender.generatedDocuments.length;
  let buildPlanGateValid = false;
  let buildPlanGateBlocker: string | null =
    "No submission plan / generated documents exist. Build the plan first.";
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
      buildPlanGateBlocker = "No Build Plan exists. Build and confirm the plan first.";
    } else {
      const persistedItems = recordedBuildPlan.itemsJson
        ? (JSON.parse(recordedBuildPlan.itemsJson) as unknown[])
        : [];
      const currentPlanHash = await buildPlanModule.computeTenderBuildPlanHash(
        prisma,
        tenderId,
        userId,
        persistedItems as never,
      );
      if (recordedBuildPlan.contentHash !== currentPlanHash) {
        buildPlanGateBlocker =
          "Build Plan is stale — tender data changed since the plan was built. Rebuild and re-confirm.";
      } else {
        const confirmed = await buildPlanModule.getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
        if (!confirmed.ok) {
          buildPlanGateBlocker = confirmed.blocker;
        } else {
          const itemValidation = await buildPlanModule.validateBuildPlanItemsAtRuntime(
            prisma,
            tenderId,
            userId,
            confirmed.items,
          );
          if (!itemValidation.ok) {
            buildPlanGateBlocker = itemValidation.blockers[0] ?? "Build Plan items are invalid.";
          } else {
            buildPlanGateValid = true;
            buildPlanGateBlocker = null;
          }
        }
      }
    }
  } catch {
    buildPlanGateValid = false;
    buildPlanGateBlocker = "Build Plan gate check failed (internal error).";
  }

  const buildPlan: SnapshotBuildPlanState = {
    documentCount: buildPlanCount,
    valid: buildPlanCount > 0,
    blocker:
      buildPlanCount > 0
        ? null
        : "No submission plan / generated documents exist. Build the plan first.",
    gateValid: buildPlanGateValid,
    gateBlocker: buildPlanGateBlocker,
  };

  const expertRequirementExists = tender.requirements.some(
    (requirement) => requirement.requirementType === "EXPERT",
  );
  const projectRequirementExists = tender.requirements.some(
    (requirement) => requirement.requirementType === "PROJECT_EXPERIENCE",
  );
  const selectedExperts = tender.expertMatches.map((match) => match.expert);
  const selectedProjects = tender.projectMatches.map((match) => match.project);

  const generationEligibleExperts = selectedExperts.filter(
    (expert) => isDurablyReviewed(expert) || isDurablySourceVerified(expert),
  );
  const generationEligibleProjects = selectedProjects.filter(
    (project) => isDurablyReviewed(project) || isDurablySourceVerified(project),
  );
  const reviewedExperts = selectedExperts.filter(isDurablyReviewed);
  const reviewedProjects = selectedProjects.filter(isDurablyReviewed);

  const matchingVaultBlockers: string[] = [];
  if (expertRequirementExists && generationEligibleExperts.length === 0) {
    matchingVaultBlockers.push(
      "Tender requires expert evidence but no selected source-verified or human-reviewed expert evidence is available.",
    );
  }
  if (projectRequirementExists && generationEligibleProjects.length === 0) {
    matchingVaultBlockers.push(
      "Tender requires project evidence but no selected source-verified or human-reviewed project evidence is available.",
    );
  }

  const finalApprovalVaultBlockers: string[] = [];
  if (expertRequirementExists && reviewedExperts.length === 0) {
    finalApprovalVaultBlockers.push(
      "Final approval requires at least one selected expert with current durable human review.",
    );
  }
  if (projectRequirementExists && reviewedProjects.length === 0) {
    finalApprovalVaultBlockers.push(
      "Final approval requires at least one selected project with current durable human review.",
    );
  }

  const matchingVaultBlocker = firstBlocker(matchingVaultBlockers);
  const finalApprovalVaultBlocker = firstBlocker(finalApprovalVaultBlockers);
  const vault: SnapshotVaultState = {
    expertRequirementExists,
    projectRequirementExists,
    selectedReviewedExpertCount: reviewedExperts.length,
    selectedReviewedProjectCount: reviewedProjects.length,
    matchingBlocked: matchingVaultBlockers.length > 0,
    blocker: matchingVaultBlocker,
  };

  const eligibility = buildReleaseSnapshotEligibility({
    extractionBlocker: extraction.blocker,
    analysisBlocker: analysis.blocker,
    metadataGenerationBlocker: metadata.hasGenerationBlocker
      ? "One or more Tender Facts are invalid for draft generation."
      : null,
    metadataFinalBlocker: metadata.gateValid
      ? null
      : metadata.gateBlocker ?? "Final Tender Facts are not ready for export.",
    requirementsBlocker: requirements.blocker,
    buildPlanGateBlocker: buildPlan.gateValid
      ? null
      : buildPlan.gateBlocker ?? "A current confirmed Build Plan is required.",
    matchingVaultBlocker,
    finalApprovalVaultBlocker,
    mandatoryRequirementCount: mandatory.length,
    evidenceCoveragePercent: evidence.coveragePercent,
    allMandatoryGrounded: requirements.allMandatoryGrounded,
  });

  const revisionInput = JSON.stringify({
    currentContentHash,
    analysisState: analysisDetail.state,
    analysisJobId: analysisDetail.canonicalJobId,
    metadataContaminated: tender.metadataContaminated,
    metadataOverrides: tender.metadataOverrides.map((override) => ({
      field: override.field,
      fieldState: override.fieldState,
      overrideValue: override.overrideValue,
      reason: override.reason,
      confirmationBasis: override.confirmationBasis,
      authorityClass: override.authorityClass,
      confirmedAt: override.confirmedAt?.toISOString() ?? null,
    })),
    requirementCount: tender.requirements.length,
    metadataGateValid: metadata.gateValid,
    metadataGateBlocker: metadata.gateBlocker,
    buildPlanGateValid: buildPlan.gateValid,
    buildPlanGateBlocker: buildPlan.gateBlocker,
    documentCount: buildPlanCount,
    generationEligibleExperts: generationEligibleExperts.length,
    generationEligibleProjects: generationEligibleProjects.length,
    reviewedExperts: reviewedExperts.length,
    reviewedProjects: reviewedProjects.length,
    matchingVaultBlocker,
    finalApprovalVaultBlocker,
  });
  const snapshotRevision = createHash("sha256")
    .update(revisionInput)
    .digest("hex")
    .slice(0, 16);

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
    generationEligible: eligibility.generationEligible,
    exportEligible: eligibility.exportEligible,
    finalZipEligible: eligibility.finalZipEligible,
    generationBlockers: eligibility.generationBlockers,
    exportBlockers: eligibility.exportBlockers,
    finalZipBlockers: eligibility.finalZipBlockers,
    pageLedgers,
    tenderClassification,
  };
}
