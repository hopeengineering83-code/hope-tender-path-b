// Submission Plan Completeness resolver.
//
// Screenshot regression:
//   The dashboard showed "Docs 6/19" with no breakdown — the user could
//   not see which of the 19 required documents were missing, which
//   official-original placeholders were waiting for upload, or which
//   generated rows were outside the explicit submission plan.
//
// This module joins:
//   - the canonical submission plan derived from tender requirements +
//     exactFileNaming + exactFileOrder (lib/engine/submission-plan.ts)
//   - the actual GeneratedDocument rows
//   - the canonical final-export-candidate filter
//   - official-original detection
// and returns one row per planned/actual document with a clear status
// label and recommended next action.
//
// The output is consumed by the new admin panel + a /api/tenders/[id]/
// submission-plan endpoint.

import {
  buildSubmissionPlan,
  hasExplicitSubmissionScope,
  inferEnvelope,
  type SubmissionEnvelope,
  type SubmissionPlanFile,
  type SubmissionPlanFormat,
  type TenderLike,
} from "./submission-plan";
import {
  filterFinalExportCandidateDocuments,
  isFinalExportCandidateDocument,
  type DocumentLike,
} from "./document-output-state";

export type SubmissionPlanRowStatus =
  | "GENERATED"                     // file is generated and a final-export candidate
  | "GENERATED_NEEDS_REVIEW"         // generated but not yet READY_FOR_EXPORT
  | "GENERATED_QUALITY_FAILED"       // generated but the quality gate failed
  | "PLANNED"                        // plan-only placeholder; no content yet
  | "OFFICIAL_ORIGINAL_REQUIRED"      // tender-issued original must be attached
  | "REPLACE_WITH_ORIGINAL"           // existing row marked replace-with-original
  | "MISSING"                        // in plan but no doc / no original exists
  | "OUTSIDE_PLAN"                    // doc exists but is not part of the explicit plan
  | "SUPERSEDED";                     // historical row, excluded from package

export type SubmissionPlanRow = {
  /** Plan-derived stable key — for plan rows this is the canonical
   *  exactFileName slug; for outside-plan rows it falls back to the
   *  GeneratedDocument id. */
  key: string;
  exactFileName: string | null;
  /** GeneratedDocument id when the row resolves to an actual document. */
  documentId: string | null;
  /** Plan-derived label / actual document name. */
  name: string;
  documentType: string | null;
  format: string | null;
  envelope: SubmissionEnvelope;
  required: boolean;
  exactOrder: number | null;
  status: SubmissionPlanRowStatus;
  generationStatus: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  hasFileContent: boolean;
  hasStoragePath: boolean;
  /** True when the document is an official-original (must be attached, not generated). */
  officialOriginal: boolean;
  recommendedAction: string;
};

export type SubmissionPlanState =
  | "EXPLICIT_TENDER_PLAN"
  | "DERIVED_DRAFT_UNCONFIRMED"
  | "PLAN_NOT_BUILT"
  | "REQUIREMENTS_FOUND_PLAN_NOT_BUILT"
  | "NO_REQUIREMENTS";

export type SubmissionPlanCompletenessReport = {
  totalRequired: number;
  totalGenerated: number;
  totalMissing: number;
  totalOfficialOriginalsRequired: number;
  totalOutsidePlan: number;
  totalSuperseded: number;
  totalQualityFailed: number;
  envelopeBreakdown: Record<SubmissionEnvelope, number>;
  /** Number of extracted tender requirements available to derive a plan from. */
  requirementCount: number;
  /** True only when tender-issued exact file names/order or per-requirement exactFileName exist. */
  hasExplicitScope: boolean;
  /** Current plan provenance/state so the UI never renders a misleading 0/0/0 plan. */
  planState: SubmissionPlanState;
  /** True when rows are derived from requirement titles and must be confirmed before final export. */
  requiresUserConfirmation: boolean;
  rows: SubmissionPlanRow[];
  warnings: string[];
};

export type GeneratedDocSnapshot = DocumentLike & {
  id: string;
  name: string;
  exactFileName: string | null;
  exactOrder: number | null;
  documentType: string | null;
  format: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent: string | null;
  storagePath: string | null;
  contentSummary?: string | null;
};

