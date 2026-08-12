// Submission Plan Completeness resolver.
//
// Joins the canonical submission plan with actual GeneratedDocument rows and
// reports which files are generated, missing, official-original placeholders,
// outside-plan rows, or superseded rows.

import {
  buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback,
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
  | "GENERATED"
  | "GENERATED_NEEDS_REVIEW"
  | "GENERATED_QUALITY_FAILED"
  | "PLANNED"
  // Unified blocker for any tender-issued source form the app does not have
  // — whether it never matched a Tender Intake file (was OFFICIAL_ORIGINAL_REQUIRED)
  // or matched one but the produced row is still a placeholder reviewStatus
  // (was REPLACE_WITH_ORIGINAL). Both collapse into one user-facing signal:
  // the tender package is incomplete until the missing form is uploaded. The
  // underlying GeneratedDocument.reviewStatus DB value (REPLACE_WITH_ORIGINAL,
  // NOT_EXPORTABLE) is unchanged — only the row-status enum the resolver emits
  // to panels and gates is renamed.
  | "MISSING_TENDER_SOURCE_FORM"
  | "MISSING"
  | "OUTSIDE_PLAN"
  | "SUPERSEDED";

export type SubmissionPlanRow = {
  key: string;
  exactFileName: string | null;
  documentId: string | null;
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
  officialOriginal: boolean;
  recommendedAction: string;
};

export type SubmissionPlanState =
  | "CONFIRMED_BUILD_PLAN"
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
  requirementCount: number;
  hasExplicitScope: boolean;
  planState: SubmissionPlanState;
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

const CONTROL_DOCUMENT_PATTERNS: RegExp[] = [
  /submission\s+(formatting|rules|instructions|guidelines)/i,
  /packaging\s+rules/i,
  /file\s+and\s+packaging/i,
  /submission\s+control/i,
  /cover\s+sheet\s+template/i,
  /submission\s+checklist/i,
];

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
    if (looksLikeOfficialOriginal(label)) return "MISSING_TENDER_SOURCE_FORM";
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
  if (rev === "REPLACE_WITH_ORIGINAL") return "MISSING_TENDER_SOURCE_FORM";
  if (rev === "NOT_EXPORTABLE") return "MISSING_TENDER_SOURCE_FORM";
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
    case "GENERATED_QUALITY_FAILED": return "Quality gate failed — rewrite or regenerate.";
    case "PLANNED": return "Generate the planned document. This row has no final file content yet.";
    case "MISSING_TENDER_SOURCE_FORM": return "Upload the tender-issued source form from the complete tender package. Company Vault documents are already official — this only applies to tender-issued forms.";
    case "MISSING": return `Generate the required file (${planFile?.exactFileName ?? "missing file"}).`;
    case "OUTSIDE_PLAN": return `Map this document into the submission plan or supersede it; it is not part of the tender-required file list (${doc?.exactFileName ?? doc?.name ?? "unmapped doc"}).`;
    case "SUPERSEDED": return "Historical row — already excluded from the final package.";
    default: return "Review the row status.";
  }
}

export type ResolvePlanCompletenessInput = {
  tender: TenderLike;
  generatedDocuments: GeneratedDocSnapshot[];
  qualityFailedIds?: Set<string>;
  /**
   * Items of the current CONFIRMED BuildPlan, when one exists. When provided,
   * they are the AUTHORITATIVE plan: the derived-fallback plan and the
   * adopt-from-docs heuristic are skipped so completeness counts can never
   * disagree with the confirmed plan the gates enforce.
   */
  confirmedPlanItems?: SubmissionPlanFile[] | null;
};

