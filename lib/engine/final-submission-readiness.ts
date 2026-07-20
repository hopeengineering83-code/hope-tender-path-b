// Canonical final-submission readiness helper.
//
// Single source of truth used by:
//   - app/api/tenders/[id]/export-readiness/route.ts
//   - app/api/tenders/[id]/download/route.ts (final ZIP gate)
//   - lib/engine/tender-release-state.ts (canonical Tender Release State)
//   - components/final-submission-control-center.tsx (via the API)
//   - components/export-readiness-panel.tsx (via the API)
//   - app/api/admin/generated-proposals/audit/route.ts
//
// Why this lives here:
//   Prior to this helper, every consumer rebuilt its own "is this tender
//   ready?" logic from raw fields. That caused inconsistent counts across
//   Bid Control, Export Gate, Final Submission Control Center, and the
//   ZIP download route — the same tender could read "BID READY" in one
//   place and "0 of 3 documents ready" in another. This module pulls
//   the actual user-scoped tender, runs the existing
//   checkFullExportReadiness pipeline, and returns ONE shape with:
//     - documentBlockers  (per-doc reasons + suggested next actions)
//     - tenderLevelBlockers (hard tender-level rules — e.g. ungenerated
//                             planned docs, missing client name, package
//                             mode mismatch, evaluator HIGH objections)
//     - advisoryWarnings  (donor safeguards that the ToR did NOT
//                          explicitly mandate, mark-as-resolved by user)
//     - summary           (counts + envelope breakdown + planStatus)
//     - planStatus enum   (one of the plan-vs-docs states)
//
// Acceptance: any change to readiness logic must go through this helper.
// Consumers must NEVER inline blockers/advisory checks that conflict.

import type { PrismaClient } from "@prisma/client";
import {
  checkFullExportReadiness,
  type ExportReadinessFailure,
  type ExportReadinessResult,
  type ExportReadyDocument,
} from "./export-readiness";
import {
  filterFinalExportCandidateDocuments,
  type DocumentLike,
} from "./document-output-state";
import {
  findExtraGeneratedDocuments,
  findMissingGeneratedDocuments,
  inferEnvelope,
  submissionPlanFileCount,
  type SubmissionEnvelope,
} from "./submission-plan";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "./build-plan";
import { detectSubmissionPackageMode } from "./submission-package-mode";
import { assessGeneratedDocumentQuality } from "./document-quality-gate";
import { assessTenderMetadataCompleteness } from "./tender-metadata-completeness";
import { resolveCanonicalFieldState } from "./canonical-field-state";
import { getTenderFactLedgerSnapshot } from "./tender-facts-ledger-service";
import { detectAnalysisSourceWithApproval, type AnalysisSource } from "./analysis-source";
import { computeReadinessScore } from "./readiness-scoring";
import { isStrongSupportLevel, normalizeSupportLevel } from "./requirement-evidence-profile";
import { isExtractionAcceptableForExport } from "./extraction-quality-gate";
import { extractDocxVisibleText } from "./export-readiness";

export type FinalReadinessSeverity = "HIGH" | "MEDIUM" | "LOW";

export type FinalReadinessDocumentBlocker = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
  severity: FinalReadinessSeverity;
  nextActions: string[];
};

export type FinalReadinessTenderBlocker = {
  category: string;
  severity: string;
  title: string;
  recommendedAction?: string | null;
};

export type FinalReadinessAdvisoryWarning = FinalReadinessTenderBlocker & {
  code: string;
  resolved?: boolean;
  resolutionNote?: string | null;
};

export type FinalReadinessPlanStatus =
  | "NO_PLAN_NO_DOCS"
  | "NO_PLAN_WITH_ACTIVE_DOCS"
  | "PLAN_MATCHED"
  | "PLAN_MISSING_DOCS"
  | "PLAN_EXTRA_DOCS"
  | "DERIVED_PLAN_UNCONFIRMED"
  | "PLAN_ORDER_MISMATCH"
  | "PLAN_NAME_MISMATCH";

export type FinalReadinessSummary = {
  totalBlockers: number;
  documentBlockers: number;
  tenderLevelBlockers: number;
  advisoryWarnings: number;
  finalExportCandidates: number;
  workspaceDocuments: number;
  excludedInternalRows: number;
  missingContentCount: number;
  invalidSignatureCount: number;
  hygieneIssueCount: number;
  officialOriginalBlockers: number;
  envelopeBreakdown: Record<SubmissionEnvelope, number>;
  strictTwoEnvelope: boolean;
  packageMode: string;
  planStatus: FinalReadinessPlanStatus;
  // ── PR audit extensions: gate dimensions surfaced for the dashboard
  // and the admin audit endpoint so every consumer can see the same
  // counts (no panel-mismatch regression possible).
  /** Documents we cannot vouch for at senior-tender quality. */
  qualityFailedDocuments: number;
  /** Count of required submission-plan items not satisfied by current outputs. */
  missingRequiredDocuments: number;
  /** Generated docs that live outside the explicit submission plan. */
  outsidePlanDocuments: number;
  /** Historical/SUPERSEDED rows hidden from the package logic but visible in audit. */
  staleRowCount: number;
  /** Source of the latest tender analysis (AI / regex fallback / human-approved). */
  analysisSource: "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN";
  /** Critical metadata fields missing on the tender (e.g. submissionMethod). */
  missingCriticalMetadataCount: number;
  /** Tender metadata fields containing "Bid-Team to confirm" / TBC / etc. */
  metadataPlaceholderCount: number;
  /** 0..1 — auto-fill coverage across critical + non-critical metadata fields. */
  metadataCompletenessRatio: number;
  /** Weighted readiness score 0..100 with hard caps applied. */
  readinessScore: number;
  /** Human-readable reason for the binding cap (if any), else null. */
  readinessCapReason: string | null;
  /** The scoring dimension that applied the binding cap (e.g. "analysisSource", "evidence"), or null. */
  readinessCapDimension: string | null;
  /** The cap score value (0–100) applied by the binding cap, or null. */
  readinessCapScore: number | null;
  /** Count of required plan items that are in PLANNED status (not yet generated). */
  ungeneratedPlannedRequired: number;
  /** List of exact missing critical metadata field names. */
  missingCriticalMetadataFields: string[];
  /** Total required documents — includes confirmed-plan items AND ungenerated PLANNED docs. */
  requiredDocumentsTotal: number;
  /** Documents that are export-ready (GENERATED + validated + approved, not SUPERSEDED/PLANNED). */
  exportReadyDocumentsTotal: number;
  /** The single most important blocker reason (human-readable), or null if no blockers. */
  primaryBlockerReason: string | null;
  /** The recommended fix action for the primary blocker, or null. */
  primaryFixAction: string | null;
};

export type FinalSubmissionReadiness = {
  ok: boolean;
  tender: { id: string; title: string; status: string; stage: string; readinessScore: number };
  documentBlockers: FinalReadinessDocumentBlocker[];
  tenderLevelBlockers: FinalReadinessTenderBlocker[];
  advisoryWarnings: FinalReadinessAdvisoryWarning[];
  summary: FinalReadinessSummary;
  message: string;
  /** Per-field canonical state from resolveCanonicalFieldState (same inputs, no divergent call). */
  canonicalFields?: import("./canonical-field-state").CanonicalFieldState[];
};

export type GetFinalSubmissionReadinessOptions = {
  tenderId: string;
  userId: string;
  requireFileContent?: boolean;
};

// ── helpers ────────────────────────────────────────────────────────────────