// Regex accept both "bid bond" (with whitespace) and "bid-bond" /
// "bid_bond" (with hyphens/underscores) — production file names use
// mixed separators.
const OFFICIAL_ORIGINAL_NAME_PATTERNS: RegExp[] = [
  /\bbid[-_\s]+form\b/i,
  /\btender[-_\s]+form\b/i,
  /\bdeclaration[-_\s]+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity[-_\s]+pact\b/i,
  /\bbid[-_\s]+bond\b/i,
  /\bbid[-_\s]+security\b/i,
  /\bbank[-_\s]+statement\b/i,
  /\btin[-_\s]+cert/i,
  /\bvat[-_\s]+cert/i,
  /\btax[-_\s]+clearance\b/i,
  /\baudited[-_\s]+financial\b/i,
  /\btrade[-_\s]+license\b/i,
  /\bbusiness[-_\s]+licen/i,
  /\bregistration[-_\s]+(?:certificate|form)\b/i,
];

function looksLikeOfficialOriginal(label: string): boolean {
  return OFFICIAL_ORIGINAL_NAME_PATTERNS.some((rx) => rx.test(label));
}

// Patterns for documents that describe submission rules/formatting — these are
// reference/control docs and must not appear as missing items in the proposal package.
const CONTROL_DOCUMENT_PATTERNS: RegExp[] = [
  /submission\s+(formatting|rules|instructions|guidelines)/i,
  /packaging\s+rules/i,
  /file\s+and\s+packaging/i,
  /submission\s+control/i,
  /cover\s+sheet\s+template/i,
  /submission\s+checklist/i,
];

/**
 * Returns true when the document name/type identifies it as a submission-rules
 * control document that should be classified NOT_EXPORTABLE rather than treated
 * as a missing plan item.
 */
function isControlDocument(name: string | null | undefined, documentType?: string | null): boolean {
  const label = name ?? "";
  return CONTROL_DOCUMENT_PATTERNS.some((p) => p.test(label)) ||
    documentType === "CONTROL" ||
    documentType === "SUBMISSION_RULES";
}

function fileKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveStatus(doc: GeneratedDocSnapshot | null, planFile: SubmissionPlanFile | null, qualityFailed: boolean): SubmissionPlanRowStatus {
  if (!doc && planFile) {
    const label = `${planFile.exactFileName} ${planFile.documentType}`;
    if (looksLikeOfficialOriginal(label)) return "OFFICIAL_ORIGINAL_REQUIRED";
    return "MISSING";
  }
  if (!doc) return "MISSING";
  const gen = (doc.generationStatus ?? "").toUpperCase();
  const val = (doc.validationStatus ?? "").toUpperCase();
  const rev = (doc.reviewStatus ?? "").toUpperCase();
  const storedQualityFailed = [gen, val, rev].some((status) =>
    status === "GENERATED_QUALITY_FAILED" || status === "QUALITY_FAILED" || status === "NEEDS_REWRITE",
  );
  if (gen === "SUPERSEDED") return "SUPERSEDED";
  if (rev === "REPLACE_WITH_ORIGINAL") return "REPLACE_WITH_ORIGINAL";
  if (rev === "NOT_EXPORTABLE") return "REPLACE_WITH_ORIGINAL";
  if (gen === "PLANNED") return "PLANNED";
  if (qualityFailed || storedQualityFailed) return "GENERATED_QUALITY_FAILED";
  if (!isFinalExportCandidateDocument(doc)) return "PLANNED";
  if (rev === "READY_FOR_EXPORT" || rev === "APPROVED") return "GENERATED";
  return "GENERATED_NEEDS_REVIEW";
}

function recommendedActionFor(status: SubmissionPlanRowStatus, planFile: SubmissionPlanFile | null, doc: GeneratedDocSnapshot | null): string {
  switch (status) {
    case "GENERATED": return "Ready for export.";
    case "GENERATED_NEEDS_REVIEW": return "Complete reviewer approval — mark READY_FOR_EXPORT.";
    case "GENERATED_QUALITY_FAILED": return "Quality gate failed — rewrite or attach the official original.";
    case "PLANNED": return "Generate the document or attach the official tender-issued original.";
    case "OFFICIAL_ORIGINAL_REQUIRED": return "Upload the tender-issued original via Attach official original — do not generate.";
    case "REPLACE_WITH_ORIGINAL": return "Attach the exact tender-issued original; the current row is a placeholder.";
    case "MISSING": return `Generate the required file (${planFile?.exactFileName ?? "missing file"}) or attach the official original.`;
    case "OUTSIDE_PLAN": return `Map this document into the submission plan or supersede it; it is not part of the tender-required file list (${doc?.exactFileName ?? doc?.name ?? "unmapped doc"}).`;
    case "SUPERSEDED": return "Historical row — already excluded from the final package.";
    default: return "Review the row status.";
  }
}

