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
//   → ANALYSIS_APPROVED → METADATA_INCOMPLETE
//   → SOURCE_REFERENCES_INCOMPLETE → SUBMISSION_PLAN_REQUIRED
//   → SUBMISSION_PLAN_READY → EVIDENCE_MATCHING_REQUIRED
//   → EVIDENCE_MATCHED → DOCUMENT_GENERATION_REQUIRED
//   → DOCUMENTS_GENERATED → OFFICIAL_ORIGINALS_REQUIRED
//   → QUALITY_REVIEW_REQUIRED → AUTO_FINALIZE_REQUIRED
//   → EXPORT_READINESS_BLOCKED → EXPORT_READY → ZIP_READY

import type { PrismaClient } from "@prisma/client";
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
  isStrongSupportLevel,
  normalizeSupportLevel,
  type EvidenceCoverageReport,
} from "./requirement-evidence-profile";
import {
  buildProviderDiagnosticsSnapshot,
} from "../ai-provider-health";

// ─── Public types ─────────────────────────────────────────────────────────────

export type LifecycleState =
  | "UPLOADED"
  | "EXTRACTED"
  | "AI_ANALYSIS_REQUIRED"
  | "AI_ANALYSIS_FAILED"
  | "ANALYSIS_FALLBACK_UNAPPROVED"
  | "ANALYSIS_READY_FOR_REVIEW"
  | "ANALYSIS_APPROVED"
  | "METADATA_INCOMPLETE"
  | "SOURCE_REFERENCES_INCOMPLETE"
  | "SUBMISSION_PLAN_REQUIRED"
  | "SUBMISSION_PLAN_READY"
  | "EVIDENCE_MATCHING_REQUIRED"
  | "EVIDENCE_MATCHED"
  | "DOCUMENT_GENERATION_REQUIRED"
  | "DOCUMENTS_GENERATED"
  | "OFFICIAL_ORIGINALS_REQUIRED"
  | "QUALITY_REVIEW_REQUIRED"
  | "AUTO_FINALIZE_REQUIRED"
  | "EXPORT_READINESS_BLOCKED"
  | "EXPORT_READY"
  | "ZIP_READY"
  | "CLOSED";