function nextActionForReason(reason: string): string {
  if (/ORIGINAL_REQUIRED|REPLACE_WITH_ORIGINAL|tender-issued original/i.test(reason)) {
    return "Attach or upload the exact tender-issued original form/template for this file. Do not use Repair safe document gaps for official-original rows.";
  }
  if (/NOT_EXPORTABLE/i.test(reason)) {
    return "Manual review required: this row is marked NOT_EXPORTABLE and must not be included in the final package unless replaced by the official source file.";
  }
  if (/PLANNED|CONTROL_RECORD_ONLY|control, placeholder, or text-only/i.test(reason)) {
    return "Generate the actual final file or attach the official original. Planned/control rows are not exportable files.";
  }
  if (/PDF_CONVERSION_REQUIRED|not a real PDF/i.test(reason)) {
    return "Upload the final PDF required by the tender or provide a real PDF file before export.";
  }
  if (/NO_ACTIVE_GENERATED_DOCUMENTS/i.test(reason)) return "Generate the required documents before exporting.";
  if (/generationStatus/i.test(reason)) return "Regenerate this document or reconcile the submission plan.";
  if (/validationStatus/i.test(reason)) return "Run validation and fix reported document validation issues.";
  if (/reviewStatus/i.test(reason)) return "Complete human review and mark the document READY_FOR_EXPORT.";
  if (/fileContent|MISSING_CONTENT/i.test(reason)) return "Regenerate or upload the missing DOCX/PDF file content.";
  if (/MARKDOWN|QUICK_DRAFT|DRAFT_ONLY|CONTROL|not a final export/i.test(reason)) {
    return "Use Generate Docs or attach the tender-issued original; quick drafts, placeholders and control rows cannot be exported.";
  }
  return "Review and resolve this blocker before final export.";
}

function mandatoryEvidenceCoverageRatio(requirements: Array<{
  priority?: string | null;
  complianceMatrixRows?: Array<{ supportLevel?: string | null }> | null;
}>): number {
  const mandatory = requirements.filter((r) => r.priority === "MANDATORY");
  if (mandatory.length === 0) return 0;
  const confirmedCovered = mandatory.filter((r) =>
    (r.complianceMatrixRows ?? []).some((row) => isStrongSupportLevel(normalizeSupportLevel(row.supportLevel))),
  ).length;
  return confirmedCovered / mandatory.length;
}

function severityForReasons(reasons: string[]): FinalReadinessSeverity {
  if (reasons.some((r) =>
    /NO_ACTIVE_GENERATED_DOCUMENTS|fileContent|generationStatus|CONTROL|ORIGINAL_REQUIRED|PDF_CONVERSION_REQUIRED|NOT_EXPORTABLE|REPLACE_WITH_ORIGINAL|PLANNED|MISSING_CONTENT/i.test(r),
  )) return "HIGH";
  if (reasons.some((r) => /validationStatus|reviewStatus|MARKDOWN|QUICK_DRAFT|DRAFT_ONLY/i.test(r))) return "MEDIUM";
  return "LOW";
}

function asReadyDoc(doc: {
  id: string;
  name: string;
  exactFileName: string | null;
  exactOrder: number | null;
  documentType: string | null;
  format: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent?: string | null;
  storagePath: string | null;
  hasInlineFileContent?: boolean | null;
}): ExportReadyDocument {
  return {
    id: doc.id,
    name: doc.name,
    exactFileName: doc.exactFileName ?? null,
    exactOrder: doc.exactOrder ?? null,
    documentType: doc.documentType ?? null,
    format: doc.format ?? null,
    generationStatus: String(doc.generationStatus ?? ""),
    validationStatus: String(doc.validationStatus ?? ""),
    reviewStatus: String(doc.reviewStatus ?? ""),
    fileContent: doc.fileContent ?? null,
    storagePath: doc.storagePath ?? null,
    hasInlineFileContent: doc.hasInlineFileContent ?? null,
  };
}

function derivePlanStatus(opts: {
  requiredPlanCount: number;
  finalCandidateCount: number;
  missingCount: number;
  extraCount: number;
  nameMismatch: boolean;
  orderMismatch: boolean;
  hasExplicitScope?: boolean;
}): FinalReadinessPlanStatus {
  const { requiredPlanCount, finalCandidateCount, missingCount, extraCount, nameMismatch, orderMismatch } = opts;
  if (requiredPlanCount === 0 && finalCandidateCount === 0) return "NO_PLAN_NO_DOCS";
  if (requiredPlanCount === 0 && finalCandidateCount > 0) return "NO_PLAN_WITH_ACTIVE_DOCS";
  if (missingCount > 0) return "PLAN_MISSING_DOCS";
  if (extraCount > 0) return "PLAN_EXTRA_DOCS";
  if (nameMismatch) return "PLAN_NAME_MISMATCH";
  if (orderMismatch) return "PLAN_ORDER_MISMATCH";
  if (requiredPlanCount > 0 && opts.hasExplicitScope === false) return "DERIVED_PLAN_UNCONFIRMED";
  return "PLAN_MATCHED";
}

function detectMessageType(failures: ExportReadinessFailure[]): {
  missingContent: number;
  invalidSignature: number;
  hygiene: number;
  originalRequired: number;
} {
  let missingContent = 0;
  let invalidSignature = 0;
  let hygiene = 0;
  let originalRequired = 0;
  for (const f of failures) {
    if (f.reasons.some((r) => /fileContent is missing|MISSING_CONTENT|DOCUMENTS_MISSING_CONTENT|no file content|Unable to inspect storage-backed/i.test(r))) missingContent += 1;
    if (f.reasons.some((r) => /signature mismatch|not a real PDF|signature/i.test(r))) invalidSignature += 1;
    if (f.reasons.some((r) => /AI\/meta-preparation|Placeholder|pricing language|hygiene/i.test(r))) hygiene += 1;
    if (f.reasons.some((r) => /ORIGINAL_REQUIRED|REPLACE_WITH_ORIGINAL|NOT_EXPORTABLE|tender-issued original/i.test(r))) originalRequired += 1;
  }
  return { missingContent, invalidSignature, hygiene, originalRequired };
}

function buildMessage(input: { ok: boolean; documentBlockers: FinalReadinessDocumentBlocker[]; tenderLevelBlockers: FinalReadinessTenderBlocker[]; advisoryWarnings: FinalReadinessAdvisoryWarning[] }): string {
  if (input.ok) return "Export gate passed. All final-package documents and tender-level controls are ready.";
  const parts: string[] = [];
  if (input.documentBlockers.length > 0) {
    parts.push(
      input.documentBlockers.length === 1
        ? "1 document is not ready for export."
        : `${input.documentBlockers.length} documents are not ready for export.`,
    );
  }
  if (input.tenderLevelBlockers.length > 0) {
    parts.push(`${input.tenderLevelBlockers.length} tender-level blocker(s) remain.`);
  }
  if (input.advisoryWarnings.length > 0) {
    parts.push(`${input.advisoryWarnings.length} advisory warning(s) (do not block export, but should be reviewed).`);
  }
  return parts.length > 0 ? parts.join(" ") : "Export gate blocked.";
}

// ── donor advisory persistence using ComplianceGap (existing model) ───────
//
// We re-use the ComplianceGap table to persist user resolutions for donor
// safeguard advisories without adding a new Prisma model (which would need
// a migration on Vercel). The convention:
//   - title  = `ADVISORY:${code}` (e.g., "ADVISORY:DONOR_ESMP_MISSING")
//   - severity = "ADVISORY"
//   - isResolved = true once user marks the advisory resolved
//   - resolvedNote = one of:
//        "NOT_REQUIRED_BY_TOR"
//        "POST_AWARD_DELIVERABLE"
//        "DONOR_TEMPLATE_PROVIDED"
//        "ADDED_TO_TECHNICAL"
//        plus optional free-text appended after " | "
//
// applyAdvisoryResolutions() removes resolved advisories from the
// readiness response so re-checks honour the user's prior decision.

