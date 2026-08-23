import {
  deriveDocumentOutputState,
  exportBlockReason,
  isFinalExportCandidateDocument,
  isReviewReadyForExport,
  isValidationPassed,
  normalizeStatus,
  type DocumentLike,
  type DocumentOutputState,
} from "./document-output-state";
import {
  buildSubmissionPlanWithDerivedFallback,
  submissionPlanFileKey,
  type SubmissionEnvelope,
  type SubmissionPlanFile,
} from "./submission-plan";
import {
  isGroundedEvidenceInActiveFiles,
  type GroundingActiveFile,
} from "./evidence-grounding";
import { canUseVaultRecord, canUseVaultRecordField, partialVerificationSummary, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../vault-review-provenance";
import {
  evaluatePackageConformance,
  type PackageConformanceFacts,
  type PackageConformanceVerdict,
} from "./package-conformance";

export type FinalPackageBlocker = {
  area: "requirements" | "evidence" | "documents" | "export";
  code: string;
  title: string;
  documentName?: string;
  generatedDocumentId?: string | null;
  requirementId?: string | null;
  reason: string;
  nextAction: string;
};

export type RequirementEvidenceLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "WEAK" | "NONE";

export type RequirementEvidenceStatus = {
  requirementId: string;
  title: string;
  mandatory: boolean;
  selectedEvidenceCount: number;
  strongestEvidenceLevel: RequirementEvidenceLevel;
  hasSourceTrace: boolean;
  hasTrustedTrace: boolean;
  hasReviewedExpert: boolean;
  hasReviewedProject: boolean;
  displayStatus: "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "NEEDS_TRACE";
  blockerReason: string | null;
  /**
   * Set when the requirement is a submission RULE the package obeys or breaks
   * — financial separation, single-file consolidation, file format, file
   * naming — rather than a document the owner supplies. Null for every
   * ordinary evidence requirement.
   */
  packageRule: { family: string; status: string; reason: string } | null;
};

export type PlannedPackageDocument = {
  key: string;
  displayName: string;
  required: boolean;
  envelope: "technical" | "financial" | "common";
  expectedFormat: "DOCX" | "PDF" | "XLSX" | "CSV" | "ZIP" | "ORIGINAL";
  sourceRequirementIds: string[];
  generationMode: "generated" | "uploaded_original" | "manual_upload_required" | "not_applicable";
  generatedDocumentId: string | null;
  status: "missing" | "generated" | "valid" | "approved" | "export_ready" | "blocked" | "not_applicable";
  blockerReason: string | null;
};

export type GeneratedPackageDocument = {
  id: string;
  key: string | null;
  name: string;
  finalFileName: string;
  documentType: string;
  format: string;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  plannedDocumentKey: string | null;
  outputState: DocumentOutputState;
  exportCandidate: boolean;
  exportReady: boolean;
  blockerReason: string | null;
  exclusionReason: string | null;
  sizeBytes: number;
};

export type FinalZipManifest = {
  tenderId: string;
  files: Array<{
    plannedDocumentKey: string;
    finalFileName: string;
    sourceDocumentId: string | null;
    sourceUploadId: string | null;
    format: string;
    sizeBytes: number;
    envelope: "technical" | "financial" | "common";
    required: boolean;
    approved: boolean;
    exportReady: boolean;
    blockerReason: string | null;
  }>;
  missingRequiredFiles: string[];
  extraFilesExcluded: string[];
  ready: boolean;
};

export type FinalPackageReadinessModel = {
  tenderId: string;
  buildPlan: {
    id: string | null;
    confirmed: boolean;
    revision: number | null;
    contentHash: string | null;
    itemCount: number;
    source: "CONFIRMED" | "DERIVED_FALLBACK";
    blockerReason: string | null;
  };
  requirementEvidenceStatuses: RequirementEvidenceStatus[];
  projectMatchSummary: {
    selectedReviewed: number;
    highScoreSelected: number;
    belowThresholdSelected: number;
    missingComparableCoverage: number;
    explanation: string | null;
  };
  requirements: {
    total: number;
    mandatory: number;
    traced: number;
    mandatoryTraced: number;
    strongEvidence: number;
    weakEvidence: number;
    missingEvidence: number;
    coverageRatio: number;
    blockers: FinalPackageBlocker[];
  };
  evidence: {
    rows: number;
    selected: number;
    strong: number;
    substantial: number;
    weak: number;
    missing: number;
    expertMatches: number;
    reviewedExpertMatches: number;
    projectMatches: number;
    reviewedProjectMatches: number;
    blockers: FinalPackageBlocker[];
    // Defect 4: per-field trust warnings for partially-verified selected
    // records. These do NOT block export (the record is source-verified on
    // identity), but they warn the reviewer that some inferred fields are
    // non-authoritative and should not be cited in the final package.
    partialVerificationWarnings: string[];
  };
  documents: {
    planned: PlannedPackageDocument[];
    required: PlannedPackageDocument[];
    generated: GeneratedPackageDocument[];
    valid: GeneratedPackageDocument[];
    approved: GeneratedPackageDocument[];
    missingRequired: PlannedPackageDocument[];
    extraGeneratedOutsidePlan: GeneratedPackageDocument[];
    exportReady: GeneratedPackageDocument[];
    blockers: FinalPackageBlocker[];
  };
  export: {
    ready: boolean;
    zipReady: boolean;
    pdfRequired: boolean;
    pdfConversionAvailable: boolean;
    requiredPdfMissing: boolean;
    workspaceCount: number;
    exportCandidateCount: number;
    blockers: FinalPackageBlocker[];
    manifest: FinalZipManifest;
  };
  summary: {
    status: "draft_ready" | "generation_ready" | "review_required" | "export_blocked" | "export_ready";
    score: number;
    blockerCount: number;
    nextBestActions: string[];
  };
};

type RequirementLike = {
  id: string;
  title: string;
  // description and restrictions matter to package-rule classification: a
  // tender that states "two separate sealed envelopes" in the description and
  // nothing in the title must classify the same here as it does in the
  // coverage reconciler, or the two surfaces disagree about the same row.
  description?: string | null;
  restrictions?: string | null;
  priority?: string | null;
  requirementType?: string | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  complianceMatrixRows?: Array<{
    supportLevel?: string | null;
    evidenceType?: string | null;
    evidenceSource?: string | null;
  }>;
};

type MatchLike = {
  isSelected?: boolean | null;
  score?: number | null;
  expert?: ReviewRecordState | null;
  project?: ReviewRecordState | null;
};

type GeneratedDocLike = DocumentLike & {
  id: string;
  name?: string | null;
  exactOrder?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type BuildPlanRowLike = {
  id: string;
  status: string;
  revision: number;
  contentHash: string;
  confirmedRevision?: number | null;
  confirmedContentHash?: string | null;
  itemsJson?: string | null;
};

type BuildPlanAuthority = {
  confirmed: boolean;
  items: SubmissionPlanFile[];
  blockerReason: string | null;
};

const GENERATED_STATUS = new Set(["GENERATED", "UPLOADED", "ATTACHED", "READY_FOR_EXPORT"]);
const SUBMISSION_PLAN_FORMATS = new Set(["DOCX", "PDF", "ZIP", "XLSX", "OTHER"]);
const SUBMISSION_ENVELOPES = new Set(["TECHNICAL", "FINANCIAL", "ADMIN"]);

function hasText(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function activeStatus(value?: string | null): string {
  return normalizeStatus(value);
}

function byteSize(doc: {
  fileContent?: string | null;
  storagePath?: string | null;
  hasInlineFileContent?: boolean | null;
}): number {
  if (hasText(doc.fileContent)) return Buffer.byteLength(doc.fileContent ?? "", "utf8");
  // Storage-backed rows are real bytes but this dashboard/readiness model does
  // not load private blobs. Download and export routes validate actual bytes.
  if (hasText(doc.storagePath) || doc.hasInlineFileContent) return 1;
  return 0;
}

function envelope(value: SubmissionEnvelope): PlannedPackageDocument["envelope"] {
  if (value === "FINANCIAL") return "financial";
  if (value === "ADMIN") return "common";
  return "technical";
}

function expectedFormat(value?: string | null): PlannedPackageDocument["expectedFormat"] {
  const format = activeStatus(value);
  if (["PDF", "XLSX", "CSV", "ZIP", "ORIGINAL"].includes(format)) {
    return format as PlannedPackageDocument["expectedFormat"];
  }
  return "DOCX";
}

function keyForDocument(doc: { exactFileName?: string | null; name?: string | null }): string {
  return submissionPlanFileKey(doc.exactFileName ?? doc.name ?? "");
}

function evidenceRank(level: RequirementEvidenceLevel): number {
  return { NONE: 0, WEAK: 1, PARTIAL: 2, SUBSTANTIAL: 3, FULL: 4 }[level];
}

function mapSupportLevel(value?: string | null): RequirementEvidenceLevel {
  const level = activeStatus(value);
  if (level === "FULL") return "FULL";
  if (level === "SUBSTANTIAL") return "SUBSTANTIAL";
  if (level === "PARTIAL") return "PARTIAL";
  if (level === "WEAK") return "WEAK";
  return "NONE";
}

function isMandatoryRequirement(requirement: { priority?: string | null }): boolean {
  return ["MANDATORY", "CRITICAL"].includes(activeStatus(requirement.priority));
}

function strongestSupportLevel(rows: Array<{ supportLevel?: string | null }>): RequirementEvidenceLevel {
  return rows
    .map((row) => mapSupportLevel(row.supportLevel))
    .sort((left, right) => evidenceRank(right) - evidenceRank(left))[0] ?? "NONE";
}

function hasRequirementSourceTrace(
  requirement: RequirementLike,
  activeFiles: ReadonlyArray<GroundingActiveFile>,
): boolean {
  return isGroundedEvidenceInActiveFiles(
    requirement.sourcePageNumber,
    requirement.sourceExactQuote,
    requirement.sourceTenderFileId,
    activeFiles,
  );
}

// This model gates the FINAL package/export decision, so it uses
// canUseVaultRecord's "EXPORT" purpose — durably human-REVIEWED evidence,
// or a durably machine-SOURCE_VERIFIED record once EXPORT accepts that too
// (see canUseVaultRecord in vault-review-provenance.ts).
function selectedReviewedExperts(matches: MatchLike[]): number {
  return matches.filter((match) => match.isSelected && match.expert && canUseVaultRecord(match.expert, "EXPORT")).length;
}

function selectedReviewedProjects(matches: MatchLike[]): number {
  return matches.filter((match) => match.isSelected && match.project && canUseVaultRecord(match.project, "EXPORT")).length;
}

/**
 * Defect 4: collect partial-verification warnings for selected experts and
 * projects. A partially-verified record is SOURCE_VERIFIED on its identity
 * but has some inferred fields that could not be verified against source
 * text. The record is still usable for export (identity is proven), but the
 * unverified inferred fields should not be cited as authoritative in the
 * final package.
 *
 * Returns an array of warning strings, one per partially-verified selected
 * record, naming the record and its unverified fields.
 */
function partialVerificationWarnings(
  expertMatches: MatchLike[],
  projectMatches: MatchLike[],
): string[] {
  const warnings: string[] = [];
  for (const match of expertMatches) {
    if (!match.isSelected || !match.expert) continue;
    const expert = match.expert as ReviewRecordState;
    if (!canUseVaultRecord(expert, "EXPORT")) continue;
    const summary = partialVerificationSummary(expert, "EXPERT");
    if (summary.partial) {
      const name = (expert as { fullName?: string }).fullName ?? "unknown";
      warnings.push(`Expert "${name}" is source-verified on identity but ${summary.unverifiedFields.length} inferred field(s) are unverified: ${summary.unverifiedFields.join(", ")}. Do not cite these fields as authoritative in the final package.`);
    }
  }
  for (const match of projectMatches) {
    if (!match.isSelected || !match.project) continue;
    const project = match.project as ReviewRecordState;
    if (!canUseVaultRecord(project, "EXPORT")) continue;
    const summary = partialVerificationSummary(project, "PROJECT");
    if (summary.partial) {
      const name = (project as { name?: string }).name ?? "unknown";
      warnings.push(`Project "${name}" is source-verified on identity but ${summary.unverifiedFields.length} inferred field(s) are unverified: ${summary.unverifiedFields.join(", ")}. Do not cite these fields as authoritative in the final package.`);
    }
  }
  return warnings;
}

function documentOutputBlockReason(document: DocumentLike): string | null {
  return exportBlockReason(deriveDocumentOutputState(document));
}

function chooseBestGeneratedDocument(documents: GeneratedDocLike[]): GeneratedDocLike | null {
  if (documents.length === 0) return null;
  const scored = documents.map((document, index) => {
    const state = deriveDocumentOutputState(document);
    const score = (state === "READY_FOR_EXPORT" ? 100 : 0)
      + (isReviewReadyForExport(document.reviewStatus) ? 30 : 0)
      + (isValidationPassed(document.validationStatus) ? 20 : 0)
      + (isFinalExportCandidateDocument(document) ? 10 : 0)
      + (byteSize(document) > 0 ? 5 : 0)
      - (activeStatus(document.generationStatus) === "SUPERSEDED" ? 1000 : 0);
    return { document, score, index };
  });
  scored.sort((left, right) => right.score - left.score || right.index - left.index);
  return scored[0]?.document ?? null;
}

function generatedDocumentExclusionReason(
  document: GeneratedDocLike,
  plannedDocumentKey: string | null,
): string | null {
  if (!plannedDocumentKey) return "outside submission plan";
  if (
    activeStatus(document.generationStatus) === "SUPERSEDED"
    || activeStatus(document.validationStatus) === "SUPERSEDED"
  ) {
    return "superseded";
  }
  if (!isFinalExportCandidateDocument(document)) {
    const reviewStatus = activeStatus(document.reviewStatus);
    if (reviewStatus === "REPLACE_WITH_ORIGINAL") return "tender-issued form not found in Tender Intake";
    if (reviewStatus === "NOT_EXPORTABLE") return "not required by tender or marked not exportable";
    if (activeStatus(document.format) === "CONTROL") return "control/replacement row only";
    return "draft only or not a final export candidate";
  }
  const state = deriveDocumentOutputState(document);
  if (state === "READY_FOR_EXPORT") return null;
  if (state === "PDF_CONVERSION_REQUIRED") return "wrong format: PDF required but final PDF is not attached";
  if (!isValidationPassed(document.validationStatus)) return "not validated";
  if (!isReviewReadyForExport(document.reviewStatus)) return "not approved";
  if (byteSize(document) === 0) return "zero-byte or missing file bytes";
  return exportBlockReason(state) ?? "not export-ready";
}

function plannedStatusFor(
  document: GeneratedDocLike | null,
  file: SubmissionPlanFile,
): Pick<PlannedPackageDocument, "status" | "blockerReason" | "generationMode"> {
  const mode: PlannedPackageDocument["generationMode"] = file.templateRequired
    ? "manual_upload_required"
    : "generated";

  if (!document) {
    return {
      status: file.required ? "missing" : "not_applicable",
      generationMode: mode,
      blockerReason: file.required
        ? `${file.exactFileName} is planned as required but has not been generated or uploaded.`
        : null,
    };
  }

  const state = deriveDocumentOutputState(document);
  const format = expectedFormat(file.format);
  if (format === "PDF" && activeStatus(document.format) !== "PDF") {
    return {
      status: "blocked",
      generationMode: "manual_upload_required",
      blockerReason: `${file.exactFileName} requires PDF but current document format is ${document.format ?? "unknown"}. Upload an approved final PDF mapped to this planned document.`,
    };
  }
  if (state === "READY_FOR_EXPORT" && byteSize(document) > 0) {
    return { status: "export_ready", generationMode: mode, blockerReason: null };
  }
  if (isReviewReadyForExport(document.reviewStatus)) {
    return { status: "approved", generationMode: mode, blockerReason: documentOutputBlockReason(document) };
  }
  if (isValidationPassed(document.validationStatus)) {
    return { status: "valid", generationMode: mode, blockerReason: documentOutputBlockReason(document) };
  }
  if (GENERATED_STATUS.has(activeStatus(document.generationStatus))) {
    return { status: "generated", generationMode: mode, blockerReason: documentOutputBlockReason(document) };
  }
  return {
    status: "blocked",
    generationMode: mode,
    blockerReason: documentOutputBlockReason(document) ?? "Generated row is not usable for final packaging.",
  };
}

export function mapRequirementsToEvidence(
  requirements: RequirementLike[],
  expertMatches: MatchLike[] = [],
  projectMatches: MatchLike[] = [],
  activeFiles: ReadonlyArray<GroundingActiveFile> = [],
  // Optional: when the caller knows the current package, submission RULES are
  // reported as rules rather than as missing evidence. Omitting it preserves
  // the previous wording exactly.
  packageFacts?: PackageConformanceFacts,
): RequirementEvidenceStatus[] {
  const hasReviewedExpert = selectedReviewedExperts(expertMatches) > 0;
  const hasReviewedProject = selectedReviewedProjects(projectMatches) > 0;

  return requirements.map((requirement) => {
    const links = requirement.complianceMatrixRows ?? [];
    const strongestEvidenceLevel = strongestSupportLevel(links);
    const mandatory = isMandatoryRequirement(requirement);
    const hasSourceTrace = hasRequirementSourceTrace(requirement, activeFiles);
    const hasTrustedTrace = hasSourceTrace
      && evidenceRank(strongestEvidenceLevel) >= evidenceRank("PARTIAL");
    const hasStrongEvidence = evidenceRank(strongestEvidenceLevel) >= evidenceRank("SUBSTANTIAL");
    const displayStatus = !hasTrustedTrace && evidenceRank(strongestEvidenceLevel) >= evidenceRank("PARTIAL")
      ? "NEEDS_TRACE"
      : hasTrustedTrace && hasStrongEvidence
        ? "FULLY_MET"
        : hasTrustedTrace && strongestEvidenceLevel === "PARTIAL"
          ? "PARTIALLY_MET"
          : "NOT_MET";
    const conformance: PackageConformanceVerdict | null = packageFacts
      ? evaluatePackageConformance(
          {
            title: requirement.title,
            description: requirement.description ?? null,
            restrictions: requirement.restrictions ?? null,
            requirementType: requirement.requirementType ?? null,
          },
          packageFacts,
        )
      : null;
    const isPackageRule = Boolean(conformance?.applicable);
    const blockerReason = displayStatus === "FULLY_MET"
      ? null
      // A submission rule is never short of evidence — it is obeyed, broken, or
      // not yet observable. Telling the owner that "no evidence is traced to
      // this requirement" for "Financial Proposal Omission" asks for a document
      // that must never exist.
      : isPackageRule
        ? conformance!.reason
        : links.length === 0
          ? "No selected or linked evidence is traced to this requirement."
          : !hasTrustedTrace
            ? "Requirement lacks active source-file, page, and exact-quote containment, so linked evidence is not trusted."
            : "Linked evidence is only PARTIAL; FULL or SUBSTANTIAL support is required.";

    return {
      requirementId: requirement.id,
      title: requirement.title,
      mandatory,
      selectedEvidenceCount: links.length,
      strongestEvidenceLevel,
      hasSourceTrace,
      hasTrustedTrace,
      hasReviewedExpert,
      hasReviewedProject,
      displayStatus,
      blockerReason,
      packageRule: conformance?.applicable
        ? { family: String(conformance.family), status: conformance.status, reason: conformance.reason }
        : null,
    };
  });
}

function derivePlannedPackageDocumentsFromFiles(
  files: SubmissionPlanFile[],
  generated: GeneratedDocLike[] = [],
): PlannedPackageDocument[] {
  const documentsByKey = new Map<string, GeneratedDocLike[]>();
  for (const document of generated) {
    const key = keyForDocument(document);
    if (!key) continue;
    const documents = documentsByKey.get(key) ?? [];
    documents.push(document);
    documentsByKey.set(key, documents);
  }

  return files.map((file) => {
    const key = submissionPlanFileKey(file.exactFileName);
    const document = chooseBestGeneratedDocument(documentsByKey.get(key) ?? []);
    const derived = plannedStatusFor(document, file);
    return {
      key,
      displayName: file.exactFileName,
      required: file.required,
      envelope: envelope(file.envelope),
      expectedFormat: expectedFormat(file.format),
      sourceRequirementIds: file.sourceRequirementIds,
      generationMode: derived.generationMode,
      generatedDocumentId: document?.id ?? null,
      status: derived.status,
      blockerReason: derived.blockerReason,
    };
  });
}

export function deriveRequiredPackageDocuments(
  tender: { id: string; requirements?: RequirementLike[] } & Record<string, unknown>,
  generated: GeneratedDocLike[] = [],
): PlannedPackageDocument[] {
  const plan = buildSubmissionPlanWithDerivedFallback({
    ...tender,
    requirements: (tender.requirements ?? []).map((requirement) => ({
      ...requirement,
      title: requirement.title,
      requirementType: requirement.requirementType ?? "TECHNICAL",
      priority: requirement.priority ?? "OPTIONAL",
    })),
  });
  return derivePlannedPackageDocumentsFromFiles(plan.files, generated);
}

function parseConfirmedBuildPlan(row: BuildPlanRowLike | null | undefined): BuildPlanAuthority {
  if (!row || activeStatus(row.status) !== "CONFIRMED") {
    return {
      confirmed: false,
      items: [],
      blockerReason: "No source-verified Build Plan exists for the current tender. Run Engine creates it automatically.",
    };
  }
  if (
    row.confirmedRevision !== row.revision
    || !row.confirmedContentHash
    || row.confirmedContentHash !== row.contentHash
  ) {
    return {
      confirmed: false,
      items: [],
      blockerReason: "The Build Plan verification no longer matches its current revision or content hash. Run Engine must rebuild it.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.itemsJson ?? "[]");
  } catch {
    return {
      confirmed: false,
      items: [],
      blockerReason: "The source-verified Build Plan items are malformed.",
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      confirmed: false,
      items: [],
      blockerReason: "The source-verified Build Plan contains no package items.",
    };
  }

  const items = parsed.filter((item): item is SubmissionPlanFile => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<SubmissionPlanFile>;
    return typeof candidate.canonicalId === "string"
      && candidate.canonicalId.trim().length > 0
      && typeof candidate.exactFileName === "string"
      && candidate.exactFileName.trim().length > 0
      && typeof candidate.documentType === "string"
      && typeof candidate.required === "boolean"
      && typeof candidate.exactOrder === "number"
      && SUBMISSION_PLAN_FORMATS.has(String(candidate.format))
      && SUBMISSION_ENVELOPES.has(String(candidate.envelope))
      && Array.isArray(candidate.sourceRequirementIds);
  });
  if (items.length !== parsed.length) {
    return {
      confirmed: false,
      items: [],
      blockerReason: "One or more source-verified Build Plan items are invalid.",
    };
  }
  return { confirmed: true, items, blockerReason: null };
}

export function mapGeneratedDocumentsToSubmissionPlan(
  generated: GeneratedDocLike[],
  planned: PlannedPackageDocument[],
): GeneratedPackageDocument[] {
  const plannedByKey = new Map(planned.map((document) => [document.key, document]));
  return generated.map((document) => {
    const key = keyForDocument(document);
    const plannedDocumentKey = plannedByKey.has(key) ? key : null;
    const outputState = deriveDocumentOutputState(document);
    const exportCandidate = Boolean(plannedDocumentKey) && isFinalExportCandidateDocument(document);
    const exportReady = exportCandidate && outputState === "READY_FOR_EXPORT" && byteSize(document) > 0;
    const exclusionReason = generatedDocumentExclusionReason(document, plannedDocumentKey);
    return {
      id: document.id,
      key: key || null,
      name: document.name ?? document.exactFileName ?? document.id,
      finalFileName: document.exactFileName ?? document.name ?? `${document.id}.docx`,
      documentType: document.documentType ?? "",
      format: activeStatus(document.format) || expectedFormat(document.exactFileName),
      generationStatus: document.generationStatus ?? "",
      validationStatus: document.validationStatus ?? "",
      reviewStatus: document.reviewStatus ?? "",
      plannedDocumentKey,
      outputState,
      exportCandidate,
      exportReady,
      blockerReason: exportReady ? null : documentOutputBlockReason(document) ?? exclusionReason,
      exclusionReason,
      sizeBytes: byteSize(document),
    };
  });
}

export function detectDocumentsOutsidePlan(
  generated: GeneratedPackageDocument[],
): GeneratedPackageDocument[] {
  return generated.filter((document) => !document.plannedDocumentKey);
}

export function detectMissingRequiredDocuments(
  planned: PlannedPackageDocument[],
): PlannedPackageDocument[] {
  return planned.filter((document) => document.required && document.status === "missing");
}

export function detectPdfExportRequirements(
  planned: PlannedPackageDocument[],
  generated: GeneratedPackageDocument[],
) {
  const requiredPdf = planned.filter(
    (document) => document.required && document.expectedFormat === "PDF",
  );
  const missing = requiredPdf.filter(
    (document) => !generated.some(
      (generatedDocument) => generatedDocument.plannedDocumentKey === document.key
        && generatedDocument.format === "PDF"
        && generatedDocument.exportReady,
    ),
  );
  return {
    pdfRequired: requiredPdf.length > 0,
    pdfConversionAvailable: false,
    requiredPdfMissing: missing.length > 0,
    missing,
  };
}

export function buildFinalZipManifestFromModel(
  tenderId: string,
  planned: PlannedPackageDocument[],
  generated: GeneratedPackageDocument[],
): FinalZipManifest {
  const files = planned
    .filter((document) => document.status !== "not_applicable")
    .map((plannedDocument) => {
      const document = generated.find(
        (candidate) => candidate.plannedDocumentKey === plannedDocument.key && candidate.exportReady,
      )
        ?? generated.find(
          (candidate) => candidate.plannedDocumentKey === plannedDocument.key && candidate.exportCandidate,
        )
        ?? generated.find((candidate) => candidate.plannedDocumentKey === plannedDocument.key)
        ?? null;
      // `approved` is retained as truthful human-review audit metadata. It is
      // deliberately not machine export eligibility: routine output becomes
      // eligible when the canonical validator passes, while legal/signature
      // release blockers are enforced separately at tender level.
      const approved = document ? isReviewReadyForExport(document.reviewStatus) : false;
      const formatMatches = !document || document.format === plannedDocument.expectedFormat;
      const exportReady = Boolean(
        document?.exportReady && document.sizeBytes > 0 && formatMatches,
      );
      return {
        plannedDocumentKey: plannedDocument.key,
        finalFileName: plannedDocument.displayName,
        sourceDocumentId: document?.id ?? null,
        sourceUploadId: null,
        format: document?.format ?? plannedDocument.expectedFormat,
        sizeBytes: document?.sizeBytes ?? 0,
        envelope: plannedDocument.envelope,
        required: plannedDocument.required,
        approved,
        exportReady,
        blockerReason: exportReady || !plannedDocument.required
          ? null
          : plannedDocument.blockerReason
            ?? document?.blockerReason
            ?? `${plannedDocument.displayName} is not ready for ZIP export.`,
      };
    });

  const seenNames = new Set<string>();
  const duplicates: string[] = [];
  for (const file of files) {
    const key = file.finalFileName.toLowerCase();
    if (seenNames.has(key)) duplicates.push(file.finalFileName);
    seenNames.add(key);
  }

  const missingRequiredFiles = [
    ...files
      .filter((file) => file.required && !file.exportReady)
      .map((file) => file.finalFileName),
    ...duplicates.map((name) => `Duplicate filename: ${name}`),
  ];

  return {
    tenderId,
    files,
    missingRequiredFiles,
    extraFilesExcluded: generated
      .filter((document) => !document.plannedDocumentKey)
      .map(
        (document) => `${document.finalFileName}: ${document.exclusionReason ?? "outside submission plan"}`,
      ),
    ready: missingRequiredFiles.length === 0,
  };
}

function buildDocumentBlockers(
  planned: PlannedPackageDocument[],
): FinalPackageBlocker[] {
  return planned
    .filter((document) => document.required && document.blockerReason)
    .map((document) => ({
      area: "documents" as const,
      code: document.status === "missing"
        ? "PLANNED_DOCUMENT_MISSING"
        : document.expectedFormat === "PDF"
          ? "PDF_REQUIRED_NOT_READY"
          : "PLANNED_DOCUMENT_BLOCKED",
      title: document.displayName,
      documentName: document.displayName,
      generatedDocumentId: document.generatedDocumentId,
      reason: document.blockerReason ?? "Required document is not ready.",
      nextAction: document.status === "missing"
        ? "Generate the planned document or upload the required original."
        : document.expectedFormat === "PDF"
          ? "Upload an approved final PDF mapped to this planned document."
          : "Validate, review, and approve this document.",
    }));
}

function buildRequirementBlockers(
  statuses: RequirementEvidenceStatus[],
): FinalPackageBlocker[] {
  return statuses
    .filter((status) => status.mandatory && status.displayStatus !== "FULLY_MET")
    .map((status) => {
      // A submission rule still blocks release when it is broken or not yet
      // observable — fail-closed is unchanged — but the next action is to
      // correct the PACKAGE, never to upload evidence that cannot exist.
      if (status.packageRule) {
        return {
          area: "requirements" as const,
          code: status.packageRule.status === "VIOLATED"
            ? "SUBMISSION_RULE_BROKEN_BY_PACKAGE"
            : "SUBMISSION_RULE_AWAITING_PACKAGE",
          title: status.title,
          requirementId: status.requirementId,
          reason: status.packageRule.reason,
          nextAction: status.packageRule.status === "VIOLATED"
            ? `Correct the package so it obeys the submission rule: ${status.title}`
            : `No owner action: ${status.title} is verified automatically once the package is produced.`,
        };
      }
      return {
        area: "requirements" as const,
        code: "MANDATORY_REQUIREMENT_EVIDENCE_NOT_TRUSTED",
        title: status.title,
        requirementId: status.requirementId,
        reason: status.blockerReason ?? "Mandatory requirement lacks trusted traced evidence.",
        nextAction: `Add trusted traced evidence for mandatory requirement: ${status.title}`,
      };
    });
}

function deriveSummaryStatus(args: {
  manifestReady: boolean;
  missingRequired: number;
  documentBlockers: number;
  requirementBlockers: number;
  generatedCount: number;
}): FinalPackageReadinessModel["summary"]["status"] {
  if (args.manifestReady) return "export_ready";
  if (args.missingRequired > 0) return "generation_ready";
  if (args.documentBlockers > 0 || args.requirementBlockers > 0) return "review_required";
  if (args.generatedCount === 0) return "draft_ready";
  return "export_blocked";
}

/**
 * getFinalPackageReadinessModel — prisma client typing.
 *
 * The `prisma` parameter is intentionally typed as `any` rather than
 * `PrismaClient` so unit tests can pass a minimal mock object that
 * implements only `tender.findFirst` and (optionally) `buildPlan.findFirst`.
 * The production runtime passes the real PrismaClient from lib/prisma.ts.
 *
 * A structural interface (e.g. `{ tender: { findFirst: ... } }`) was attempted
 * but broke down because the function body reads specific columns off the
 * returned tender (requirements, expertMatches, projectMatches, etc.) that
 * would each need their own structural type, and the test mocks return
 * partial shapes that don't match any strict type.
 *
 * If you change the queries inside this function, update the test mocks in
 * tests/final-package-readiness-model.test.ts to match.
 */
export async function getFinalPackageReadinessModel(
  prisma: any,
  tenderId: string,
  userId: string,
): Promise<FinalPackageReadinessModel> {
  const [tender, buildPlanRow] = await Promise.all([
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
        submissionMethod: true,
        category: true,
        analysisExtractionStatus: true,
        requirements: { include: { complianceMatrixRows: true } },
        files: {
          where: { deletionStatus: "ACTIVE" },
          select: { id: true, extractedText: true, totalPages: true },
        },
        generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
        expertMatches: { include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } },
        projectMatches: { include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } },
      },
    }),
    prisma.buildPlan?.findFirst
      ? prisma.buildPlan.findFirst({
          where: { tenderId },
          orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            status: true,
            revision: true,
            contentHash: true,
            confirmedRevision: true,
            confirmedContentHash: true,
            itemsJson: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!tender) throw new Error("Tender not found");

  const buildPlanAuthority = parseConfirmedBuildPlan(buildPlanRow);
  const requirementEvidenceStatuses = mapRequirementsToEvidence(
    tender.requirements,
    tender.expertMatches,
    tender.projectMatches,
    tender.files,
    {
      documents: tender.generatedDocuments,
      plannedFileNames: buildPlanAuthority.items.map((item) => item.exactFileName),
      planConfirmed: buildPlanAuthority.confirmed,
    },
  );
  const planned = buildPlanAuthority.confirmed
    ? derivePlannedPackageDocumentsFromFiles(
        buildPlanAuthority.items,
        tender.generatedDocuments,
      )
    : deriveRequiredPackageDocuments(tender, tender.generatedDocuments);
  const generated = mapGeneratedDocumentsToSubmissionPlan(
    tender.generatedDocuments,
    planned,
  );
  const missingRequired = detectMissingRequiredDocuments(planned);
  const extraGeneratedOutsidePlan = detectDocumentsOutsidePlan(generated);
  const pdfRequirements = detectPdfExportRequirements(planned, generated);
  const documentBlockers = buildDocumentBlockers(planned);
  const requirementBlockers = buildRequirementBlockers(requirementEvidenceStatuses);
  const documentManifest = buildFinalZipManifestFromModel(tenderId, planned, generated);
  const manifest: FinalZipManifest = {
    ...documentManifest,
    ready: buildPlanAuthority.confirmed && documentManifest.ready,
  };
  const buildPlanBlocker: FinalPackageBlocker | null = buildPlanAuthority.confirmed
    ? null
    : {
        area: "export",
        code: "NO_CONFIRMED_BUILD_PLAN",
        title: "Source-verified Build Plan required",
        reason: buildPlanAuthority.blockerReason
          ?? "No source-verified Build Plan exists for the current tender. Run Engine creates it automatically.",
        nextAction: "Build, review, and confirm the current Build Plan before generation or export.",
      };
  const exportBlockers: FinalPackageBlocker[] = [
    ...(buildPlanBlocker ? [buildPlanBlocker] : []),
    ...documentManifest.missingRequiredFiles.map((name) => ({
      area: "export" as const,
      code: "FINAL_ZIP_FILE_NOT_READY",
      title: name,
      documentName: name,
      reason: `${name} is missing, duplicate, wrong format, zero-byte, or unapproved.`,
      nextAction: "Resolve the document blocker and re-check final ZIP readiness.",
    })),
  ];

  const selectedProjects = tender.projectMatches.filter(
    (match: MatchLike) => match.isSelected,
  );
  const reviewedSelectedProjects = selectedReviewedProjects(tender.projectMatches);
  const highScoreSelectedProjects = selectedProjects.filter(
    (match: MatchLike) => Number(match.score ?? 0) >= 90,
  ).length;
  const belowThresholdSelectedProjects = selectedProjects.filter(
    (match: MatchLike) => Number(match.score ?? 0) < 90,
  ).length;
  const blockerCount = requirementBlockers.length
    + documentBlockers.length
    + exportBlockers.length;
  const status = deriveSummaryStatus({
    manifestReady: manifest.ready,
    missingRequired: missingRequired.length,
    documentBlockers: documentBlockers.length,
    requirementBlockers: requirementBlockers.length,
    generatedCount: generated.length,
  });

  return {
    tenderId,
    buildPlan: {
      id: buildPlanRow?.id ?? null,
      confirmed: buildPlanAuthority.confirmed,
      revision: buildPlanRow?.revision ?? null,
      contentHash: buildPlanRow?.contentHash ?? null,
      itemCount: buildPlanAuthority.items.length,
      source: buildPlanAuthority.confirmed ? "CONFIRMED" : "DERIVED_FALLBACK",
      blockerReason: buildPlanAuthority.blockerReason,
    },
    requirementEvidenceStatuses,
    projectMatchSummary: {
      selectedReviewed: reviewedSelectedProjects,
      highScoreSelected: highScoreSelectedProjects,
      belowThresholdSelected: belowThresholdSelectedProjects,
      missingComparableCoverage: tender.requirements.some(
        (requirement: RequirementLike) => activeStatus(requirement.requirementType) === "PROJECT_EXPERIENCE",
      ) && reviewedSelectedProjects === 0
        ? 1
        : 0,
      explanation: reviewedSelectedProjects > 0 && highScoreSelectedProjects === 0
        ? "Selected projects are reviewed but below 90% match; improve relevance or accept with justification."
        : null,
    },
    requirements: {
      total: requirementEvidenceStatuses.length,
      mandatory: requirementEvidenceStatuses.filter((item) => item.mandatory).length,
      traced: requirementEvidenceStatuses.filter((item) => item.hasSourceTrace).length,
      mandatoryTraced: requirementEvidenceStatuses.filter(
        (item) => item.mandatory && item.hasSourceTrace,
      ).length,
      strongEvidence: requirementEvidenceStatuses.filter(
        (item) => item.displayStatus === "FULLY_MET",
      ).length,
      weakEvidence: requirementEvidenceStatuses.filter(
        (item) => ["WEAK", "PARTIAL"].includes(item.strongestEvidenceLevel),
      ).length,
      missingEvidence: requirementEvidenceStatuses.filter(
        (item) => item.strongestEvidenceLevel === "NONE",
      ).length,
      coverageRatio: requirementEvidenceStatuses.length
        ? requirementEvidenceStatuses.filter((item) => item.displayStatus === "FULLY_MET").length
          / requirementEvidenceStatuses.length
        : 0,
      blockers: requirementBlockers,
    },
    evidence: {
      rows: tender.requirements.reduce(
        (sum: number, requirement: RequirementLike) => sum
          + (requirement.complianceMatrixRows?.length ?? 0),
        0,
      ),
      selected: tender.requirements.reduce(
        (sum: number, requirement: RequirementLike) => sum
          + (requirement.complianceMatrixRows?.length ?? 0),
        0,
      ),
      strong: requirementEvidenceStatuses.filter(
        (item) => item.displayStatus === "FULLY_MET"
          && item.strongestEvidenceLevel === "FULL",
      ).length,
      substantial: requirementEvidenceStatuses.filter(
        (item) => item.displayStatus === "FULLY_MET"
          && item.strongestEvidenceLevel === "SUBSTANTIAL",
      ).length,
      weak: requirementEvidenceStatuses.filter(
        (item) => ["WEAK", "PARTIAL"].includes(item.strongestEvidenceLevel),
      ).length,
      missing: requirementEvidenceStatuses.filter(
        (item) => item.strongestEvidenceLevel === "NONE",
      ).length,
      expertMatches: tender.expertMatches.length,
      reviewedExpertMatches: selectedReviewedExperts(tender.expertMatches),
      projectMatches: tender.projectMatches.length,
      reviewedProjectMatches: reviewedSelectedProjects,
      blockers: requirementBlockers,
      // Defect 4: surface partial-verification warnings for selected experts
      // and projects. Non-blocking — the record is source-verified on identity.
      partialVerificationWarnings: partialVerificationWarnings(tender.expertMatches, tender.projectMatches),
    },
    documents: {
      planned,
      required: planned.filter((document) => document.required),
      generated,
      valid: generated.filter((document) => isValidationPassed(document.validationStatus)),
      approved: generated.filter((document) => isReviewReadyForExport(document.reviewStatus)),
      missingRequired,
      extraGeneratedOutsidePlan,
      exportReady: generated.filter((document) => document.exportReady),
      blockers: documentBlockers,
    },
    export: {
      ready: manifest.ready,
      zipReady: manifest.ready,
      pdfRequired: pdfRequirements.pdfRequired,
      pdfConversionAvailable: pdfRequirements.pdfConversionAvailable,
      requiredPdfMissing: pdfRequirements.requiredPdfMissing,
      workspaceCount: generated.length,
      exportCandidateCount: generated.filter((document) => document.exportCandidate).length,
      blockers: exportBlockers,
      manifest,
    },
    summary: {
      status,
      score: Math.max(
        0,
        Math.min(
          100,
          Math.round(100 - blockerCount * 12 - missingRequired.length * 8),
        ),
      ),
      blockerCount,
      nextBestActions: [
        ...requirementBlockers,
        ...documentBlockers,
        ...exportBlockers,
      ].slice(0, 8).map((blocker) => blocker.nextAction),
    },
  };
}