export type ResolvePlanCompletenessInput = {
  tender: TenderLike;
  generatedDocuments: GeneratedDocSnapshot[];
  /** Optional: ids of docs that failed the quality gate (from
   *  lib/engine/document-quality-gate.ts). When provided, drives the
   *  GENERATED_QUALITY_FAILED status; otherwise quality is not factored in. */
  qualityFailedIds?: Set<string>;
};

/**
 * Build the per-row completeness view of the tender's submission plan.
 *
 * Resolution order:
 *   1. Build the canonical plan (required files).
 *   2. For each plan file, find the most relevant GeneratedDocument
 *      (case-insensitive exactFileName, falling back to name match).
 *   3. Emit a row with the resolved status.
 *   4. For every GeneratedDocument NOT mapped to a plan file, emit an
 *      OUTSIDE_PLAN row (or SUPERSEDED when generationStatus is SUPERSEDED).
 */
export function resolveSubmissionPlanCompleteness(input: ResolvePlanCompletenessInput): SubmissionPlanCompletenessReport {
  const plan = buildSubmissionPlan(input.tender);
  let planFiles = plan.files.filter((f) => f.required);
  const requirementCount = input.tender.requirements?.length ?? 0;
  const explicitScope = hasExplicitSubmissionScope(input.tender);

  // When buildSubmissionPlan() returns 0 required files (requirements exist but none
  // have exactFileName set), check for active GeneratedDocument rows and adopt them
  // as the effective plan so the UI never shows a contradicting "Plan up to date" +
  // "Plan state: Plan not built" simultaneously.
  let adoptedFromDocs = false;
  if (planFiles.length === 0 && input.generatedDocuments.length > 0) {
    const activeDocs = input.generatedDocuments.filter((doc) => {
      const gen = (doc.generationStatus ?? "").toUpperCase();
      const rev = (doc.reviewStatus ?? "").toUpperCase();
      return gen !== "SUPERSEDED" && rev !== "NOT_EXPORTABLE";
    });
    if (activeDocs.length > 0) {
      // Adopt each active doc as a required plan file so they match in the main loop.
      planFiles = activeDocs.map((doc, idx) => ({
        canonicalId: fileKey(doc.exactFileName ?? doc.name),
        exactFileName: doc.exactFileName ?? doc.name,
        documentType: doc.documentType ?? "TENDER_REQUIRED_FILE",
        format: (doc.format ?? "DOCX") as SubmissionPlanFormat,
        required: true,
        envelope: inferEnvelope(doc.documentType ?? "TECHNICAL", doc.exactFileName ?? doc.name ?? ""),
        exactOrder: doc.exactOrder ?? idx + 1,
        sourceRequirementIds: [],
        pageLimit: null,
      }));
      adoptedFromDocs = true;
    }
  }

  // Map every generated doc by its file-key.
  const docByKey = new Map<string, GeneratedDocSnapshot>();
  const usedDocIds = new Set<string>();
  for (const doc of input.generatedDocuments) {
    const key = fileKey(doc.exactFileName ?? doc.name);
    if (!key || docByKey.has(key)) continue;
    docByKey.set(key, doc);
  }

  const rows: SubmissionPlanRow[] = [];
  const warnings: string[] = [];

  for (const planFile of planFiles) {
    const key = fileKey(planFile.exactFileName);
    const doc = docByKey.get(key) ?? null;
    if (doc) usedDocIds.add(doc.id);
    const qualityFailed = doc ? Boolean(input.qualityFailedIds?.has(doc.id)) : false;
    const status = resolveStatus(doc, planFile, qualityFailed);
    const officialOriginal = looksLikeOfficialOriginal(`${planFile.exactFileName} ${planFile.documentType}`);
    rows.push({
      key: `plan:${key}`,
      exactFileName: planFile.exactFileName,
      documentId: doc?.id ?? null,
      name: doc?.name ?? planFile.exactFileName,
      documentType: planFile.documentType,
      format: planFile.format,
      envelope: planFile.envelope ?? inferEnvelope(planFile.documentType, planFile.exactFileName),
      required: planFile.required,
      exactOrder: planFile.exactOrder,
      status,
      generationStatus: doc?.generationStatus ?? null,
      validationStatus: doc?.validationStatus ?? null,
      reviewStatus: doc?.reviewStatus ?? null,
      hasFileContent: Boolean(doc?.fileContent && (doc.fileContent ?? "").length > 0),
      hasStoragePath: Boolean(doc?.storagePath && (doc.storagePath ?? "").length > 0),
      officialOriginal,
      recommendedAction: recommendedActionFor(status, planFile, doc),
    });
  }

  // Outside-plan + superseded rows.
  for (const doc of input.generatedDocuments) {
    if (usedDocIds.has(doc.id)) continue;
    const gen = (doc.generationStatus ?? "").toUpperCase();
    let status: SubmissionPlanRowStatus = gen === "SUPERSEDED" ? "SUPERSEDED" : "OUTSIDE_PLAN";
    const envelope = inferEnvelope(doc.documentType ?? "TECHNICAL", doc.exactFileName ?? doc.name ?? "");
    const officialOriginal = looksLikeOfficialOriginal(`${doc.name} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""}`);
    const storedQualityFailed = [doc.generationStatus, doc.validationStatus, doc.reviewStatus]
      .map((status) => (status ?? "").toUpperCase())
      .some((status) => status === "GENERATED_QUALITY_FAILED" || status === "QUALITY_FAILED" || status === "NEEDS_REWRITE");
    const qualityFailed = Boolean(input.qualityFailedIds?.has(doc.id)) || storedQualityFailed;

    // Submission-formatting and packaging-rules docs are control/reference material —
    // they must not appear as missing plan items or outside-plan warnings.
    // Classify them as SUPERSEDED (excluded from the plan count) so they don't
    // inflate totalOutsidePlan and don't count against "Missing" in the summary.
    if (status === "OUTSIDE_PLAN" && isControlDocument(doc.name, doc.documentType)) {
      status = "SUPERSEDED";
    }

    const effectiveStatus = qualityFailed && status === "OUTSIDE_PLAN" ? "GENERATED_QUALITY_FAILED" : status;
    rows.push({
      key: `doc:${doc.id}`,
      exactFileName: doc.exactFileName,
      documentId: doc.id,
      name: doc.name,
      documentType: doc.documentType,
      format: doc.format,
      envelope,
      required: false,
      exactOrder: doc.exactOrder ?? null,
      status: effectiveStatus,
      generationStatus: doc.generationStatus,
      validationStatus: doc.validationStatus,
      reviewStatus: doc.reviewStatus,
      hasFileContent: Boolean(doc.fileContent && doc.fileContent.length > 0),
      hasStoragePath: Boolean(doc.storagePath && doc.storagePath.length > 0),
      officialOriginal,
      recommendedAction: recommendedActionFor(effectiveStatus, null, doc),
    });
  }

  rows.sort((a, b) => (a.exactOrder ?? 9999) - (b.exactOrder ?? 9999));

  const envelopeBreakdown: Record<SubmissionEnvelope, number> = { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 };
  for (const row of rows) {
    if (row.status === "SUPERSEDED") continue;
    envelopeBreakdown[row.envelope] = (envelopeBreakdown[row.envelope] ?? 0) + 1;
  }

  const totalRequired = planFiles.length;
  const totalGenerated = rows.filter((r) => r.status === "GENERATED" || r.status === "GENERATED_NEEDS_REVIEW").length;
  const totalMissing = rows.filter((r) => r.status === "MISSING").length;
  const totalOfficialOriginalsRequired = rows.filter((r) => r.status === "OFFICIAL_ORIGINAL_REQUIRED" || r.status === "REPLACE_WITH_ORIGINAL").length;
  const totalOutsidePlan = rows.filter((r) => r.status === "OUTSIDE_PLAN").length;
  const totalSuperseded = rows.filter((r) => r.status === "SUPERSEDED").length;
  const totalQualityFailed = rows.filter((r) => r.status === "GENERATED_QUALITY_FAILED").length;
  const hasExplicitScope = explicitScope;

  // Determine plan state.
  // When docs were adopted (planFiles built from existing GeneratedDocument rows),
  // check contentSummary markers to determine whether those docs were themselves
  // derived-draft or explicit.
  let planState: SubmissionPlanState;
  if (totalRequired > 0) {
    if (adoptedFromDocs) {
      // Adopted rows: look at contentSummary to decide state.
      const activeDocs = input.generatedDocuments.filter((doc) => {
        const gen = (doc.generationStatus ?? "").toUpperCase();
        const rev = (doc.reviewStatus ?? "").toUpperCase();
        return gen !== "SUPERSEDED" && rev !== "NOT_EXPORTABLE";
      });
      const anyDerived = activeDocs.some((doc) =>
        typeof doc.contentSummary === "string" && doc.contentSummary.includes("DERIVED_DRAFT_UNCONFIRMED"),
      );
      planState = anyDerived ? "DERIVED_DRAFT_UNCONFIRMED" : "EXPLICIT_TENDER_PLAN";
    } else {
      planState = hasExplicitScope ? "EXPLICIT_TENDER_PLAN" : "DERIVED_DRAFT_UNCONFIRMED";
    }
  } else if (requirementCount > 0) {
    planState = "REQUIREMENTS_FOUND_PLAN_NOT_BUILT";
  } else {
    planState = "NO_REQUIREMENTS";
  }

  const requiresUserConfirmation = planState === "DERIVED_DRAFT_UNCONFIRMED";

  if ((planState as string) === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT" || (planState as string) === "PLAN_NOT_BUILT") {
    warnings.push(`${requirementCount} tender requirement(s) exist, but no submission file plan has been built or confirmed. Build Submission Plan before Generate Docs so outputs can be validated against tender scope.`);
  }
  if (requiresUserConfirmation) {
    warnings.push("Submission plan is a derived draft from requirement titles/types. Confirm tender-issued file names/order before final export; do not treat derived rows as official tender forms.");
  }

  if (totalRequired > 0 && totalMissing > 0) {
    warnings.push(`${totalMissing}/${totalRequired} required submission documents are still missing from current outputs.`);
  }
  if (totalOutsidePlan > 0) {
    warnings.push(`${totalOutsidePlan} generated document(s) are outside the explicit submission plan and must be mapped or superseded.`);
  }
  if (totalOfficialOriginalsRequired > 0) {
    warnings.push(`${totalOfficialOriginalsRequired} official-original document(s) are required — attach via Attach official original; do not generate.`);
  }

  return {
    totalRequired,
    totalGenerated,
    totalMissing,
    totalOfficialOriginalsRequired,
    totalOutsidePlan,
    totalSuperseded,
    totalQualityFailed,
    envelopeBreakdown,
    requirementCount,
    hasExplicitScope,
    planState,
    requiresUserConfirmation,
    rows,
    warnings,
  };
}