export const ADVISORY_GAP_PREFIX = "ADVISORY:";

export type AdvisoryResolutionKind =
  | "NOT_REQUIRED_BY_TOR"
  | "POST_AWARD_DELIVERABLE"
  | "DONOR_TEMPLATE_PROVIDED"
  | "ADDED_TO_TECHNICAL"
  | "REOPEN";

export function isAdvisoryCode(value: string): boolean {
  return value.startsWith(ADVISORY_GAP_PREFIX);
}

export function buildAdvisoryGapTitle(code: string): string {
  return `${ADVISORY_GAP_PREFIX}${code}`;
}

export function parseAdvisoryGapTitle(title: string): string | null {
  if (!title.startsWith(ADVISORY_GAP_PREFIX)) return null;
  return title.slice(ADVISORY_GAP_PREFIX.length);
}

async function loadAdvisoryResolutions(client: PrismaClient, tenderId: string): Promise<Map<string, { resolved: boolean; note: string | null }>> {
  const rows = await client.complianceGap.findMany({
    where: { tenderId, severity: "ADVISORY", title: { startsWith: ADVISORY_GAP_PREFIX } },
    select: { title: true, isResolved: true, resolvedNote: true },
  });
  const out = new Map<string, { resolved: boolean; note: string | null }>();
  for (const row of rows) {
    const code = parseAdvisoryGapTitle(row.title);
    if (!code) continue;
    out.set(code, { resolved: row.isResolved, note: row.resolvedNote ?? null });
  }
  return out;
}

function applyAdvisoryResolutions(
  advisoryWarnings: ExportReadinessResult["advisoryWarnings"] = [],
  resolutions: Map<string, { resolved: boolean; note: string | null }>,
): FinalReadinessAdvisoryWarning[] {
  const out: FinalReadinessAdvisoryWarning[] = [];
  for (const advisory of advisoryWarnings) {
    const code = advisory.category;
    const resolution = resolutions.get(code);
    if (resolution?.resolved) continue; // honour the user's prior decision; do not re-surface
    out.push({
      ...advisory,
      code,
      resolved: false,
      resolutionNote: resolution?.note ?? null,
    });
  }
  return out;
}

// ── canonical helper ──────────────────────────────────────────────────────