export function resolveSubmissionPlanCompleteness(input: ResolvePlanCompletenessInput): SubmissionPlanCompletenessReport {
  const confirmedItems = input.confirmedPlanItems ?? null;
  const plan = confirmedItems
    ? { files: confirmedItems, warnings: [] as string[] }
    : buildSubmissionPlanWithDerivedFallback(input.tender);
  let planFiles = plan.files.filter((f) => f.required);
  const requirementCount = input.tender.requirements?.length ?? 0;
  const explicitScope = confirmedItems ? true : hasExplicitSubmissionScope(input.tender);

  let adoptedFromDocs = false;
  if (!confirmedItems && planFiles.length === 0 && input.generatedDocuments.length > 0) {
    const activeDocs = input.generatedDocuments.filter((doc) => {
      const gen = (doc.generationStatus ?? "").toUpperCase();
      const rev = (doc.reviewStatus ?? "").toUpperCase();
      return gen !== "SUPERSEDED" && rev !== "NOT_EXPORTABLE";
    });
    if (activeDocs.length > 0) {
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
  const plannedOnlyCount = rows.filter((r) => r.status === "PLANNED").length;
  const totalMissing = rows.filter((r) => r.status === "MISSING").length + plannedOnlyCount;
  const totalOfficialOriginalsRequired = rows.filter((r) => r.status === "MISSING_TENDER_SOURCE_FORM").length;
  const totalOutsidePlan = rows.filter((r) => r.status === "OUTSIDE_PLAN").length;
  const totalSuperseded = rows.filter((r) => r.status === "SUPERSEDED").length;
  const totalQualityFailed = rows.filter((r) => r.status === "GENERATED_QUALITY_FAILED").length;
  const hasExplicitScope = explicitScope;

  let planState: SubmissionPlanState;
  if (confirmedItems && totalRequired > 0) {
    planState = "CONFIRMED_BUILD_PLAN";
  } else if (totalRequired > 0) {
    if (adoptedFromDocs) {
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

  // Only a current CONFIRMED BuildPlan authorizes generation/export. An
  // explicit tender-issued file list is stronger than a derived draft, but it
  // is still an input to the Build Plan—not proof that a BuildPlan was built
  // and confirmed.
  const requiresUserConfirmation = planState !== "CONFIRMED_BUILD_PLAN";

  if ((planState as string) === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT" || (planState as string) === "PLAN_NOT_BUILT") {
    warnings.push(`${requirementCount} tender requirement(s) exist, but no submission file plan has been built or confirmed. Run Engine uses the verified source and current AI analysis to create and verify the Build Plan, so generated outputs can be validated against tender scope.`);
  }
  if (requiresUserConfirmation) {
    warnings.push(
      planState === "EXPLICIT_TENDER_PLAN"
        ? "Tender-issued file scope is available, but no current source-verified Build Plan exists. Run Engine creates and verifies it automatically."
        : "Submission plan is a derived draft from requirement titles/types. Confirm tender-issued file names/order before final export; do not treat derived rows as official tender forms.",
    );
  }

  if (totalRequired > 0 && totalMissing > 0) {
    warnings.push(`${totalMissing}/${totalRequired} required submission documents are still missing from current outputs.`);
  }
  if (plannedOnlyCount > 0) {
    warnings.push(`${plannedOnlyCount} planned document placeholder(s) have no file content yet. Use Generate Missing Planned Docs before validation or export.`);
  }
  if (totalOutsidePlan > 0) {
    warnings.push(`${totalOutsidePlan} generated document(s) are outside the explicit submission plan and must be mapped or superseded.`);
  }
  if (totalOfficialOriginalsRequired > 0) {
    warnings.push(`${totalOfficialOriginalsRequired} tender-issued form(s) are required — upload the complete tender package; do not generate.`);
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
export { filterFinalExportCandidateDocuments };

export type LoadedSubmissionPlanCompleteness = {
  report: SubmissionPlanCompletenessReport;
  /** Identity of the tender the report was resolved for. */
  tender: { id: string; title: string };
  /** False when no CONFIRMED Build Plan exists, so the plan is still derived. */
  hasConfirmedPlan: boolean;
  /** Why there is no confirmed plan. Null exactly when hasConfirmedPlan. */
  planBlocker: string | null;
};

/**
 * Load a tender and resolve its plan completeness in one place.
 *
 * The row selection and the confirmed-plan lookup are the contract between
 * this resolver and the database; every caller that duplicated them was one
 * more place the panel, the gates and the automatic pipeline could silently
 * disagree about how many files a package still owes. Callers that already
 * hold the tender in memory should call `resolveSubmissionPlanCompleteness`
 * directly instead of re-querying through this.
 *
 * Returns null when the tender does not exist for this user — the query is
 * user-scoped, so a cross-tenant id is indistinguishable from a missing one.
 */
export async function loadSubmissionPlanCompleteness(
  client: any,
  tenderId: string,
  userId: string,
): Promise<LoadedSubmissionPlanCompleteness | null> {
  const { getCurrentConfirmedBuildPlan } = await import("./build-plan");

  const tender = await client.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      exactFileNaming: true,
      exactFileOrder: true,
      pageLimit: true,
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
        },
      },
      generatedDocuments: {
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
          storagePath: true,
          contentSummary: true,
        },
      },
    },
  });
  if (!tender) return null;

  // Metadata-only: fileContent is deliberately not loaded. Deep byte/quality
  // checks belong to the export-readiness gate, which reads the bytes it is
  // about to package.
  const confirmedPlan = await getCurrentConfirmedBuildPlan(client, tenderId, userId);
  const report = resolveSubmissionPlanCompleteness({
    tender,
    generatedDocuments: tender.generatedDocuments.map((doc: GeneratedDocSnapshot) => ({ ...doc, fileContent: null })),
    qualityFailedIds: new Set<string>(),
    confirmedPlanItems: confirmedPlan.ok ? confirmedPlan.items : null,
  });

  return {
    report,
    tender: { id: tender.id, title: tender.title },
    hasConfirmedPlan: confirmedPlan.ok,
    planBlocker: confirmedPlan.ok ? null : confirmedPlan.blocker ?? null,
  };
}

export type SubmissionPlanCheckResult = {
  valid: boolean;
  reason?: string;
  plannedCount: number;
  confirmedCount: number;
};

export async function hasValidSubmissionPlan(
  client: any,
  tenderId: string,
): Promise<SubmissionPlanCheckResult> {
  const count = await client.generatedDocument.count({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
  });
  return {
    valid: count > 0,
    plannedCount: count,
    confirmedCount: count,
    reason: count > 0 ? undefined : "NO_SUBMISSION_PLAN",
  };
}