export const __testing__ = { looksLikeOfficialOriginal, fileKey };

// Pure-helper alias also re-export the existing canonical filter so test
// consumers can confirm the panel uses the same source of truth.
export { filterFinalExportCandidateDocuments };

// ── Submission plan existence gate ────────────────────────────────────────────
// Used by the Generate Docs route to hard-block generation before a valid
// submission plan has been explicitly built. A "valid" plan means at least
// one GeneratedDocument row exists with a non-SUPERSEDED generationStatus
// AND a reviewStatus that indicates it was placed there by the Build Plan
// step (PLANNED, PENDING, APPROVED, CONFIRMED, READY_FOR_EXPORT, or
// REPLACE_WITH_ORIGINAL).
//
// The check is intentionally permissive about the exact review status so
// it catches both the happy path (PLANNED rows created by Build Plan) and
// manually-confirmed rows.

export type SubmissionPlanCheckResult = {
  valid: boolean;
  reason?: string;
  plannedCount: number;
  confirmedCount: number;
};

export async function hasValidSubmissionPlan(
  // Accept `any` prisma client so the helper can be called with either the
  // singleton prisma import or a test mock without import-side-effects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient: any,
  tenderId: string,
): Promise<SubmissionPlanCheckResult> {
  const planned: number = await prismaClient.generatedDocument.count({
    where: {
      tenderId,
      generationStatus: { not: "SUPERSEDED" },
      reviewStatus: {
        in: [
          "PLANNED",
          "PENDING",
          "APPROVED",
          "CONFIRMED",
          "READY_FOR_EXPORT",
          "REPLACE_WITH_ORIGINAL",
        ],
      },
    },
  });

  if (planned === 0) {
    return {
      valid: false,
      reason: "NO_SUBMISSION_PLAN",
      plannedCount: 0,
      confirmedCount: 0,
    };
  }

  return { valid: true, plannedCount: planned, confirmedCount: planned };
}