export type PrimaryNextAction =
  | "UPLOAD_TENDER_DOCUMENT"
  | "CONFIGURE_AI_PROVIDER"
  | "RUN_AI_ANALYZE"
  | "RETRY_AI_ANALYZE"
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
  | "RECONCILE_OUTSIDE_PLAN_DOCS";

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
  evidenceStatus: EvidenceCoverageReport;
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
): Promise<TenderLifecycleResult | null> {
  // Load tender + related data in parallel
  const [tender, files, requirements, generatedDocs, complianceRows] =
    await Promise.all([
      client.tender.findUnique({
        where: { id: tenderId },
        select: {
          id: true,
          notes: true,
          status: true,
          stage: true,
          readinessScore: true,
          clientName: true,
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
        },
      }),
      client.tenderFile.findMany({
        where: { tenderId },
        select: { id: true, extractedText: true },
      }),
      client.tenderRequirement.findMany({
        where: { tenderId },
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
        where: { tenderId },
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
      client.complianceMatrix.count({ where: { tenderId } }),
    ]);

  if (!tender) return null;

  // ── Analysis source ────────────────────────────────────────────────────────
  const analysisSource = await detectAnalysisSourceWithApproval(
    client,
    tenderId,
    tender,
  );
  const hasText = files.some(
    (f) => (f.extractedText ?? "").trim().length > 100,
  );
  const hasAnalysis =
    analysisSource === "AI" ||
    analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK" ||
    analysisSource === "REGEX_FALLBACK_AI_ERROR";

  // ── Provider health ────────────────────────────────────────────────────────
  const providers = providerSummary();

  // ── Metadata completeness ──────────────────────────────────────────────────
  const metaInput: MetadataCompletenessInput = {
    title: tender.title,
    clientName: tender.clientName,
    deadline: tender.deadline,
    budget: tender.budget,
    currency: tender.currency,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    requirementCount: requirements.length,
    hasEvaluationMethodology: Boolean(tender.evaluationMethodology),
    hasSubmissionRules: Boolean(
      tender.submissionMethod || tender.submissionAddress || tender.submissionEmails,
    ),
  };
  const meta: MetadataCompletenessReport =
    assessTenderMetadataCompleteness(metaInput);

  // ── Source references ──────────────────────────────────────────────────────
  const mandatoryReqs = requirements.filter((r) => r.priority === "MANDATORY");
  const ungroundedMandatory = mandatoryReqs.filter(
    (r) =>
      !r.sectionReference &&
      !r.sourceTenderFileId &&
      !r.sourcePageNumber &&
      !r.sourceExactQuote &&
      (r.sourceConfidence ?? 0) <= 0,
  );

  // ── Evidence coverage ──────────────────────────────────────────────────────
  const evidenceStatus = computeEvidenceCoverage(
    requirements.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      priority: r.priority,
      requirementType: r.requirementType,
      complianceMatrixRows: r.complianceMatrixRows,
    })),
  );

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
  const plan = resolveSubmissionPlanCompleteness({
    tender: tenderLike,
    generatedDocuments: docsSnap,
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
  const mandatoryEvidenceReady = mandatoryReqs.every((r) =>
    (r.complianceMatrixRows ?? []).some((row) => isStrongSupportLevel(normalizeSupportLevel(row.supportLevel))),
  );
  const finalExportReady =
    (analysisSource === "AI" || analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") &&
    meta.missingCritical.length === 0 &&
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

  let lifecycleState: LifecycleState;
  let primaryNextAction: PrimaryNextAction;
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
  // 5. Analysis used regex fallback and is not human-approved
  else if (analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    lifecycleState = "ANALYSIS_FALLBACK_UNAPPROVED";
    primaryNextAction = providers.hasAnyProvider ? "RETRY_AI_ANALYZE" : "APPROVE_FALLBACK_WITH_NOTE";
    blockers.push({
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Analysis used the regex fallback (all AI providers failed). Generate Docs, Auto-finalize, and Download ZIP are blocked until AI analysis succeeds or a human explicitly approves this fallback.",
      action: providers.hasAnyProvider ? "Retry AI Analyze — providers may be available again." : "Approve fallback analysis with a note explaining why it is sufficient.",
    });
  }
  // 6. Metadata incomplete (critical fields missing)
  else if (meta.missingCritical.length > 0) {
    lifecycleState = "METADATA_INCOMPLETE";
    primaryNextAction = "COMPLETE_METADATA";
    blockers.push({
      code: "METADATA_INCOMPLETE",
      message: `${meta.missingCritical.length} critical metadata field(s) are missing: ${meta.missingCritical.slice(0, 4).map((f) => f.field).join(", ")}.`,
      action: "Try 'Re-extract Metadata' or 'Repair Metadata' to auto-fill missing fields from the tender text. If those do not help, edit the Tender Detail form and fill the missing fields manually.",
    });
  }
  // 7. Source references missing for mandatory requirements
  else if (ungroundedMandatory.length > 0 && mandatoryReqs.length > 0) {
    lifecycleState = "SOURCE_REFERENCES_INCOMPLETE";
    primaryNextAction = "REPAIR_SOURCE_REFERENCES";
    warnings.push({
      code: "SOURCE_REFERENCES_MISSING",
      message: `${ungroundedMandatory.length}/${mandatoryReqs.length} mandatory requirements lack source page/quote traceability.`,
    });
    // Not a hard blocker here — becomes one at export time
    if (requirements.length === 0) {
      lifecycleState = "AI_ANALYSIS_REQUIRED";
      primaryNextAction = "RUN_AI_ANALYZE";
    }
  }
  // 8. No submission plan rows (requirements but no plan)
  else if (requirements.length > 0 && plan.totalRequired === 0 && docsSnap.length === 0) {
    lifecycleState = "SUBMISSION_PLAN_REQUIRED";
    primaryNextAction = "BUILD_SUBMISSION_PLAN";
    warnings.push({ code: "NO_SUBMISSION_PLAN", message: "No explicit submission plan exists. Generated documents cannot be validated against tender requirements." });
  }
  // 9. Evidence matching needed
  else if (requirements.length > 0 && complianceRows === 0) {
    lifecycleState = "EVIDENCE_MATCHING_REQUIRED";
    primaryNextAction = "RUN_ENGINE";
    blockers.push({ code: "EVIDENCE_NOT_ASSESSED", message: "Requirements exist but the compliance/evidence matrix is empty.", action: "Run Engine to create requirement-evidence links." });
  }
  // 10. Outside-plan docs need reconciliation before export
  else if (counts.outsidePlanRows > 0 && counts.finalExportCandidates > 0) {
    lifecycleState = "SUBMISSION_PLAN_READY";
    primaryNextAction = "RECONCILE_OUTSIDE_PLAN_DOCS";
    warnings.push({ code: "OUTSIDE_PLAN_DOCS", message: `${counts.outsidePlanRows} document(s) are outside the submission plan and must be mapped or superseded before final export.` });
  }
  // 11. Documents need generation
  else if (counts.plannedMissingDocs > 0 || (plan.totalRequired > 0 && counts.finalExportCandidates === 0)) {
    lifecycleState = "DOCUMENT_GENERATION_REQUIRED";
    primaryNextAction = "GENERATE_REQUIRED_DOCUMENTS";
    blockers.push({ code: "DOCUMENTS_NOT_GENERATED", message: `${counts.plannedMissingDocs} required submission document(s) are planned but not generated.`, action: "Click 'Generate missing planned documents' or 'Generate Docs'." });
  }
  // 12. Official originals required
  else if (officialRequired > officialAttached) {
    lifecycleState = "OFFICIAL_ORIGINALS_REQUIRED";
    primaryNextAction = "ATTACH_OFFICIAL_ORIGINALS";
    blockers.push({ code: "OFFICIAL_ORIGINALS_MISSING", message: `${officialRequired - officialAttached} official original(s) must be attached (bid form, financial statements, certificates). Do not generate — attach the tender-issued originals.`, action: "Use 'Attach official original' for each required official document." });
  }
  // 13. Quality gate failing
  else if (counts.qualityFailedCandidates > 0) {
    lifecycleState = "QUALITY_REVIEW_REQUIRED";
    primaryNextAction = "REPAIR_DOCUMENT_QUALITY";
    blockers.push({ code: "QUALITY_GATE_FAILED", message: `${counts.qualityFailedCandidates} document(s) failed the quality gate.`, action: "Rewrite or attach official originals for quality-failed documents." });
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
  // Default: analysis approved, beginning workflow
  else {
    lifecycleState = "ANALYSIS_APPROVED";
    primaryNextAction = requirements.length === 0 ? "RUN_ENGINE" : "LINK_VAULT_EVIDENCE";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derive allowed and blocked actions
  // ─────────────────────────────────────────────────────────────────────────

  const allowed: AllowedAction[] = [];
  const blocked: BlockedAction[] = [];

  const analysisOk = analysisSource === "AI" || analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";
  const fallbackUnapproved = analysisSource === "REGEX_FALLBACK_AI_ERROR";
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

  // Generate Docs — blocked when fallback unapproved
  if (fallbackUnapproved) {
    blocked.push({ action: "GENERATE_DOCS", reason: "Analysis source is unapproved regex fallback. Retry AI Analyze or approve the fallback with a note first." });
  } else if (!analysisOk) {
    blocked.push({ action: "GENERATE_DOCS", reason: "No approved analysis exists. Run AI Analyze first." });
  } else {
    allowed.push("GENERATE_DOCS");
  }

  // Attach official originals
  if (officialRequired > 0) {
    allowed.push("ATTACH_OFFICIAL_ORIGINALS");
  }

  // Repair docs
  if (counts.qualityFailedCandidates > 0) {
    allowed.push("REPAIR_DOCS");
  }

  // Auto-finalize — blocked when no final docs or fallback unapproved
  if (noFinalDocs) {
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
  if (!finalExportReady) {
    const reasons: string[] = [];
    if (fallbackUnapproved) reasons.push("analysis source is unapproved regex fallback");
    if (noFinalDocs) reasons.push("no active final export candidates");
    if (counts.plannedMissingDocs > 0) reasons.push(`${counts.plannedMissingDocs} required document(s) not yet generated`);
    if (officialRequired > officialAttached) reasons.push(`${officialRequired - officialAttached} official original(s) not attached`);
    if (meta.missingCritical.length > 0) reasons.push(`${meta.missingCritical.length} critical metadata field(s) missing`);
    if (ungroundedMandatory.length > 0) reasons.push(`${ungroundedMandatory.length} mandatory requirement(s) missing source traceability`);
    if (!mandatoryEvidenceReady) reasons.push("mandatory requirements are not covered by confirmed FULL/SUBSTANTIAL evidence");
    if (counts.qualityFailedCandidates > 0) reasons.push(`${counts.qualityFailedCandidates} document(s) failed quality gate`);
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
  const finalSubmissionStatus: TenderLifecycleResult["finalSubmissionStatus"] =
    finalExportReady
      ? "READY"
      : blockers.length > 0 || counts.finalExportCandidates === 0
        ? "BLOCKED"
        : "PARTIAL";

  return {
    lifecycleState,
    finalSubmissionStatus,
    primaryNextAction,
    allowedActions: allowed,
    blockedActions: blocked,
    counts,
    providerStatus: providers,
    analysisStatus: {
      source: analysisSource,
      hasText,
      // Legacy DB score retained only as workflow progress context; it is not
      // used to decide finalSubmissionStatus or DOWNLOAD_ZIP availability.
      score: tender.readinessScore,
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
    evidenceStatus,
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
  };
}