export async function getFinalSubmissionReadiness(
  client: PrismaClient,
  opts: GetFinalSubmissionReadinessOptions,
): Promise<FinalSubmissionReadiness | null> {
  const shouldLoadFileContent = opts.requireFileContent ?? false;
  const tender = await client.tender.findFirst({
    where: { id: opts.tenderId, userId: opts.userId },
    select: {
      id: true,
      title: true,
      status: true,
      stage: true,
      readinessScore: true,
      exactFileNaming: true,
      exactFileOrder: true,
      pageLimit: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      analysisSummary: true,
      evaluationMethodology: true,
      notes: true,
      // Metadata-completeness signals consumed by the gate (Part 5).
      clientName: true,
      procuringEntityName: true,
      legalClientName: true,
      donorAgency: true,
      implementingAgency: true,
      clientAddress: true,
      category: true,
      reference: true,
      country: true,
      deadline: true,
      clientContactName: true,
      clientContactEmail: true,
      clientContactPhone: true,
      // clientContactTitle is required by the canonical resolver's extended
      // field iteration (fieldKeys includes "clientContactTitle"). Without it
      // in the SELECT, the resolver sees undefined → spurious INVALID row.
      clientContactTitle: true,
      // Contamination flag — set by AI Analyze when client name is polluted
      metadataContaminated: true,
      // Per-field source-evidence columns + manual overrides — consumed by the
      // canonical field-state resolver so the export/ZIP gate enforces EXACTLY
      // the same field decisions as the generate gate (single source of truth).
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
      // Reference source evidence — dedicated columns read first by the
      // canonical resolver's getSourceEvidence for fieldKey="reference".
      // Without these, the export/ZIP gate's reference grounding diverges
      // from the strict BuildPlan validator (which reads these columns).
      referenceSourcePage: true,
      referenceSourceQuote: true,
      referenceSourceFileId: true,
      contactDetailsSourceJson: true,
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true, reason: true, overriddenBy: true, createdAt: true, confirmationBasis: true, authorityClass: true, confirmedAt: true },
      },
      budget: true,
      currency: true,
      validityDays: true,
      bidBondAmount: true,
      bidBondCurrency: true,
      mandatorySiteVisit: true,
      numberOfCopiesRequired: true,
      preBidMeetingDate: true,
      preBidMeetingLocation: true,
      technicalWeight: true,
      financialWeight: true,
      clientCity: true,
      clientWebsite: true,
      submissionEmailSubject: true,
      preBidChannel: true,
      clientRepresentative: true,
      evaluationCriteriaSourceJson: true,
      // Unresolved CRITICAL compliance gaps must hard-block final export —
      // the actual ZIP download route (app/api/tenders/[id]/download/route.ts)
      // already 409s on any unresolved CRITICAL gap regardless of category.
      // Without this in the readiness computation, the "Ready for export"
      // signal shown on Bid Control / Export Hub / Command Center could read
      // Ready while the real download link still hard-blocks — surfacing the
      // gap here keeps the badge and the gate in agreement.
      complianceGaps: {
        where: { isResolved: false, severity: "CRITICAL" },
        select: { id: true, title: true },
      },
      requirements: {
        select: {
          id: true,
          title: true,
          description: true,
          requirementType: true,
          priority: true,
          exactFileName: true,
          exactOrder: true,
          requiredQuantity: true,
          pageLimit: true,
          restrictions: true,
          sectionReference: true,
          sourceConfidence: true,
          sourceTenderFileId: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          complianceMatrixRows: {
            select: { id: true, supportLevel: true },
          },
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
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
          // Inline document bytes are large. Readiness-style callers pass
          // requireFileContent=false and should rely on storagePath/status
          // metadata instead of loading the full blob from Neon.
          fileContent: shouldLoadFileContent,
          storagePath: true,
        },
      },
      // Extraction quality status — consumed by checkTenderLevelExportBlockers to
      // emit the ANALYSIS_FROM_PARTIAL_EXTRACTION blocker when AI analysis ran on
      // partial extraction. Without this field the blocker silently never fires.
      analysisExtractionStatus: true,
      // Extraction metrics — needed by isExtractionAcceptableForExport in the
      // export readiness gate so the panel shows the blocker before export.
      files: {
        select: {
          id: true,
          deletionStatus: true,
          extractionScore: true,
          totalPages: true,
          extractedPages: true,
          ocrPages: true,
          failedPages: true,
          // Required for the full grounding check (quote containment) in the
          // canonical field-state resolver — same rule the generation gate
          // and release snapshot apply.
          extractedText: true,
        },
      },
    },
  });
  if (!tender) return null;
  // Stale/superseded rows are surfaced separately from the package logic
  // — the dashboard screenshot showed 152 hidden historical outputs that
  // should be auditable but excluded from blocker counts.
  const staleRowCount = await client.generatedDocument.count({ where: { tenderId: opts.tenderId, generationStatus: "SUPERSEDED" } });
  const generatedDocumentIds = tender.generatedDocuments.map((doc) => doc.id);
  const generatedContentMetrics = generatedDocumentIds.length > 0
    ? await client.$queryRaw<Array<{ id: string; fileContentLength: number }>>`
        SELECT id, ("fileContent" IS NOT NULL)::int AS "fileContentLength"
        FROM "GeneratedDocument"
        WHERE id = ANY(${generatedDocumentIds}::text[])
      `.catch(() => [] as Array<{ id: string; fileContentLength: number }>)
    : [];
  const generatedContentMetricById = new Map(generatedContentMetrics.map((doc) => [doc.id, doc.fileContentLength]));
  const generatedDocuments = tender.generatedDocuments.map((doc) => ({
    ...doc,
    hasInlineFileContent: Boolean((doc.fileContent ?? "").trim()) || (generatedContentMetricById.get(doc.id) ?? 0) > 0,
  }));

  const workspaceDocuments = generatedDocuments.length;
  const finalCandidates = filterFinalExportCandidateDocuments(generatedDocuments);
  const dedupedDocs = (() => {
    const seen = new Set<string>();
    const sorted = finalCandidates.slice().sort((a, b) => (a.exactOrder ?? 9999) - (b.exactOrder ?? 9999));
    return sorted.filter((doc) => {
      const key = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const readyDocs = dedupedDocs.map(asReadyDoc);

  const readiness = await checkFullExportReadiness({
    tenderId: opts.tenderId,
    docs: readyDocs,
    requireFileContent: opts.requireFileContent ?? false,
  });

  const documentBlockers: FinalReadinessDocumentBlocker[] = readiness.failures.map((failure) => ({
    documentId: failure.documentId,
    name: failure.name,
    fileName: failure.fileName,
    reasons: failure.reasons,
    severity: severityForReasons(failure.reasons),
    nextActions: Array.from(new Set(failure.reasons.map(nextActionForReason))),
  }));

  // Donor advisory persistence: honour user-saved resolutions so re-check
  // does not re-surface advisories the user already triaged.
  const resolutions = await loadAdvisoryResolutions(client, opts.tenderId);
  const advisoryWarnings = applyAdvisoryResolutions(readiness.advisoryWarnings, resolutions);
  const tenderLevelBlockers: FinalReadinessTenderBlocker[] = (readiness.tenderLevelBlockers ?? []).map((b) => ({
    category: b.category,
    severity: b.severity,
    title: b.title,
    recommendedAction: b.recommendedAction,
  }));

  const mandatoryRequirements = tender.requirements.filter((r) => r.priority === "MANDATORY");

  // Plan reconciliation — AUTHORITATIVE: only the current CONFIRMED BuildPlan
  // defines the export file plan. A derived draft must never stand in for a
  // confirmed plan on the final-export path (fail closed).
  const confirmedPlan = await getCurrentConfirmedBuildPlan(client, opts.tenderId, opts.userId);
  const planItems: BuildPlanItem[] = confirmedPlan.ok ? confirmedPlan.items : [];
  const plan = { files: planItems, warnings: confirmedPlan.ok ? [] : [confirmedPlan.blocker] } as any;
  const requiredPlanCount = submissionPlanFileCount(plan);
  // A confirmed Build Plan IS the explicit submission scope. Without one there
  // is no trusted scope at all, so the no-plan blockers below fire.
  const hasExplicitPlanScope = confirmedPlan.ok;
  const missingPlan = findMissingGeneratedDocuments(plan, finalCandidates);
  const extraPlan = findExtraGeneratedDocuments(plan, finalCandidates);
  const planNames = new Set(planItems.map((f) => f.exactFileName.toLowerCase().trim()));
  const actualNames = finalCandidates.map((d) => (d.exactFileName ?? d.name ?? "").toLowerCase().trim()).filter(Boolean);
  const nameMismatch = requiredPlanCount > 0 && actualNames.some((n) => !planNames.has(n));
  const orderMismatch = false; // currently surfaced via filePlanBlockersFromLists in tenderLevelBlockers

  const detail = detectMessageType(readiness.failures);

  // Envelope breakdown — used by the strict two-envelope guard and surfaced
  // to UI/audit consumers.
  const envelopeBreakdown: Record<SubmissionEnvelope, number> = { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 };
  for (const doc of finalCandidates) {
    const env = inferEnvelope(doc.documentType ?? "TECHNICAL", doc.exactFileName ?? doc.name ?? "");
    envelopeBreakdown[env] = (envelopeBreakdown[env] ?? 0) + 1;
  }

  const packageMode = detectSubmissionPackageMode({
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    notes: tender.notes,
    requirements: tender.requirements,
    files: [],
  });
  const strictTwoEnvelope = packageMode.mode === "SEPARATE_TECHNICAL_FINANCIAL";

  // ── Document quality gate (Part 8/9) ─────────────────────────────────────
  // Run the rules-based quality gate over every final-export candidate.
  // Documents below threshold drive both the readiness-scoring cap and
  // a tender-level blocker so the screenshot regression (PASSED docs
  // with shallow content) cannot recur silently.
  //
  // Per spec rule 6: validation must not approve empty content, placeholder
  // content, AI traces, or pricing leakage. We extract the visible text
  // from base64 DOCX content before passing it to the quality scorer —
  // otherwise the scorer would run against base64 gibberish and never
  // match placeholder/AI-trace patterns, silently skipping the quality gate
  // for all generated DOCX files.
  const qualityReports: Array<{ doc: any; report: ReturnType<typeof assessGeneratedDocumentQuality> }> = [];
  for (const doc of finalCandidates) {
    let visible: string | null = null;
    if (typeof doc.fileContent === "string" && doc.fileContent.length < 2_000_000) {
      const fileName = doc.exactFileName ?? doc.name ?? "";
      if (fileName.toLowerCase().endsWith(".docx")) {
        // Extract visible text from base64 DOCX for accurate quality scoring.
        visible = await extractDocxVisibleText(doc.fileContent, fileName);
      }
      // For non-DOCX files (PDF, etc.), visible stays null — the quality
      // scorer will skip visible-text checks but the file-signature check
      // and output-state machine still enforce format correctness.
      if (!visible && !fileName.toLowerCase().endsWith(".docx")) {
        // Plain-text content (legacy or markdown) — use as-is.
        visible = doc.fileContent;
      }
    }
    qualityReports.push({
      doc,
      report: assessGeneratedDocumentQuality({
        doc,
        visibleText: visible,
        rawFileContent: doc.fileContent,
        hasStoragePath: Boolean(doc.storagePath && doc.storagePath.length > 0),
        requirements: tender.requirements,
      }),
    });
  }
  const qualityFailed = qualityReports.filter(({ report }) => report.recommendedStatus === "QUALITY_FAILED").length;

  // ── Metadata completeness gate (Part 5) ──────────────────────────────────
  const metadata = assessTenderMetadataCompleteness({
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    title: tender.title,
    reference: tender.reference,
    country: tender.country,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    metadataContaminated: tender.metadataContaminated,
    deadline: tender.deadline ?? null,
    clientContactName: tender.clientContactName,
    clientContactEmail: tender.clientContactEmail,
    clientContactPhone: tender.clientContactPhone,
    pageLimit: tender.pageLimit,
    budget: tender.budget,
    currency: tender.currency,
    validityDays: tender.validityDays,
    bidBondAmount: tender.bidBondAmount,
    bidBondCurrency: tender.bidBondCurrency,
    mandatorySiteVisit: tender.mandatorySiteVisit,
    numberOfCopiesRequired: tender.numberOfCopiesRequired,
    preBidMeetingDate: tender.preBidMeetingDate ?? null,
    preBidMeetingLocation: tender.preBidMeetingLocation,
    technicalWeight: tender.technicalWeight,
    financialWeight: tender.financialWeight,
    clientCity: tender.clientCity,
    clientAddress: tender.clientAddress,
    clientWebsite: tender.clientWebsite,
    submissionEmailSubject: tender.submissionEmailSubject,
    preBidChannel: tender.preBidChannel,
    clientRepresentative: tender.clientRepresentative,
    legalClientName: tender.legalClientName,
    donorAgency: tender.donorAgency,
    implementingAgency: tender.implementingAgency,
    requirementCount: tender.requirements.length,
    hasEvaluationMethodology: Boolean((tender.evaluationMethodology ?? "").trim()),
    hasSubmissionRules: Boolean((tender.submissionMethod ?? "").trim()) || Boolean((tender.submissionEmails ?? "").trim()) || Boolean((tender.submissionAddress ?? "").trim()),
  });

  // ── Analysis-source detection (Part 4) ───────────────────────────────────
  const analysisSource: AnalysisSource = await detectAnalysisSourceWithApproval(client, opts.tenderId, tender);

  // ── Source-reference coverage (used by the readiness score). ────────────
  const sourceReferenceCoverage = tender.requirements.length === 0
    ? 0
    : tender.requirements.filter((r) => (r.sourceConfidence ?? 0) > 0 || (r.sectionReference ?? "").trim().length > 0).length / tender.requirements.length;

  // ── Tender-level blockers (computed before readiness score so the gate
  //    flag is accurate). ─────────────────────────────────────────────────────
  if (metadata.blockingForGeneration) {
    tenderLevelBlockers.push({
      category: "TENDER_FACTS_INVALID",
      severity: "HIGH",
      title: `Required Tender Details are incomplete (${metadata.missingCritical.length} critical field(s) missing${metadata.placeholderCount > 0 ? `, ${metadata.placeholderCount} "Bid-Team to confirm" placeholder(s)` : ""}).`,
      recommendedAction: "Fill the missing critical Tender Details — client/procuring entity, deadline, submission method — before final proposal generation.",
    });
  }
  // Unresolved CRITICAL compliance gaps hard-block final export at the
  // actual download route regardless of category — mirror that here so
  // this readiness signal cannot show Ready while the download link
  // still 409s.
  if (tender.complianceGaps.length > 0) {
    tenderLevelBlockers.push({
      category: "CRITICAL_COMPLIANCE_GAPS",
      severity: "CRITICAL",
      title: `${tender.complianceGaps.length} unresolved CRITICAL compliance gap(s): ${tender.complianceGaps.map((g) => g.title).join("; ")}`,
      recommendedAction: "Resolve every CRITICAL compliance gap before final export.",
    });
  }
  // ── Canonical field-state gate (single source of truth) ───────────────────
  // Route the export/ZIP decision through the SAME resolver the generate gate
  // uses, so a field that is critical-and-blocking for generation is also
  // blocking for export (and vice versa). This closes the prior gap where the
  // export gate ran a separate metadata-criticality path and ignored manual
  // overrides + per-field source evidence entirely.
  //
  // ── TenderFactsLedger authority ──────────────────────────────────────────
  // Fetch the ledger snapshot so the resolver prefers ledger facts over
  // stale scalar columns. The ledger is the durable authority; scalar columns
  // are fallback only when no ledger fact exists.
  let ledgerSnapshot: Awaited<ReturnType<typeof getTenderFactLedgerSnapshot>> | null = null;
  try {
    ledgerSnapshot = await getTenderFactLedgerSnapshot(client, opts.tenderId);
  } catch {
    // Ledger table may not exist yet (pre-migration) — fall back to scalar-only
    ledgerSnapshot = null;
  }

  const canonicalExportState = resolveCanonicalFieldState({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      procuringEntityName: tender.procuringEntityName,
      deadline: tender.deadline ?? null,
      currency: tender.currency,
      country: tender.country,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: tender.submissionEmailSubject,
      clientContactName: tender.clientContactName,
      clientContactEmail: tender.clientContactEmail,
      metadataContaminated: tender.metadataContaminated === true,
      clientNameSourcePage: tender.clientNameSourcePage ?? null,
      clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
      submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
      submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
      submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
      submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
      submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
      submissionEmailSourceQuote: (tender as any).submissionEmailSourceQuote ?? null,
      titleSourcePage: (tender as any).titleSourcePage ?? null,
      titleSourceQuote: (tender as any).titleSourceQuote ?? null,
      titleSourceFileId: (tender as any).titleSourceFileId ?? null,
      deadlineSourcePage: (tender as any).deadlineSourcePage ?? null,
      deadlineSourceQuote: (tender as any).deadlineSourceQuote ?? null,
      deadlineSourceFileId: (tender as any).deadlineSourceFileId ?? null,
      // Forward reference source-evidence columns to the resolver so the
      // dedicated-column path in getSourceEvidence is taken. Without this,
      // the export/ZIP gate's reference grounding depends solely on the
      // contactDetailsSourceJson fallback and diverges from the strict
      // BuildPlan validator's view (which reads the dedicated columns).
      referenceSourcePage: (tender as any).referenceSourcePage ?? null,
      referenceSourceQuote: (tender as any).referenceSourceQuote ?? null,
      referenceSourceFileId: (tender as any).referenceSourceFileId ?? null,
      clientNameSourceFileId: (tender as any).clientNameSourceFileId ?? null,
      submissionMethodSourceFileId: (tender as any).submissionMethodSourceFileId ?? null,
      submissionAddressSourceFileId: (tender as any).submissionAddressSourceFileId ?? null,
      submissionEmailSourceFileId: (tender as any).submissionEmailSourceFileId ?? null,
      contactDetailsSourceJson: tender.contactDetailsSourceJson ?? null,
      // Extended panel fields — the resolver iterates these as fieldKeys.
      // Forwarding them prevents spurious INVALID rows in the export gate's
      // canonical state and keeps the export gate's view consistent with the
      // release snapshot and the dashboard route.
      evaluationMethodology: tender.evaluationMethodology ?? null,
      legalClientName: tender.legalClientName ?? null,
      donorAgency: tender.donorAgency ?? null,
      implementingAgency: tender.implementingAgency ?? null,
      clientContactTitle: tender.clientContactTitle ?? null,
      clientContactPhone: tender.clientContactPhone ?? null,
      clientCity: tender.clientCity ?? null,
      clientAddress: tender.clientAddress ?? null,
      clientWebsite: tender.clientWebsite ?? null,
      clientRepresentative: tender.clientRepresentative ?? null,
      preBidChannel: tender.preBidChannel ?? null,
      preBidMeetingDate: tender.preBidMeetingDate instanceof Date ? tender.preBidMeetingDate.toISOString() : (tender.preBidMeetingDate ?? null),
      preBidMeetingLocation: tender.preBidMeetingLocation ?? null,
    },
    overrides: ((tender.metadataOverrides ?? []) as any[]).map((o) => ({
      field: o.field,
      fieldState: o.fieldState,
      overrideValue: o.overrideValue ?? null,
      reason: o.reason ?? null,
      overriddenBy: o.overriddenBy ?? null,
      createdAt: o.createdAt ?? null,
      confirmationBasis: o.confirmationBasis ?? null,
      authorityClass: o.authorityClass ?? null,
      confirmedAt: o.confirmedAt ?? null,
    })),
    hasExtractedRequirements: tender.requirements.length > 0,
    submissionMethodContext: tender.submissionMethod ?? undefined,
    // Same canonical active-file grounding rule as the generation gate so the
    // export/Final-ZIP readiness can never disagree with the gate.
    activeTenderFileIds: new Set(
      (tender.files ?? [])
        .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
        .map((f: any) => f.id),
    ),
    // Full active-file rows enable the STRONGEST shared grounding check
    // (quote containment + page <= totalPages) — same rule as the gate.
    activeFiles: (tender.files ?? [])
      .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
      .map((f: any) => ({ id: f.id, extractedText: f.extractedText ?? null, totalPages: f.totalPages ?? null })),
    // Pass the ledger snapshot so the resolver prefers ledger facts over scalar
    ...(ledgerSnapshot ? { ledgerFacts: ledgerSnapshot.facts } : {}),
  });
  if (canonicalExportState.hasExportBlocker) {
    const blockingFields = canonicalExportState.fields
      .filter((f) => f.criticality !== "non-critical" && f.blockerReason)
      .map((f) => f.label);
    // Only emit when the completeness gate did not already cover it, so we do
    // not double-count the same missing-metadata condition.
    if (!metadata.blockingForGeneration && blockingFields.length > 0) {
      tenderLevelBlockers.push({
        category: "TENDER_FACTS_INVALID",
        severity: "HIGH",
        title: `Required Tender Details / Submission Facts are unusable for export: ${blockingFields.join(", ")}.`,
        recommendedAction: "Resolve the flagged critical field(s) — provide a valid value or confirm them — before final export. Not Applicable is not permitted for critical fields.",
      });
    }
  }
  // Client name gate — an empty/whitespace-only clientName (and no
  // procuringEntityName fallback) must block export so a proposal is
  // never sent without knowing who the procuring entity is.
  const effectiveClientName = (tender.clientName ?? "").trim() || (tender.procuringEntityName ?? "").trim();
  if (!effectiveClientName) {
    tenderLevelBlockers.push({
      category: "CLIENT_NAME_MISSING",
      severity: "HIGH",
      title: "Client/procuring entity name is missing or blank.",
      recommendedAction: "Enter the official procuring entity name in Tender Detail before final export.",
    });
  }
  // Contamination gate — any entity identity field (clientName, legalClientName,
  // donorAgency, implementingAgency) polluted with portal nav text or status
  // banners must block export until corrected.
  if (tender.metadataContaminated === true) {
    tenderLevelBlockers.push({
      category: "CLIENT_ENTITY_CONTAMINATED",
      severity: "HIGH",
      title: "One or more entity identity fields (client name, legal name, donor agency, or implementing agency) may be contaminated by unrelated portal text.",
      recommendedAction: "Re-run AI Analyze or review and correct the affected entity fields in Tender Detail before exporting.",
    });
  }
  // Entity identity collision — implementingAgency and clientName must refer
  // to distinct organisations on multi-stakeholder tenders. Identical values
  // usually mean the same text was copied into both fields by mistake.
  const implementingAgencyValue = (tender.implementingAgency ?? "").trim();
  const clientNameValue = (tender.clientName ?? "").trim();
  if (implementingAgencyValue && clientNameValue && implementingAgencyValue.toLowerCase() === clientNameValue.toLowerCase()) {
    tenderLevelBlockers.push({
      category: "ENTITY_IDENTITY_COLLISION",
      severity: "MEDIUM",
      title: "implementingAgency and clientName are identical — this is likely a data quality issue (same value populated in both fields).",
      recommendedAction: "Verify whether the procuring entity and implementing agency are the same organisation; if they differ, correct the implementing agency field in Tender Detail.",
    });
  }

  if (qualityFailed > 0) {
    tenderLevelBlockers.push({
      category: "GENERATED_DOCUMENT_QUALITY_FAILED",
      severity: "HIGH",
      title: `${qualityFailed} generated document(s) failed the quality gate (QUALITY_FAILED).`,
      recommendedAction: "Review the flagged documents in the Export Readiness panel; rewrite or attach official originals before export.",
    });
  }
  if (!confirmedPlan.ok) {
    tenderLevelBlockers.push({
      category: "NO_CURRENT_CONFIRMED_BUILD_PLAN",
      severity: "HIGH",
      title: `No current confirmed Build Plan: ${confirmedPlan.blocker}`,
      recommendedAction: "Build and confirm the submission Build Plan before final export. Derived drafts do not authorize export.",
    });
  }
  if (requiredPlanCount > 0 && !hasExplicitPlanScope) {
    tenderLevelBlockers.push({
      category: "SUBMISSION_PLAN_DERIVED_UNCONFIRMED",
      severity: "HIGH",
      title: "Submission plan is a derived draft and has not been confirmed from tender-issued file/order instructions.",
      recommendedAction: "Review the Submission Plan Completeness panel, then confirm exact file names/order from the tender before final export. Do not treat derived rows as official tender forms.",
    });
  }
  // Hard block when the confirmed submission plan lists files that have not yet
  // been generated — exporting an incomplete package would omit required documents.
  if (missingPlan.length > 0 && hasExplicitPlanScope) {
    tenderLevelBlockers.push({
      category: "SUBMISSION_PLAN_DOCUMENTS_MISSING",
      severity: "HIGH",
      title: `${missingPlan.length} submission plan document(s) have not been generated: ${missingPlan.map((d) => d.exactFileName).join(", ")}.`,
      recommendedAction: "Generate the missing documents from the Generate Documents panel before attempting final export.",
    });
  }
  // Hard block when there are generated documents outside the confirmed
  // submission plan — these would either be included incorrectly (wrong
  // package) or need to be superseded. Per spec rule 9: superseded, stale,
  // failed, PLANNED, or outside-plan rows must be excluded from the ZIP.
  // This explicit blocker mirrors the EXTRA_FILES check in
  // filePlanBlockersFromLists for defense-in-depth.
  if (extraPlan.length > 0 && hasExplicitPlanScope) {
    tenderLevelBlockers.push({
      category: "OUTSIDE_PLAN_DOCUMENTS",
      severity: "HIGH",
      title: `${extraPlan.length} generated document(s) are outside the confirmed submission plan: ${extraPlan.map((d) => d.exactFileName ?? d.name).slice(0, 5).join(", ")}${extraPlan.length > 5 ? ` and ${extraPlan.length - 5} more` : ""}.`,
      recommendedAction: "Supersede or remove the outside-plan documents before final export, or add them to the submission plan if they are required.",
    });
  }
  // Hard block when the tender has mandatory requirements but no submission plan
  // has been built at all — the export package cannot be correctly planned.
  if (requiredPlanCount === 0 && !hasExplicitPlanScope && mandatoryRequirements.length > 0) {
    tenderLevelBlockers.push({
      category: "MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN",
      severity: "HIGH",
      title: `Tender has ${mandatoryRequirements.length} mandatory requirement(s) but no submission plan has been built — the export package cannot be correctly planned.`,
      recommendedAction: "Run Build Plan to construct the submission plan from the mandatory requirements before export.",
    });
  }
  if (analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    tenderLevelBlockers.push({
      category: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      severity: "HIGH",
      title: "Tender analysis came from the regex fallback (AI providers failed) and has not been human-approved.",
      recommendedAction: "Re-run AI Analyze with healthy providers. Human approval is audit-only and does NOT authorize release.",
    });
  }
  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only — it MUST
  // NEVER authorize final submission / export. Even though a human approved
  // the fallback, the release path remains blocked until a genuine AI
  // analysis is re-run. This closes the gap where human approval silently
  // unlocked the final-submission-readiness panel.
  if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    tenderLevelBlockers.push({
      category: "ANALYSIS_FALLBACK_AUDIT_ONLY",
      severity: "HIGH",
      title: "Tender analysis was human-approved as audit-only. Human approval no longer authorizes final submission or export.",
      recommendedAction: "Re-run AI Analyze with healthy providers to obtain a genuine AI analysis. The audit-only approval is preserved for record-keeping but does NOT unblock release.",
    });
  }
  // Mirror the export-readiness.ts gate: block when analysisExtractionStatus
  // indicates that AI Analyze ran on corrupted or weak extraction.
  const analysisExtractionStatus = tender.analysisExtractionStatus;
  if (analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") {
    tenderLevelBlockers.push({
      category: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      severity: "HIGH",
      title: "AI Analyze was skipped because tender extraction was corrupted — requirements and metadata may be incomplete.",
      recommendedAction: "Re-upload a clearer document or run OCR, then re-run AI Analyze before attempting export.",
    });
  }
  if (analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    tenderLevelBlockers.push({
      category: "ANALYSIS_FROM_WEAK_EXTRACTION",
      severity: "HIGH",
      title: "Tender analysis used regex/deterministic fallback because extraction was too weak — generated documents may be based on incomplete requirements.",
      recommendedAction: "Run OCR extraction on the tender file, then re-run AI Analyze before exporting.",
    });
  }
  if (analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    tenderLevelBlockers.push({
      category: "ANALYSIS_FROM_PARTIAL_EXTRACTION",
      severity: "HIGH",
      title: "AI analysis was performed on a partially-extracted tender — some pages were weak or OCR-only. Exported documents may be missing requirements from unread pages.",
      recommendedAction: "Re-extract the tender file (run OCR if needed), then re-run AI Analyze to obtain a full-extraction analysis before exporting.",
    });
  }
  // NOTE: the deadline-in-the-past check lives in export-readiness.ts, which
  // emits DEADLINE_PASSED as a HIGH advisory (not a hard blocker). That
  // advisory already flows in via `readiness.advisoryWarnings` above, so we
  // do NOT re-add it here — doing so previously produced a DEADLINE_PASSED
  // entry in BOTH the advisory list and the hard tenderLevelBlockers list,
  // which incorrectly blocked export after a passed deadline.

  // Extraction quality gate — mirrors the POST /export enforcement so the panel
  // shows the blocker before the user tries to export, not just after.
  if (!isExtractionAcceptableForExport(tender.files ?? [])) {
    tenderLevelBlockers.push({
      category: "EXTRACTION_QUALITY_INSUFFICIENT",
      severity: "HIGH",
      title: "Page extraction quality is insufficient for export (poor coverage, unknown page count, or failed pages).",
      recommendedAction: "Re-upload a clearer document or run OCR, then re-run AI Analyze before attempting export.",
    });
  }

  // OPEN HIGH evaluator objections are hard blockers — the evaluator committee
  // flagged a critical gap the proposal must address before submission.
  const openHighObjections = await client.evaluatorObjection.count({
    where: { tenderId: opts.tenderId, status: "OPEN", severity: "HIGH" },
  });
  if (openHighObjections > 0) {
    tenderLevelBlockers.push({
      category: "EVALUATOR_OBJECTION_HIGH_OPEN",
      severity: "HIGH",
      title: `${openHighObjections} unresolved HIGH evaluator objection(s) must be addressed before final export.`,
      recommendedAction: "Open the Evaluator Objections panel, resolve each HIGH objection with evidence, then re-run the export gate.",
    });
  }

  // ── Evaluation criteria extraction check (advisory) ─────────────────────
  // When evaluationMethodology is empty/null and no evaluation criteria source
  // JSON is stored, the generated proposal cannot mirror the evaluation
  // criteria — a significant proposal-quality risk. Push as MEDIUM advisory
  // rather than a hard blocker because some tenders genuinely have no criteria.
  const hasEvalCriteria = Boolean(
    (tender.evaluationMethodology ?? "").trim().length > 20 ||
    tender.evaluationCriteriaSourceJson,
  );
  if (!hasEvalCriteria) {
    tenderLevelBlockers.push({
      category: "EVALUATION_CRITERIA_NOT_EXTRACTED",
      severity: "MEDIUM",
      title: "Evaluation criteria were not extracted from the tender — the generated proposal cannot mirror the scoring rubric.",
      recommendedAction: "Re-run AI Analyze or manually enter evaluation criteria weights so the proposal targets the scoring rubric directly.",
    });
  }

  // ── Source traceability coverage (evidence gap check) ────────────────────
  // If more than 10% of mandatory requirements lack any source traceability
  // (no sourceConfidence > 0, no sourceTenderFileId, no sourcePageNumber,
  // no sourceExactQuote), push a MEDIUM-severity blocker.
  // Threshold tightened from 20% → 10%: a 20% tolerance allowed 4 of 5
  // critical requirements to be untraceable before surfacing the warning.
  if (mandatoryRequirements.length > 0) {
    const missingTraceability = mandatoryRequirements.filter(
      (r) =>
        (r.sourceConfidence ?? 0) <= 0 &&
        !r.sourceTenderFileId &&
        !r.sourcePageNumber &&
        !(r.sourceExactQuote ?? "").trim() &&
        !(r.sectionReference ?? "").trim(),
    ).length;
    const missingRatio = missingTraceability / mandatoryRequirements.length;
    if (missingRatio > 0.1) {
      tenderLevelBlockers.push({
        category: "SOURCE_TRACEABILITY_MISSING",
        severity: "MEDIUM",
        title: `${missingTraceability} of ${mandatoryRequirements.length} mandatory requirement(s) lack source traceability (${Math.round(missingRatio * 100)}% untraced).`,
        recommendedAction: "Re-run AI Analyze to extract source page, quote, and confidence for mandatory requirements before building the submission plan.",
      });
    }

    // Weak-trace check: confidence-only traces (no page number, no source quote)
    // are unverifiable. If more than 20% of mandatory requirements have only a
    // confidence score but neither a page reference nor a source quote, the AI
    // traceability cannot be independently verified against the source document.
    const weaklyTracedCount = mandatoryRequirements.filter(
      (r) =>
        (r.sourceConfidence ?? 0) > 0 &&
        !r.sourcePageNumber &&
        !(r.sourceExactQuote ?? "").trim(),
    ).length;
    const weakRatio = weaklyTracedCount / mandatoryRequirements.length;
    if (weakRatio > 0.2) {
      tenderLevelBlockers.push({
        category: "SOURCE_TRACE_WEAK",
        severity: "MEDIUM",
        title: `${weaklyTracedCount} of ${mandatoryRequirements.length} mandatory requirement(s) have a confidence score but no page number or source quote — traces cannot be verified (${Math.round(weakRatio * 100)}% weak-traced).`,
        recommendedAction: "Re-run AI Analyze to extract concrete page references and source quotes for mandatory requirements.",
      });
    }
  }

  // Empty plan with mandatory requirements: if the tender has mandatory requirements
  // but no submission plan was built at all, document planning is impossible and
  // the export package would be an empty or ad-hoc bundle.
  // NOTE: This blocker was previously DUPLICATED — pushed at both line ~950
  // and line ~1105 with identical condition/category/severity/title/action.
  // The duplicate caused double-counting in blocker counts and duplicate UI
  // rows in the Recovery Command Center. Removed the second push; the first
  // push at line ~950 is the canonical one.
  // (No push here — see the earlier push above.)

  // ── Readiness scoring (Part 3) — weighted, with hard caps. ───────────────
  // NOTE: all tender-level blockers must be pushed above this call so that
  // finalExportGateOk correctly reflects the blocked state.
  const readinessScoreResult = computeReadinessScore({
    analysisSource,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    metadataContaminated: tender.metadataContaminated,
    metadataCompletenessRatio: metadata.overallRatio,
    metadataInvalidCount: metadata.invalidFields.length,
    sourceReferenceCoverage,
    // Confirmed mandatory evidence coverage comes ONLY from complianceMatrix
    // rows with FULL/SUBSTANTIAL support. Source-confidence traceability and
    // auto-linked/selected vault suggestions are useful progress signals, but
    // they must not count as confirmed final evidence coverage until a reviewer
    // confirms them into complianceMatrix.
    evidenceCoverage: mandatoryEvidenceCoverageRatio(tender.requirements),
    requiredDocumentsTotal: requiredPlanCount,
    requiredDocumentsSatisfied: Math.max(0, requiredPlanCount - missingPlan.length),
    outsidePlanDocuments: extraPlan.length,
    qualityFailedDocuments: qualityFailed,
    finalExportCandidatesCount: finalCandidates.length,
    readyForExportCount: finalCandidates.filter((d) => /READY_FOR_EXPORT|APPROVED/i.test(d.reviewStatus ?? "")).length,
    finalExportGateOk:
      readiness.ok &&
      documentBlockers.length === 0 &&
      tenderLevelBlockers.length === 0 &&
      isExtractionAcceptableForExport(tender.files ?? []) &&
      !metadata.blockingForExport,
  });

  const summary: FinalReadinessSummary = {
    totalBlockers: documentBlockers.length + tenderLevelBlockers.length,
    documentBlockers: documentBlockers.length,
    tenderLevelBlockers: tenderLevelBlockers.length,
    advisoryWarnings: advisoryWarnings.length,
    finalExportCandidates: finalCandidates.length,
    workspaceDocuments,
    excludedInternalRows: workspaceDocuments - finalCandidates.length,
    missingContentCount: detail.missingContent,
    invalidSignatureCount: detail.invalidSignature,
    hygieneIssueCount: detail.hygiene,
    officialOriginalBlockers: detail.originalRequired,
    envelopeBreakdown,
    strictTwoEnvelope,
    packageMode: packageMode.mode,
    planStatus: derivePlanStatus({
      requiredPlanCount,
      finalCandidateCount: finalCandidates.length,
      missingCount: missingPlan.length,
      extraCount: extraPlan.length,
      nameMismatch,
      orderMismatch,
      hasExplicitScope: hasExplicitPlanScope,
    }),
    // ── Gate extensions ───────────────────────────────────────────────────
    qualityFailedDocuments: qualityFailed,
    missingRequiredDocuments: missingPlan.length,
    outsidePlanDocuments: extraPlan.length,
    staleRowCount,
    analysisSource,
    missingCriticalMetadataCount: metadata.missingCritical.length,
    metadataPlaceholderCount: metadata.placeholderCount,
    metadataCompletenessRatio: metadata.overallRatio,
    readinessScore: readinessScoreResult.score,
    readinessCapReason: readinessScoreResult.appliedCap?.reason ?? null,
    readinessCapDimension: readinessScoreResult.appliedCap?.dimension ?? null,
    readinessCapScore: readinessScoreResult.appliedCap?.capScore ?? null,
    ungeneratedPlannedRequired: generatedDocuments.filter((d) => (d.generationStatus ?? "").toUpperCase() === "PLANNED").length,
    missingCriticalMetadataFields: [], // METADATA IS ADVISORY ONLY — do not populate missingCriticalMetadataFields
    // ── Canonical required-document counts ────────────────────────────────
    // requiredDocumentsTotal must include BOTH confirmed-plan required items
    // AND ungenerated PLANNED docs. When there's no confirmed plan but PLANNED
    // docs exist (e.g. derived plan was used to create stubs), the PLANNED docs
    // ARE the required total — showing 0/0 when 10 PLANNED docs exist is the
    // bug this fixes.
    requiredDocumentsTotal: Math.max(requiredPlanCount, generatedDocuments.filter((d) => (d.generationStatus ?? "").toUpperCase() === "PLANNED").length),
    // exportReadyDocumentsTotal = docs that are GENERATED, not SUPERSEDED/PLANNED,
    // and pass the export-candidate filter. This is the numerator for the tile.
    exportReadyDocumentsTotal: finalCandidates.filter((d) => /READY_FOR_EXPORT|APPROVED/i.test(d.reviewStatus ?? "")).length,
    // ── Primary blocker reason + fix action ──────────────────────────────
    // Priority order: planned-not-generated > no-export-ready > evidence >
    // source-grounding > validation > quality > submission-facts > export-gate
    primaryBlockerReason: (() => {
      const ungenerated = generatedDocuments.filter((d) => (d.generationStatus ?? "").toUpperCase() === "PLANNED").length;
      if (ungenerated > 0) return `${ungenerated} required document(s) are planned but not generated.`;
      if (finalCandidates.length === 0 && requiredPlanCount > 0) return "No export-ready documents. Generate required documents first.";
      const exportReady = finalCandidates.filter((d) => /READY_FOR_EXPORT|APPROVED/i.test(d.reviewStatus ?? "")).length;
      if (finalCandidates.length > 0 && exportReady === 0) return "No documents are validated and approved for export.";
      if (documentBlockers.length > 0) return documentBlockers[0]?.name ?? documentBlockers[0]?.reasons?.[0] ?? "Document blockers exist.";
      if (tenderLevelBlockers.length > 0) return tenderLevelBlockers[0]?.title ?? "Tender-level blockers exist.";
      if (!readiness.ok) return "Export gate is not satisfied.";
      return null;
    })(),
    primaryFixAction: (() => {
      const ungenerated = generatedDocuments.filter((d) => (d.generationStatus ?? "").toUpperCase() === "PLANNED").length;
      if (ungenerated > 0) return "Generate required documents.";
      if (finalCandidates.length === 0 && requiredPlanCount > 0) return "Generate required documents.";
      const exportReady = finalCandidates.filter((d) => /READY_FOR_EXPORT|APPROVED/i.test(d.reviewStatus ?? "")).length;
      if (finalCandidates.length > 0 && exportReady === 0) return "Validate and approve documents for export.";
      if (documentBlockers.length > 0) return documentBlockers[0]?.nextActions?.[0] ?? "Resolve document blockers.";
      if (tenderLevelBlockers.length > 0) return tenderLevelBlockers[0]?.recommendedAction ?? "Resolve tender-level blockers.";
      if (!readiness.ok) return "Resolve all export gate blockers.";
      return null;
    })(),
  };

  // ── Currency authority ─────────────────────────────────────────────
  // Per REVISION_REQUIRED (exact-head recheck): do NOT maintain a second
  // currency authority resolver. The canonical field resolver
  // (resolveCanonicalFieldState, called above) already includes "currency"
  // in its field list and resolves override + ledger + fieldState + evidence
  // + active-file membership. canonicalExportState.hasExportBlocker already
  // catches currency issues. The TENDER_FACTS_INVALID blocker (pushed above
  // when hasExportBlocker is true) covers currency.
  //
  // The screenshot defect (USD default on corrupted tenders) is fixed by
  // the migration (Tender.currency is now nullable, no default). New tenders
  // get NULL when the extractor finds no currency. The report page renders
  // "Not extracted" for NULL and "Unverified legacy value" for non-null
  // currency that the canonical resolver flags as unverified.
  //
  // No separate currency authority call needed here.

  const ok = readiness.ok && documentBlockers.length === 0 && tenderLevelBlockers.length === 0;
  const message = buildMessage({ ok, documentBlockers, tenderLevelBlockers, advisoryWarnings });

  return {
    ok,
    tender: {
      id: tender.id,
      title: tender.title,
      status: tender.status,
      stage: tender.stage,
      // Mirror the canonical gated score in API responses so callers do not
      // accidentally display the legacy DB workflow-progress column as final readiness.
      readinessScore: readinessScoreResult.score,
    },
    documentBlockers,
    tenderLevelBlockers,
    advisoryWarnings,
    summary,
    message,
    canonicalFields: canonicalExportState.fields,
  };
}

// ── pure exports for tests ─────────────────────────────────────────────────

export const __testing__ = {
  severityForReasons,
  nextActionForReason,
  derivePlanStatus,
  applyAdvisoryResolutions,
  buildMessage,
  detectMessageType,
  mandatoryEvidenceCoverageRatio,
};

// Re-export shared types so consumers don't need to also import from
// ./document-output-state when they only want the canonical shape.
export type { DocumentLike };
