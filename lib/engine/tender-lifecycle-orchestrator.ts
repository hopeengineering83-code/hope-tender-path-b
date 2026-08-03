// Tender Lifecycle Orchestrator
//
// Single source of truth for "where is this tender in its lifecycle" and
// "what is the one action the user should take right now".
//
// Design:
//   - Pure composition of existing engine modules — no logic is duplicated.
//   - Derives one lifecycleState and one primaryNextAction.
//   - Derives allowedActions / blockedActions to gate every UI button.
//   - Returns a canonical document-count summary used by ALL panels.
//
// Lifecycle states (strict ordered progression):
//   UPLOADED → EXTRACTED → AI_ANALYSIS_REQUIRED → AI_ANALYSIS_FAILED
//   → ANALYSIS_FALLBACK_UNAPPROVED → ANALYSIS_READY_FOR_REVIEW
//   → ANALYSIS_APPROVED → TENDER_FACTS_INCOMPLETE
//   → SOURCE_REFERENCES_INCOMPLETE → SUBMISSION_PLAN_REQUIRED
//   → SUBMISSION_PLAN_READY → EVIDENCE_MATCHING_REQUIRED
//   → EVIDENCE_MATCHED → DOCUMENT_GENERATION_REQUIRED
//   → DOCUMENTS_GENERATED → OFFICIAL_ORIGINALS_REQUIRED
//   → QUALITY_REVIEW_REQUIRED → AUTO_FINALIZE_REQUIRED
//   → EXPORT_READINESS_BLOCKED → EXPORT_READY → ZIP_READY

import type { PrismaClient } from "@prisma/client";
import { logger } from "../observability";
import { getCurrentConfirmedBuildPlan } from "./build-plan";
import { assessExtractionQuality } from "../extraction-quality";
import {
  isExtractionAcceptableForGeneration,
  isExtractionAcceptableForExport,
} from "./extraction-quality-gate";
import {
  detectAnalysisSourceWithApproval,
  type AnalysisSource,
} from "./analysis-source";
import {
  assessTenderMetadataCompleteness,
  type MetadataCompletenessReport,
  type MetadataCompletenessInput,
} from "./tender-metadata-completeness";
import {
  resolveSubmissionPlanCompleteness,
  type SubmissionPlanCompletenessReport,
  type GeneratedDocSnapshot,
} from "./submission-plan-completeness";
import {
  computeEvidenceCoverage,
  type EvidenceCoverageReport,
} from "./requirement-evidence-profile";
import { mapRequirementsToEvidence } from "./final-package-readiness-model";
import {
  buildProviderDiagnosticsSnapshot,
} from "../ai-provider-health";
import { newDiagnosticId } from "./safe-api-error";
import { resolveCurrentAnalysisBinding } from "./generation-readiness-gate";

// ─── Public types ─────────────────────────────────────────────────────────────

export type LifecycleState =
  | "UPLOADED"
  | "EXTRACTED"
  | "AI_ANALYSIS_REQUIRED"
  | "AI_ANALYSIS_FAILED"
  | "ANALYSIS_FALLBACK_UNAPPROVED"
  | "ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY"
  | "ANALYSIS_READY_FOR_REVIEW"
  | "ANALYSIS_APPROVED"
  | "TENDER_FACTS_INCOMPLETE"
  | "SOURCE_REFERENCES_INCOMPLETE"
  | "SUBMISSION_PLAN_REQUIRED"
  | "SUBMISSION_PLAN_READY"
  | "EVIDENCE_MATCHING_REQUIRED"
  // Engine has run but no compliance/matching rows were produced — vault
  // inputs likely missing. Distinct from EVIDENCE_MATCHING_REQUIRED (engine
  // has genuinely never run) so the UI can stop telling the user to
  // re-run Engine endlessly when the real fix is reviewing vault inputs.
  | "EVIDENCE_MATCHING_EMPTY"
  // Engine ran and matching rows exist, but no FULL/SUBSTANTIAL evidence
  // covers mandatory requirements. Primary action becomes
  // LINK_VAULT_EVIDENCE, not Run Engine.
  | "EVIDENCE_MATCHING_UNCONFIRMED"
  | "EVIDENCE_MATCHED"
  | "DOCUMENT_GENERATION_REQUIRED"
  | "DOCUMENTS_GENERATED"
  | "OFFICIAL_ORIGINALS_REQUIRED"
  | "QUALITY_REVIEW_REQUIRED"
  | "AUTO_FINALIZE_REQUIRED"
  // AI Analyze job is in PARTIAL_NEEDS_RESUME — some chunks succeeded,
  // some failed, and the analysis is resumable. Generation and export
  // remain blocked until the analysis is resumed or retried.
  | "PARTIAL_AI_ANALYSIS_BLOCKED"
  | "EXPORT_READINESS_BLOCKED"
  | "EXPORT_READY"
  | "ZIP_READY"
  | "CLOSED";

export type PrimaryNextAction =
  | "UPLOAD_TENDER_DOCUMENT"
  | "CONFIGURE_AI_PROVIDER"
  | "RUN_AI_ANALYZE"
  | "RETRY_AI_ANALYZE"
  | "RESUME_AI_ANALYZE"
  | "APPROVE_FALLBACK_WITH_NOTE"
  | "REVIEW_ANALYSIS"
  | "COMPLETE_METADATA"
  | "REPAIR_SOURCE_REFERENCES"
  | "BUILD_SUBMISSION_PLAN"
  | "RUN_ENGINE"
  | "LINK_VAULT_EVIDENCE"
  | "GENERATE_REQUIRED_DOCUMENTS"
  | "ATTACH_OFFICIAL_ORIGINALS"
  | "REPAIR_DOCUMENT_QUALITY"
  | "AUTO_FINALIZE"
  | "RESOLVE_EXPORT_BLOCKERS"
  | "DOWNLOAD_FINAL_ZIP"
  | "RECONCILE_OUTSIDE_PLAN_DOCS"
  | "REVIEW_MATCHING_INPUTS";

export type AllowedAction =
  | "AI_ANALYZE"
  | "APPROVE_FALLBACK"
  | "REVOKE_FALLBACK_APPROVAL"
  | "COMPLETE_METADATA"
  | "REPAIR_SOURCE_REFERENCES"
  | "BUILD_SUBMISSION_PLAN"
  | "RUN_ENGINE"
  | "LINK_VAULT_EVIDENCE"
  | "GENERATE_DOCS"
  | "ATTACH_OFFICIAL_ORIGINALS"
  | "REPAIR_DOCS"
  | "AUTO_FINALIZE"
  | "RE_CHECK"
  | "DOWNLOAD_ZIP"
  | "RECONCILE_OUTSIDE_PLAN";

export type BlockedAction = {
  action: AllowedAction;
  reason: string;
};

export type DocumentCountSummary = {
  requiredPlanRows: number;
  generatedNarrativeDocs: number;
  attachedOfficialOriginals: number;
  plannedMissingDocs: number;
  controlRows: number;
  outsidePlanRows: number;
  finalExportCandidates: number;
  qualityFailedCandidates: number;
  historicalSupersededRows: number;
  envelopes: {
    TECHNICAL: number;
    FINANCIAL: number;
    ADMIN: number;
  };
};

export type ProviderStatusSummary = {
  totalConfigured: number;
  totalHealthy: number;
  hasAnyProvider: boolean;
  hasCooledDownProvider: boolean;
  primaryProvider: string | null;
};

export type TenderLifecycleResult = {
  lifecycleState: LifecycleState;
  finalSubmissionStatus: "BLOCKED" | "PARTIAL" | "READY";
  primaryNextAction: PrimaryNextAction;
  allowedActions: AllowedAction[];
  blockedActions: BlockedAction[];

  // Summary counts — same numbers shown in every panel
  counts: DocumentCountSummary;

  // Sub-status per domain
  providerStatus: ProviderStatusSummary;
  analysisStatus: {
    source: AnalysisSource;
    hasText: boolean;
    score: number | null;
    /** Canonical state from resolveTenderAnalysisState. Used to distinguish
     *  PARTIAL_NEEDS_RESUME from AI_SUCCEEDED so the orchestrator can
     *  recommend RESUME_AI_ANALYZE instead of treating partial AI as
     *  full success. */
    canonicalState?: string;
    /** True when the current tender source content differs from the
     *  analysis binding hash — the analysis is stale and must be re-run
     *  before downstream steps can proceed. */
    stale?: boolean;
    /** True when the AI Analyze job is PARTIAL_NEEDS_RESUME — some chunks
     *  succeeded, some failed, and the analysis is resumable. */
    partial?: boolean;
  };
  metadataStatus: {
    completenessRatio: number;
    criticalMissing: string[];
    nonCriticalMissing: string[];
  };
  sourceReferenceStatus: {
    ungroundedMandatoryCount: number;
    totalMandatoryCount: number;
  };
  planStatus: {
    hasExplicitPlan: boolean;
    totalRequired: number;
    totalGenerated: number;
    totalMissing: number;
    totalOutsidePlan: number;
    totalOfficialOriginalsRequired: number;
  };
  evidenceStatus: EvidenceCoverageReport & {
    /** True when at least one ENGINE_RUN AiJob has reached a terminal
     *  status (SUCCEEDED / PARTIAL_SUCCESS / FAILED). Used to distinguish
     *  "Engine has genuinely never run" (false) from "Engine ran but
     *  produced no/weak matching rows" (true) so the orchestrator no
     *  longer tells the user to re-run Engine endlessly. */
    engineHasRun: boolean;
  };
  documentStatus: {
    total: number;
    generated: number;
    planned: number;
    superseded: number;
  };
  qualityStatus: {
    qualityFailed: number;
  };
  officialOriginalStatus: {
    required: number;
    attached: number;
  };
  exportStatus: {
    ready: boolean;
    blockerCount: number;
    documentBlockerCount: number;
    advisoryCount: number;
  };

  // Structured blockers and warnings for the Recovery panel
  blockers: Array<{ code: string; message: string; action: string }>;
  warnings: Array<{ code: string; message: string }>;
  advisoryWarnings: Array<{ code: string; message: string }>;

  /** Stable diagnostic id for log correlation. Always present so the
   *  Recovery Command Center can surface it when finalSubmissionStatus
   *  is BLOCKED and the user needs to file a support request. */
  diagnosticId: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function providerSummary(): ProviderStatusSummary {
  try {
    const snap = buildProviderDiagnosticsSnapshot();
    const all = snap.perProvider;
    const configured = all.filter((p) => p.configured);
    const healthy = configured.filter((p) => !p.coolingDown);
    const primary = healthy[0]?.provider ?? configured[0]?.provider ?? null;
    return {
      totalConfigured: configured.length,
      totalHealthy: healthy.length,
      hasAnyProvider: configured.length > 0,
      hasCooledDownProvider: configured.some((p) => p.coolingDown),
      primaryProvider: primary,
    };
  } catch {
    return { totalConfigured: 0, totalHealthy: 0, hasAnyProvider: false, hasCooledDownProvider: false, primaryProvider: null };
  }
}

function countSummaryFromPlan(
  plan: SubmissionPlanCompletenessReport,
  docs: GeneratedDocSnapshot[],
): DocumentCountSummary {
  const finalCandidates = plan.rows.filter(
    (r) => r.status === "GENERATED" || r.status === "GENERATED_NEEDS_REVIEW",
  );
  const qualityFailed = plan.rows.filter(
    (r) => r.status === "GENERATED_QUALITY_FAILED",
  );
  const officialAttached = plan.rows.filter(
    (r) =>
      r.officialOriginal &&
      (r.status === "GENERATED" || r.status === "GENERATED_NEEDS_REVIEW"),
  );

  return {
    requiredPlanRows: plan.totalRequired,
    generatedNarrativeDocs: plan.totalGenerated,
    attachedOfficialOriginals: officialAttached.length,
    plannedMissingDocs: plan.totalMissing,
    controlRows: plan.rows.filter((r) => r.status === "PLANNED").length,
    outsidePlanRows: plan.totalOutsidePlan,
    finalExportCandidates: finalCandidates.length,
    qualityFailedCandidates: qualityFailed.length,
    historicalSupersededRows: plan.totalSuperseded,
    envelopes: {
      TECHNICAL: plan.envelopeBreakdown.TECHNICAL ?? 0,
      FINANCIAL: plan.envelopeBreakdown.FINANCIAL ?? 0,
      ADMIN: plan.envelopeBreakdown.ADMIN ?? 0,
    },
  };
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

type TenderRow = {
  id: string;
  notes: string | null;
  status: string;
  stage: string | null;
  readinessScore: number | null;
  clientName: string | null;
  deadline: Date | null;
  title: string;
  category: string | null;
  budget: number | null;
  currency: string | null;
  submissionMethod: string | null;
  submissionAddress: string | null;
  submissionEmails: string | null;
  exactFileNaming: string | null;
  exactFileOrder: string | null;
  evaluationMethodology: string | null;
  analysisSummary: string | null;
  intakeSummary: string | null;
  description: string | null;
};

export async function computeTenderLifecycle(
  client: PrismaClient,
  tenderId: string,
  userId?: string,
): Promise<TenderLifecycleResult | null> {
  // Load tender + related data in parallel
  const [tender, files, requirements, generatedDocs, complianceRows, engineJobCount, engineAuditCount] =
    await Promise.all([
      client.tender.findFirst({
        where: { id: tenderId, ...(userId ? { userId } : {}) },
        select: {
          id: true,
          notes: true,
          status: true,
          stage: true,
          readinessScore: true,
          clientName: true,
          procuringEntityName: true,
          deadline: true,
          title: true,
          category: true,
          budget: true,
          currency: true,
          submissionMethod: true,
          submissionAddress: true,
          submissionEmails: true,
          exactFileNaming: true,
          exactFileOrder: true,
          evaluationMethodology: true,
          analysisSummary: true,
          intakeSummary: true,
          description: true,
          metadataContaminated: true,
          userId: true,
        },
      }),
      client.tenderFile.findMany({
        where: {
          tenderId,
          deletionStatus: "ACTIVE",
          ...(userId ? { tender: { userId } } : {}),
        },
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          extractedText: true,
          totalPages: true,
          extractedPages: true,
          ocrPages: true,
          failedPages: true,
          extractionScore: true,
        },
      }),
      client.tenderRequirement.findMany({
        where: { tenderId, ...(userId ? { tender: { userId } } : {}) },
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          requirementType: true,
          sectionReference: true,
          sourceTenderFileId: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          sourceConfidence: true,
          complianceMatrixRows: {
            select: { id: true, supportLevel: true, evidenceSource: true },
          },
        },
      }),
      client.generatedDocument.findMany({
        where: { tenderId, ...(userId ? { tender: { userId } } : {}) },
        select: {
          id: true,
          name: true,
          exactFileName: true,
          exactOrder: true,
          documentType: true,
          format: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          storagePath: true,
        },
      }),
      client.complianceMatrix.count({ where: { tenderId, ...(userId ? { tender: { userId } } : {}) } }),
      // Durable signal 1: count terminal ENGINE_RUN AiJobs so the orchestrator
      // can distinguish "Engine has genuinely never run" (false) from
      // "Engine ran but produced no/weak matching rows" (true). Without
      // this, the orchestrator kept recommending RUN_ENGINE even after
      // Engine had completed but produced no compliance rows — the user
      // ended up in a loop of re-running Engine with no effect.
      client.aiJob.count({
        where: {
          tenderId,
          jobType: "ENGINE_RUN",
          status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED"] },
        },
      }),
      // Durable signal 2: count TENDER_ENGINE_RUN_STARTED audit log entries.
      // The sync engine route (POST /api/tenders/[id]/engine) calls
      // runTenderEngine directly WITHOUT creating an AiJob — so the AiJob
      // count alone misses sync engine runs. runTenderEngine writes
      // TENDER_ENGINE_RUN_STARTED to the AuditLog at the start of EVERY
      // run (sync and async), making it the most reliable durable signal.
      // The AuditLog has @@index([action]) and @@index([entityType, entityId])
      // so this query is efficient.
      client.auditLog.count({
        where: {
          entityId: tenderId,
          entityType: "Tender",
          action: "TENDER_ENGINE_RUN_STARTED",
        },
      }),
    ]);

  if (!tender) return null;

  // ── Canonical analysis state ──────────────────────────────────────────────
  // resolveTenderAnalysisState looks at AiJob + AiAnalyzeChunk rows (not
  // just tender.notes) and exposes a PARTIAL_NEEDS_RESUME state that the
  // notes-based detectAnalysisSourceWithApproval cannot see. We use it
  // ONLY to detect the partial-AI case — the existing analysisSource
  // variable continues to drive the rest of the orchestrator so we don't
  // accidentally weaken the regex-fallback audit-only guard.
  let canonicalAnalysisState: string | null = null;
  try {
    const { resolveTenderAnalysisState } = await import("./analysis-state-resolver");
    const detail = await resolveTenderAnalysisState(
      client,
      tenderId,
      tender.userId ?? userId ?? "",
    );
    canonicalAnalysisState = detail?.state ?? null;
  } catch {
    // The canonical resolver is best-effort. If it fails (e.g. missing
    // Prisma client in unit-test harness), we fall back to the existing
    // notes-based detection — the partial-AI branch simply won't fire.
    canonicalAnalysisState = null;
  }
  const analysisPartialNeedsResume = canonicalAnalysisState === "PARTIAL_NEEDS_RESUME";
  // engineHasRun: durable signal that Engine has executed at least once.
  // Combined with complianceRows below to distinguish the four matching
  // states the spec requires:
  //   1. never ran        → complianceRows === 0 && !engineHasRun
  //   2. ran, no rows     → complianceRows === 0 && engineHasRun
  //   3. ran, weak rows   → complianceRows > 0 && !mandatoryEvidenceReady
  //   4. ran, strong rows → complianceRows > 0 && mandatoryEvidenceReady
  // We check TWO durable signals:
  //   - engineJobCount: terminal ENGINE_RUN AiJobs (async path)
  //   - engineAuditCount: TENDER_ENGINE_RUN_STARTED audit log entries
  //     (sync path — the sync engine route calls runTenderEngine directly
  //     without creating an AiJob, but runTenderEngine ALWAYS writes the
  //     audit log entry). This closes the gap where a sync engine run
  //     was invisible to the orchestrator, causing it to recommend
  //     RUN_ENGINE even after Engine had already run synchronously.
  const engineHasRun = engineJobCount > 0 || engineAuditCount > 0;

  // Effective extraction metrics — combine the stored per-file score with a
  // freshly recomputed score and keep the more conservative (lower) value so a
  // stale-optimistic stored score cannot unblock a genuinely poor extraction.
  const effectiveFiles = files.map((file) => {
    const quality = assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName);
    return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score) };
  });

  // ── Analysis source ────────────────────────────────────────────────────────
  const analysisSource = await detectAnalysisSourceWithApproval(
    client,
    tenderId,
    tender,
  );
  const hasText = files.some(
    (f) => (f.extractedText ?? "").trim().length > 100,
  );
  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only and MUST
  // NEVER be treated as a valid analysis for lifecycle "hasAnalysis" — only
  // genuine AI (or even REGEX_FALLBACK_AI_ERROR, which merely proves an
  // analysis attempt was made) counts. The release authorization check
  // (analysisOk below) is what blocks HUMAN_APPROVED from authorizing actions.
  const hasAnalysis =
    analysisSource === "AI" ||
    analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK" ||
    analysisSource === "REGEX_FALLBACK_AI_ERROR";

  // Stale analysis detection: compare the latest SUCCEEDED AI Analyze job's
  // content hash to the current tender source content hash. If they differ,
  // the analysis is stale and must be re-run before downstream steps proceed.
  let analysisIsStale = false;
  if (hasAnalysis && !analysisPartialNeedsResume && canonicalAnalysisState === "AI_SUCCEEDED") {
    try {
      const binding = await resolveCurrentAnalysisBinding(client, tenderId, tender.userId ?? userId ?? "");
      const latestSucceeded = await client.aiJob.findFirst({
        where: { tenderId, jobType: "AI_ANALYZE", status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
        select: { analysisInputHash: true },
      });
      if (latestSucceeded && binding.contentHash && latestSucceeded.analysisInputHash !== binding.contentHash) {
        analysisIsStale = true;
      }
    } catch (e) {
      // Best-effort — if hash computation fails, don't flag as stale — but
      // surface the failure so silent stale-detection bypass is observable.
      // Previously bare `catch {}`; a failure here could let a stale
      // analysis pass the freshness gate.
      logger.warn("[tender-lifecycle-orchestrator] analysis hash comparison failed — not flagging as stale", {
        detail: e,
      });
    }
  }

  // ── Provider health ────────────────────────────────────────────────────────
  const providers = providerSummary();

  // ── Metadata completeness ──────────────────────────────────────────────────
  const metaInput: MetadataCompletenessInput = {
    title: tender.title,
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    deadline: tender.deadline,
    budget: tender.budget,
    currency: tender.currency,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    metadataContaminated: tender.metadataContaminated,
    requirementCount: requirements.length,
    hasEvaluationMethodology: Boolean(tender.evaluationMethodology),
    hasSubmissionRules: Boolean(
      tender.submissionMethod || tender.submissionAddress || tender.submissionEmails,
    ),
  };
  const meta: MetadataCompletenessReport =
    assessTenderMetadataCompleteness(metaInput);
  // Extraction quality gates — mirror the route-level enforcement so the
  // lifecycle's allowed/blocked actions stay truthful in the UI.
  const extractionGenerationOk = isExtractionAcceptableForGeneration(effectiveFiles);
  const extractionExportOk = isExtractionAcceptableForExport(effectiveFiles);
  const metadataGenerationOk = !meta.blockingForGeneration;
  const metadataExportOk = !meta.blockingForExport;

  // ── Source references ──────────────────────────────────────────────────────
  const mandatoryReqs = requirements.filter((r) => r.priority === "MANDATORY");
  const requirementEvidenceStatuses = mapRequirementsToEvidence(
    requirements,
    [],
    [],
    effectiveFiles.map((file) => ({
      id: file.id,
      extractedText: file.extractedText,
      totalPages: file.totalPages,
    })),
  );
  const canonicalStatusByRequirementId = new Map(
    requirementEvidenceStatuses.map((status) => [status.requirementId, status]),
  );
  const ungroundedMandatory = mandatoryReqs.filter(
    (requirement) => !canonicalStatusByRequirementId.get(requirement.id)?.hasSourceTrace,
  );

  // ── Evidence coverage ──────────────────────────────────────────────────────
  const rawEvidenceStatus = computeEvidenceCoverage(
    requirements.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      priority: r.priority,
      requirementType: r.requirementType,
      complianceMatrixRows: r.complianceMatrixRows,
    })),
  );
  const canonicalStrongCount = requirementEvidenceStatuses.filter(
    (status) => status.displayStatus === "FULLY_MET",
  ).length;
  const canonicalMandatoryStrongCount = requirementEvidenceStatuses.filter(
    (status) => status.mandatory && status.displayStatus === "FULLY_MET",
  ).length;
  const evidenceStatus: EvidenceCoverageReport = {
    ...rawEvidenceStatus,
    profiles: rawEvidenceStatus.profiles.map((profile) => ({
      ...profile,
      hasStrongEvidence:
        canonicalStatusByRequirementId.get(profile.requirementId)?.displayStatus === "FULLY_MET",
    })),
    requirementsWithStrongEvidence: canonicalStrongCount,
    strongCoveragePercent: requirements.length === 0
      ? 0
      : Math.round((canonicalStrongCount / requirements.length) * 100),
    fullyCoveredMandatory: canonicalMandatoryStrongCount,
    coverageRatio: mandatoryReqs.length === 0
      ? 0
      : canonicalMandatoryStrongCount / mandatoryReqs.length,
  };

  // ── Submission plan completeness ───────────────────────────────────────────
  const tenderLike = {
    id: tenderId,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    requirements: requirements.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      requirementType: r.requirementType,
      sectionReference: r.sectionReference ?? undefined,
    })),
  };
  const docsSnap: GeneratedDocSnapshot[] = generatedDocs.map((d) => ({
    ...d,
    fileContent: null,
    storagePath: d.storagePath ?? null,
    generationStatus: d.generationStatus ?? "",
    validationStatus: d.validationStatus ?? "",
    reviewStatus: d.reviewStatus ?? "",
  }));
  // AUTHORITATIVE: lifecycle counts follow the confirmed Build Plan when one
  // exists so dashboard counts cannot disagree with the gates.
  const confirmedPlan = await getCurrentConfirmedBuildPlan(client, tenderId, userId ?? "");
  const plan = resolveSubmissionPlanCompleteness({
    tender: tenderLike,
    generatedDocuments: docsSnap,
    confirmedPlanItems: confirmedPlan.ok ? confirmedPlan.items : null,
  });

  // ── Derived counts ─────────────────────────────────────────────────────────
  const counts = countSummaryFromPlan(plan, docsSnap);

  // ── Official originals ─────────────────────────────────────────────────────
  const officialRequired =
    plan.totalOfficialOriginalsRequired +
    plan.rows.filter((r) => r.status === "REPLACE_WITH_ORIGINAL").length;
  const officialAttached = plan.rows.filter(
    (r) =>
      r.officialOriginal &&
      (r.status === "GENERATED" || r.status === "GENERATED_NEEDS_REVIEW"),
  ).length;

  // ── Export status (lightweight — full check done by export-readiness API) ──
  // This deliberately does NOT read tender.readinessScore. That DB column is a
  // legacy workflow-progress hint and can drift from the canonical gates. The
  // lifecycle can only show READY when the explicit gate signals below are clear.
  const mandatoryEvidenceReady = mandatoryReqs.every(
    (requirement) =>
      canonicalStatusByRequirementId.get(requirement.id)?.displayStatus === "FULLY_MET",
  );
  const finalExportReady =
    analysisSource === "AI" &&
    ungroundedMandatory.length === 0 &&
    mandatoryEvidenceReady &&
    counts.finalExportCandidates > 0 &&
    counts.plannedMissingDocs === 0 &&
    counts.outsidePlanRows === 0 &&
    counts.qualityFailedCandidates === 0 &&
    officialRequired <= officialAttached;

  // ─────────────────────────────────────────────────────────────────────────
  // Determine lifecycle state (strict priority ordering)
  // ─────────────────────────────────────────────────────────────────────────

  let lifecycleState: LifecycleState | undefined;
  let primaryNextAction: PrimaryNextAction | undefined;
  const blockers: TenderLifecycleResult["blockers"] = [];
  const warnings: TenderLifecycleResult["warnings"] = [];
  const advisoryWarnings: TenderLifecycleResult["advisoryWarnings"] = [];

  // 1. No files uploaded at all
  if (files.length === 0) {
    lifecycleState = "UPLOADED";
    primaryNextAction = "UPLOAD_TENDER_DOCUMENT";
    blockers.push({ code: "NO_FILES", message: "No tender document uploaded yet.", action: "Upload the official tender source document." });
  }
  // 2. Files exist but no text extracted
  else if (!hasText) {
    lifecycleState = "EXTRACTED";
    primaryNextAction = "RUN_AI_ANALYZE";
    blockers.push({ code: "NO_EXTRACTED_TEXT", message: "No meaningful text extracted from uploaded files.", action: "Re-upload a readable PDF or enable OCR." });
  }
  // 3. No provider configured — cannot run AI
  else if (!hasAnalysis && !providers.hasAnyProvider) {
    lifecycleState = "AI_ANALYSIS_REQUIRED";
    primaryNextAction = "CONFIGURE_AI_PROVIDER";
    blockers.push({ code: "NO_AI_PROVIDER", message: "No AI provider is configured. Analysis cannot run.", action: "Add ANTHROPIC_API_KEY, GEMINI_API_KEY, or another provider key in environment settings." });
  }
  // 4. Has text but no analysis yet
  else if (!hasAnalysis) {
    lifecycleState = "AI_ANALYSIS_REQUIRED";
    primaryNextAction = "RUN_AI_ANALYZE";
  }
  // 4b. AI Analyze is partial — needs resume. The notes-based detector
  //     above treats this as "AI" (hasAnalysis=true) because tender.notes
  //     contains "Analysis source: AI", but the canonical resolver can see
  //     that the underlying AiJob is PARTIAL_SUCCESS / PARTIAL_NEEDS_RESUME.
  //     Generation and export remain blocked until the analysis is resumed
  //     or retried — so this MUST be checked BEFORE the regex-fallback
  //     branch (which only fires when analysisSource is REGEX_FALLBACK_*).
  //     Per spec rule 4: primary action must become RESUME_AI_ANALYZE,
  //     not Run Engine.
  else if (analysisPartialNeedsResume) {
    lifecycleState = "PARTIAL_AI_ANALYSIS_BLOCKED";
    primaryNextAction = providers.hasAnyProvider ? "RESUME_AI_ANALYZE" : "CONFIGURE_AI_PROVIDER";
    blockers.push({
      code: "ANALYSIS_PARTIAL_NEEDS_RESUME",
      message: "AI Analyze is partial — some chunks failed. Generation and export are blocked until the analysis is resumed or retried with healthy providers.",
      action: providers.hasAnyProvider
        ? "Resume AI Analyze to complete the failed chunks. The resumable job will skip already-succeeded chunks."
        : "Add an AI provider key in environment settings, then resume AI Analyze.",
    });
  }
  // 5. Analysis used regex fallback and is not human-approved
  else if (analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    lifecycleState = "ANALYSIS_FALLBACK_UNAPPROVED";
    primaryNextAction = providers.hasAnyProvider ? "RETRY_AI_ANALYZE" : "APPROVE_FALLBACK_WITH_NOTE";
    blockers.push({
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Analysis used the regex fallback (all AI providers failed). Generate Docs, Auto-finalize, and Download ZIP are blocked until AI analysis succeeds. Human approval is audit-only and does NOT authorize release.",
      action: providers.hasAnyProvider ? "Retry AI Analyze — providers may be available again." : "Re-run AI Analyze after restoring provider access.",
    });
  }
  // 5b. Analysis used regex fallback and WAS human-approved — but human approval
  //     is now AUDIT-ONLY. It does not authorize release. The lifecycle state
  //     still shows "approved" so the audit trail is preserved, but the
  //     blockers explicitly tell the user that release remains blocked until
  //     AI Analyze is re-run with healthy providers.
  else if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    lifecycleState = "ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY";
    primaryNextAction = "RETRY_AI_ANALYZE";
    blockers.push({
      code: "ANALYSIS_FALLBACK_AUDIT_ONLY",
      message: "Analysis used the regex fallback and was human-approved as audit-only. Human approval no longer authorizes Generate Docs, Auto-finalize, Export, Download ZIP, or any release action. Re-run AI Analyze with healthy providers to obtain a genuine AI analysis.",
      action: "Retry AI Analyze — providers may be available again. The audit-only approval is preserved for record-keeping.",
    });
  }
  // 6. Metadata incomplete — ADVISORY ONLY (unified runtime model)
  // Metadata is NO LONGER a hard blocker. Missing critical fields and
  // contamination are recorded as warnings (not blockers) so the workflow
  // can proceed to analysis, generation, and export.
  //
  // BUG FIX: This was previously an `else if` branch that set ONLY warnings
  // but did NOT set lifecycleState/primaryNextAction. Because it was in the
  // if/else-if chain, control exited the chain and the fallbacks at the
  // bottom kicked in (ANALYSIS_APPROVED + LINK_VAULT_EVIDENCE), hiding
  // downstream states like SOURCE_REFERENCES_INCOMPLETE. Now the warnings
  // are pushed unconditionally (NOT as an else-if) so the rest of the
  // chain continues to evaluate.
  if (meta.missingCritical.length > 0) {
    warnings.push({
      code: "METADATA_FIELDS_MISSING",
      message: `${meta.missingCritical.length} optional metadata field(s) are missing — advisory only, does not block.`,
    });
  }
  if (tender.metadataContaminated) {
    warnings.push({
      code: "CLIENT_ENTITY_CONTAMINATED_ADVISORY",
      message: "Client name may contain portal text — advisory only, does not block.",
    });
  }
  // 7. Source references missing for mandatory requirements
  if (ungroundedMandatory.length > 0 && mandatoryReqs.length > 0) {
    lifecycleState = "SOURCE_REFERENCES_INCOMPLETE";
    primaryNextAction = "REPAIR_SOURCE_REFERENCES";
    warnings.push({
      code: "SOURCE_REFERENCES_MISSING",
      message: `${ungroundedMandatory.length}/${mandatoryReqs.length} mandatory requirements lack source page/quote traceability.`,
    });
    // Not a hard blocker here — becomes one at export time
    // NOTE: The previous inner `if (requirements.length === 0)` was dead
    // code — the outer condition `mandatoryReqs.length > 0` guarantees
    // `requirements.length > 0` (mandatoryReqs is a filter of requirements).
    // Removed per audit.
  }
  // 8. No submission plan rows (requirements but no plan)
  else if (requirements.length > 0 && plan.totalRequired === 0 && docsSnap.length === 0) {
    lifecycleState = "SUBMISSION_PLAN_REQUIRED";
    primaryNextAction = "BUILD_SUBMISSION_PLAN";
    warnings.push({ code: "NO_SUBMISSION_PLAN", message: "No explicit submission plan exists. Generated documents cannot be validated against tender requirements." });
  }
  // 9. Evidence matching needed — DURABLE SIGNAL SPLIT.
  //    The orchestrator now distinguishes four matching states (spec rule 1):
  //      9a. Engine has genuinely never run  → RUN_ENGINE (only valid case)
  //      9b. Engine ran but produced no rows → REVIEW_MATCHING_INPUTS
  //      9c. Engine ran, rows exist, no FULL/SUBSTANTIAL → LINK_VAULT_EVIDENCE
  //    Without this split, the orchestrator kept recommending RUN_ENGINE
  //    even after Engine had completed but produced no compliance rows —
  //    the user ended up in a loop of re-running Engine with no effect.
  else if (requirements.length > 0 && complianceRows === 0 && !engineHasRun) {
    lifecycleState = "EVIDENCE_MATCHING_REQUIRED";
    primaryNextAction = "RUN_ENGINE";
    blockers.push({ code: "EVIDENCE_NOT_ASSESSED", message: "Requirements exist but the compliance/evidence matrix is empty — Engine has never run for this tender.", action: "Run Engine to create requirement-evidence links." });
  }
  // 9b. Engine has run but produced zero compliance rows. Re-running Engine
  //     is unlikely to help — the real issue is missing vault inputs
  //     (no reviewed experts/projects, no compliance records). Primary
  //     action becomes REVIEW_MATCHING_INPUTS, not Run Engine.
  else if (requirements.length > 0 && complianceRows === 0 && engineHasRun) {
    lifecycleState = "EVIDENCE_MATCHING_EMPTY";
    primaryNextAction = "REVIEW_MATCHING_INPUTS";
    blockers.push({
      code: "ENGINE_RAN_NO_MATCHES",
      message: "Engine has already run but produced no matching rows. Re-running Engine without fixing vault inputs will not help.",
      action: "Review vault experts/projects and compliance records on the Matching page, then re-run Engine.",
    });
  }
  // 9c. Engine ran and matching rows exist, but no FULL/SUBSTANTIAL
  //     evidence covers mandatory requirements. Per spec rule 2: primary
  //     action must become LINK_VAULT_EVIDENCE, not Run Engine. This MUST
  //     be checked BEFORE step 11 (DOCUMENT_GENERATION_REQUIRED) so that
  //     evidence gaps take priority over doc-generation gaps — per spec
  //     rule 6, the primary next action is the first blocker-resolving
  //     action.
  else if (requirements.length > 0 && mandatoryReqs.length > 0 && !mandatoryEvidenceReady && complianceRows > 0) {
    lifecycleState = "EVIDENCE_MATCHING_UNCONFIRMED";
    primaryNextAction = "LINK_VAULT_EVIDENCE";
    blockers.push({
      code: "MANDATORY_EVIDENCE_WEAK",
      message: `Engine has run and ${complianceRows} matching row(s) exist, but ${mandatoryReqs.length - (evidenceStatus.fullyCoveredMandatory ?? 0)}/${mandatoryReqs.length} mandatory requirements are not covered by confirmed FULL/SUBSTANTIAL evidence.`,
      action: "Link vault evidence or confirm existing evidence to strengthen mandatory coverage before generating documents.",
    });
  }
  // 10. Outside-plan docs need reconciliation before export
  else if (counts.outsidePlanRows > 0 && counts.finalExportCandidates > 0) {
    lifecycleState = "SUBMISSION_PLAN_READY";
    primaryNextAction = "RECONCILE_OUTSIDE_PLAN_DOCS";
    warnings.push({ code: "OUTSIDE_PLAN_DOCS", message: `${counts.outsidePlanRows} document(s) are outside the submission plan and must be mapped or superseded before final export.` });
  }
  // 11. Documents need generation — per spec rule 3: primary action must
  //     become GENERATE_REQUIRED_DOCUMENTS, not Run Engine. This branch
  //     fires only when evidence is already strong (or no mandatory reqs)
  //     because step 9c above takes priority for weak evidence.
  else if (counts.plannedMissingDocs > 0 || (plan.totalRequired > 0 && counts.finalExportCandidates === 0)) {
    lifecycleState = "DOCUMENT_GENERATION_REQUIRED";
    primaryNextAction = "GENERATE_REQUIRED_DOCUMENTS";
    blockers.push({ code: "DOCUMENTS_NOT_GENERATED", message: `${counts.plannedMissingDocs} required submission document(s) are planned but not generated.`, action: "Click 'Generate missing planned documents' or 'Generate Docs'." });
  }
  // 12. Official originals required
  else if (officialRequired > officialAttached) {
    lifecycleState = "OFFICIAL_ORIGINALS_REQUIRED";
    primaryNextAction = "ATTACH_OFFICIAL_ORIGINALS";
    blockers.push({ code: "OFFICIAL_ORIGINALS_MISSING", message: `${officialRequired - officialAttached} tender-issued form(s) not found in Tender Intake files. Upload the complete tender package.`, action: "Upload the complete tender package containing the required forms." });
  }
  // 13. Quality gate failing
  else if (counts.qualityFailedCandidates > 0) {
    lifecycleState = "QUALITY_REVIEW_REQUIRED";
    primaryNextAction = "REPAIR_DOCUMENT_QUALITY";
    blockers.push({ code: "QUALITY_GATE_FAILED", message: `${counts.qualityFailedCandidates} document(s) failed the quality gate.`, action: "Rewrite or regenerate quality-failed documents." });
  }
  // 14. Has generated docs, needs auto-finalize
  else if (counts.finalExportCandidates > 0 && !finalExportReady) {
    lifecycleState = "AUTO_FINALIZE_REQUIRED";
    primaryNextAction = "AUTO_FINALIZE";
  }
  // 15. Export ready
  else if (finalExportReady) {
    lifecycleState = "EXPORT_READY";
    primaryNextAction = "DOWNLOAD_FINAL_ZIP";
  }
  // Default: analysis approved, beginning workflow. Per spec rule 1, Run
  // Engine is no longer the default when requirements.length === 0 — Run
  // Engine does NOT extract requirements (AI Analyze does). If we land
  // here with zero requirements, the user needs to (re-)run AI Analyze,
  // not Run Engine. If requirements exist, the user should link vault
  // evidence. This closes the "Endless Run Engine loop" bug from the
  // screenshot: Analysis Approved + final BLOCKED + primary Run Engine.
  else {
    lifecycleState = "ANALYSIS_APPROVED";
    primaryNextAction = requirements.length === 0 ? "RUN_AI_ANALYZE" : "LINK_VAULT_EVIDENCE";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derive allowed and blocked actions
  // ─────────────────────────────────────────────────────────────────────────

  const allowed: AllowedAction[] = [];
  const blocked: BlockedAction[] = [];

  // PERMANENT BLOCK: only genuine AI authorizes release actions. HUMAN_APPROVED
  // _REGEX_FALLBACK is audit-only — it MUST NEVER be treated as analysisOk.
  const analysisOk = analysisSource === "AI";
  const fallbackUnapproved = analysisSource === "REGEX_FALLBACK_AI_ERROR" || analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";
  const noFinalDocs = counts.finalExportCandidates === 0;

  // AI Analyze — always available if files exist and provider is configured
  if (files.length > 0 && providers.hasAnyProvider) {
    allowed.push("AI_ANALYZE");
  } else if (!providers.hasAnyProvider) {
    blocked.push({ action: "AI_ANALYZE", reason: "No AI provider is configured." });
  }

  // Approve fallback — available when regex fallback is unapproved
  if (fallbackUnapproved) {
    allowed.push("APPROVE_FALLBACK");
  }
  // Revoke fallback approval — available when human-approved
  if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    allowed.push("REVOKE_FALLBACK_APPROVAL");
  }

  // Metadata
  allowed.push("COMPLETE_METADATA");

  // Source references
  if (mandatoryReqs.length > 0) {
    allowed.push("REPAIR_SOURCE_REFERENCES");
  }

  // Build submission plan
  allowed.push("BUILD_SUBMISSION_PLAN");

  // Run engine
  if (analysisOk) {
    allowed.push("RUN_ENGINE");
  } else {
    blocked.push({ action: "RUN_ENGINE", reason: "No approved analysis exists. Run or approve AI analysis first." });
  }

  // Link vault evidence
  if (requirements.length > 0) {
    allowed.push("LINK_VAULT_EVIDENCE");
  }

  // Generate Docs — blocked when extraction is too weak, metadata is
  // incomplete/contaminated, or the analysis fallback is unapproved. Mirrors the
  // hard gates enforced by POST /generate so the UI affordance matches the route.
  if (fallbackUnapproved) {
    blocked.push({ action: "GENERATE_DOCS", reason: "Analysis source is unapproved regex fallback. Retry AI Analyze or approve the fallback with a note first." });
  } else if (!analysisOk) {
    blocked.push({ action: "GENERATE_DOCS", reason: "No approved analysis exists. Run AI Analyze first." });
  } else if (effectiveFiles.length > 0 && !extractionGenerationOk) {
    blocked.push({ action: "GENERATE_DOCS", reason: "Tender extraction quality is too low for reliable generation. Re-extract or run OCR first." });
  } else {
    allowed.push("GENERATE_DOCS");
  }

  // Tender-issued forms (sourced from Tender Intake files)
  if (officialRequired > 0) {
    allowed.push("ATTACH_OFFICIAL_ORIGINALS");
  }

  // Repair docs
  if (counts.qualityFailedCandidates > 0) {
    allowed.push("REPAIR_DOCS");
  }

  // Auto-finalize — blocked when extraction/metadata fail the export bar, when
  // there are no final docs, or when the analysis fallback is unapproved.
  if (effectiveFiles.length > 0 && !extractionExportOk) {
    blocked.push({ action: "AUTO_FINALIZE", reason: "Tender extraction quality is too low for final export." });
  } else if (noFinalDocs) {
    blocked.push({ action: "AUTO_FINALIZE", reason: "No active final export candidates exist. Generate and approve required documents first." });
  } else if (fallbackUnapproved) {
    blocked.push({ action: "AUTO_FINALIZE", reason: "Analysis source is unapproved regex fallback." });
  } else {
    allowed.push("AUTO_FINALIZE");
  }

  // Re-check — always
  allowed.push("RE_CHECK");

  // Reconcile outside plan
  if (counts.outsidePlanRows > 0) {
    allowed.push("RECONCILE_OUTSIDE_PLAN");
  }

  // Download ZIP — blocked when canonical readiness not passed
  if (!finalExportReady || (effectiveFiles.length > 0 && !extractionExportOk)) {
    const reasons: string[] = [];
    if (fallbackUnapproved) reasons.push("analysis source is unapproved regex fallback");
    if (noFinalDocs) reasons.push("no active final export candidates");
    if (counts.plannedMissingDocs > 0) reasons.push(`${counts.plannedMissingDocs} required document(s) not yet generated`);
    if (officialRequired > officialAttached) reasons.push(`${officialRequired - officialAttached} tender-issued form(s) not found in Tender Intake`);
    if (ungroundedMandatory.length > 0) reasons.push(`${ungroundedMandatory.length} mandatory requirement(s) missing source traceability`);
    if (!mandatoryEvidenceReady) reasons.push("mandatory requirements are not covered by confirmed FULL/SUBSTANTIAL evidence");
    if (counts.qualityFailedCandidates > 0) reasons.push(`${counts.qualityFailedCandidates} document(s) failed quality gate`);
    if (effectiveFiles.length > 0 && !extractionExportOk) reasons.push("tender extraction quality is too low for export");
    blocked.push({
      action: "DOWNLOAD_ZIP",
      reason: reasons.length > 0 ? reasons.join("; ") : "Canonical readiness has not passed.",
    });
  } else {
    allowed.push("DOWNLOAD_ZIP");
  }

  // ── Closed-tender override ─────────────────────────────────────────────────
  // A CLOSED tender (bid outcome WON/LOST/WITHDRAWN) is in a terminal state.
  // Block all mutating actions; keep RE_CHECK and DOWNLOAD_ZIP if export ready.
  if (tender.status === "CLOSED") {
    lifecycleState = "CLOSED";
    primaryNextAction = "DOWNLOAD_FINAL_ZIP";
    const closedReason = "Tender is closed (bid outcome recorded). No further workflow actions are permitted.";
    const mutatingActions: AllowedAction[] = [
      "AI_ANALYZE", "APPROVE_FALLBACK", "REVOKE_FALLBACK_APPROVAL",
      "COMPLETE_METADATA", "REPAIR_SOURCE_REFERENCES", "BUILD_SUBMISSION_PLAN",
      "RUN_ENGINE", "LINK_VAULT_EVIDENCE", "GENERATE_DOCS",
      "ATTACH_OFFICIAL_ORIGINALS", "REPAIR_DOCS", "AUTO_FINALIZE",
      "RECONCILE_OUTSIDE_PLAN",
    ];
    for (const a of mutatingActions) {
      const idx = allowed.indexOf(a);
      if (idx !== -1) allowed.splice(idx, 1);
      if (!blocked.some((b) => b.action === a)) blocked.push({ action: a, reason: closedReason });
    }
    // Keep RE_CHECK and DOWNLOAD_ZIP per existing allowed computation.
    blockers.splice(0, blockers.length); // tender is intentionally closed — no workflow blockers
  }

  // ── Final submission status ────────────────────────────────────────────────
  // Per spec rule 5 & 7: when final status is BLOCKED, the Recovery
  // Command Center must never display "all good" / release-ready language.
  // BLOCKED is returned whenever any blocker exists OR there are no final
  // export candidates. PARTIAL is reserved for the in-between case (no
  // hard blockers, but not yet ready). This keeps the fail-closed
  // behavior intact — the bar for READY is unchanged.
  const finalSubmissionStatus: TenderLifecycleResult["finalSubmissionStatus"] =
    finalExportReady
      ? "READY"
      : blockers.length > 0 || counts.finalExportCandidates === 0
        ? "BLOCKED"
        : "PARTIAL";

  // Stable diagnostic id for log correlation. Always present so the
  // Recovery Command Center can surface it when finalSubmissionStatus is
  // BLOCKED and the user needs to file a support request. The lifecycle
  // route never returns raw error.message — instead it returns this id.
  const diagnosticId = newDiagnosticId("lifecycle");

  // ── Spec rule 5 & 6 invariant: primaryNextAction must never contradict
  //    blockedActions. If final is BLOCKED, the primary next action must be
  //    a blocker-resolving action — never a generic repeated action that is
  //    itself blocked. This is a defensive check: the state machine above
  //    already ensures this, but a future code path could break the
  //    invariant. We catch it here and fall back to the first blocker's
  //    resolving action (or LINK_VAULT_EVIDENCE as a safe default).
  if (finalSubmissionStatus === "BLOCKED" && primaryNextAction) {
    const primaryActionName = primaryNextAction as string;
    // Map PrimaryNextAction to AllowedAction for the blocked lookup.
    // Most PrimaryNextAction values map 1:1 to AllowedAction names, but a
    // few differ (e.g. GENERATE_REQUIRED_DOCUMENTS → GENERATE_DOCS,
    // RETRY_AI_ANALYZE → AI_ANALYZE, RESUME_AI_ANALYZE → AI_ANALYZE).
    const allowedActionForPrimary: Record<string, AllowedAction> = {
      GENERATE_REQUIRED_DOCUMENTS: "GENERATE_DOCS",
      RETRY_AI_ANALYZE: "AI_ANALYZE",
      RESUME_AI_ANALYZE: "AI_ANALYZE",
      RUN_AI_ANALYZE: "AI_ANALYZE",
      REVIEW_MATCHING_INPUTS: "LINK_VAULT_EVIDENCE",
    };
    const blockedActionName = allowedActionForPrimary[primaryActionName] ?? primaryActionName;
    const isBlocked = blocked.some((b) => b.action === blockedActionName);
    if (isBlocked) {
      // Contradiction detected. Fall back to the first blocker's action.
      // Each blocker has a `code` that maps to a known recovery action.
      const blockerToAction: Record<string, PrimaryNextAction> = {
        NO_FILES: "UPLOAD_TENDER_DOCUMENT",
        NO_EXTRACTED_TEXT: "RUN_AI_ANALYZE",
        NO_AI_PROVIDER: "CONFIGURE_AI_PROVIDER",
        ANALYSIS_REGEX_FALLBACK_UNAPPROVED: "RETRY_AI_ANALYZE",
        ANALYSIS_FALLBACK_AUDIT_ONLY: "RETRY_AI_ANALYZE",
        ANALYSIS_PARTIAL_NEEDS_RESUME: "RESUME_AI_ANALYZE",
        EVIDENCE_NOT_ASSESSED: "RUN_ENGINE",
        ENGINE_RAN_NO_MATCHES: "REVIEW_MATCHING_INPUTS",
        MANDATORY_EVIDENCE_WEAK: "LINK_VAULT_EVIDENCE",
        DOCUMENTS_NOT_GENERATED: "GENERATE_REQUIRED_DOCUMENTS",
        OFFICIAL_ORIGINALS_MISSING: "ATTACH_OFFICIAL_ORIGINALS",
        QUALITY_GATE_FAILED: "REPAIR_DOCUMENT_QUALITY",
      };
      const firstBlocker = blockers[0];
      if (firstBlocker && blockerToAction[firstBlocker.code]) {
        primaryNextAction = blockerToAction[firstBlocker.code];
      } else {
        // Safe fallback — LINK_VAULT_EVIDENCE is allowed whenever
        // requirements exist, and is never blocked by the state machine.
        primaryNextAction = "LINK_VAULT_EVIDENCE";
      }
    }
  }

  return {
    lifecycleState: lifecycleState ?? "ANALYSIS_APPROVED",
    finalSubmissionStatus,
    // Fallback is LINK_VAULT_EVIDENCE (not RUN_ENGINE) so a future code
    // path that forgets to set primaryNextAction can never resurrect the
    // "Endless Run Engine loop" bug from the screenshot. Run Engine is
    // only appropriate when Engine has genuinely never run, which is
    // explicitly checked in step 9a above.
    primaryNextAction: primaryNextAction ?? "LINK_VAULT_EVIDENCE",
    allowedActions: allowed,
    blockedActions: blocked,
    counts,
    providerStatus: providers,
    analysisStatus: {
      source: analysisSource,
      hasText,
      score: tender.readinessScore,
      canonicalState: canonicalAnalysisState ?? undefined,
      // Forward stale/partial flags so the Recovery Command Center and other
      // panels can show "Stale — re-run required" or "PARTIAL — resume" instead
      // of a green "AI" check when the analysis is not actually current.
      stale: analysisIsStale,
      partial: analysisPartialNeedsResume,
    },
    metadataStatus: {
      completenessRatio: meta.overallRatio,
      criticalMissing: meta.missingCritical.map((f) => f.field),
      nonCriticalMissing: meta.missingNonCritical.map((f) => f.field),
    },
    sourceReferenceStatus: {
      ungroundedMandatoryCount: ungroundedMandatory.length,
      totalMandatoryCount: mandatoryReqs.length,
    },
    planStatus: {
      hasExplicitPlan: plan.hasExplicitScope,
      totalRequired: plan.totalRequired,
      totalGenerated: plan.totalGenerated,
      totalMissing: plan.totalMissing,
      totalOutsidePlan: plan.totalOutsidePlan,
      totalOfficialOriginalsRequired: plan.totalOfficialOriginalsRequired,
    },
    evidenceStatus: { ...evidenceStatus, engineHasRun },
    documentStatus: {
      total: docsSnap.length,
      generated: plan.totalGenerated,
      planned: plan.rows.filter((r) => r.status === "PLANNED").length,
      superseded: plan.totalSuperseded,
    },
    qualityStatus: {
      qualityFailed: counts.qualityFailedCandidates,
    },
    officialOriginalStatus: {
      required: officialRequired,
      attached: officialAttached,
    },
    exportStatus: {
      ready: finalExportReady,
      blockerCount: blockers.length,
      documentBlockerCount: counts.qualityFailedCandidates + counts.plannedMissingDocs,
      advisoryCount: advisoryWarnings.length,
    },
    blockers,
    warnings,
    advisoryWarnings,
    diagnosticId,
  };
}
