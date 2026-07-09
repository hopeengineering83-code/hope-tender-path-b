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
import { buildSubmissionPlanWithDerivedFallback, submissionPlanFileKey, type SubmissionEnvelope, type SubmissionPlanFile } from "./submission-plan";

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
  hasTrustedTrace: boolean;
  hasReviewedExpert: boolean;
  hasReviewedProject: boolean;
  blockerReason: string | null;
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
  priority?: string | null;
  requirementType?: string | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  complianceMatrixRows?: Array<{ supportLevel?: string | null; evidenceType?: string | null; evidenceSource?: string | null }>;
};

type MatchLike = {
  isSelected?: boolean | null;
  score?: number | null;
  expert?: { trustLevel?: string | null } | null;
  project?: { trustLevel?: string | null } | null;
};

type GeneratedDocLike = DocumentLike & {
  id: string;
  name?: string | null;
  exactOrder?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

const GENERATED_STATUS = new Set(["GENERATED", "UPLOADED", "ATTACHED", "READY_FOR_EXPORT"]);

function hasText(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function activeStatus(value?: string | null): string {
  return normalizeStatus(value);
}

function byteSize(doc: { fileContent?: string | null; storagePath?: string | null; hasInlineFileContent?: boolean | null }): number {
  if (hasText(doc.fileContent)) return Buffer.byteLength(doc.fileContent ?? "", "utf8");
  // Storage-backed rows are real bytes but the dashboard model intentionally
  // does not read private blobs. Use 1 as a non-zero byte sentinel; download
  // and export routes still validate the actual object bytes before serving.
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
  if (["PDF", "XLSX", "CSV", "ZIP", "ORIGINAL"].includes(format)) return format as PlannedPackageDocument["expectedFormat"];
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

function isMandatoryRequirement(req: { priority?: string | null }): boolean {
  return ["MANDATORY", "CRITICAL"].includes(activeStatus(req.priority));
}

function strongestSupportLevel(rows: Array<{ supportLevel?: string | null }>): RequirementEvidenceLevel {
  return rows
    .map((row) => mapSupportLevel(row.supportLevel))
    .sort((a, b) => evidenceRank(b) - evidenceRank(a))[0] ?? "NONE";
}

function hasRequirementSourceTrace(req: RequirementLike): boolean {
  return hasText(req.sourceTenderFileId) && typeof req.sourcePageNumber === "number" && req.sourcePageNumber > 0 && hasText(req.sourceExactQuote);
}

function selectedReviewedExperts(matches: MatchLike[]): number {
  return matches.filter((m) => m.isSelected && m.expert?.trustLevel === "REVIEWED").length;
}

function selectedReviewedProjects(matches: MatchLike[]): number {
  return matches.filter((m) => m.isSelected && m.project?.trustLevel === "REVIEWED").length;
}

function documentOutputBlockReason(doc: DocumentLike): string | null {
  const state = deriveDocumentOutputState(doc);
  return exportBlockReason(state);
}

function chooseBestGeneratedDocument(docs: GeneratedDocLike[]): GeneratedDocLike | null {
  if (docs.length === 0) return null;
  const scored = docs.map((doc, index) => {
    const state = deriveDocumentOutputState(doc);
    const score = (state === "READY_FOR_EXPORT" ? 100 : 0)
      + (isReviewReadyForExport(doc.reviewStatus) ? 30 : 0)
      + (isValidationPassed(doc.validationStatus) ? 20 : 0)
      + (isFinalExportCandidateDocument(doc) ? 10 : 0)
      + (byteSize(doc) > 0 ? 5 : 0)
      - (activeStatus(doc.generationStatus) === "SUPERSEDED" ? 1000 : 0);
    return { doc, score, index };
  });
  scored.sort((a, b) => b.score - a.score || b.index - a.index);
  return scored[0]?.doc ?? null;
}

function generatedDocumentExclusionReason(doc: GeneratedDocLike, plannedKey: string | null): string | null {
  if (!plannedKey) return "outside submission plan";
  if (activeStatus(doc.generationStatus) === "SUPERSEDED" || activeStatus(doc.validationStatus) === "SUPERSEDED") return "superseded";
  if (!isFinalExportCandidateDocument(doc)) {
    const status = activeStatus(doc.reviewStatus);
    if (status === "REPLACE_WITH_ORIGINAL") return "tender-issued original must be uploaded";
    if (status === "NOT_EXPORTABLE") return "not required by tender or marked not exportable";
    if (activeStatus(doc.format) === "CONTROL") return "control/replacement row only";
    return "draft only or not a final export candidate";
  }
  const state = deriveDocumentOutputState(doc);
  if (state === "READY_FOR_EXPORT") return null;
  if (state === "PDF_CONVERSION_REQUIRED") return "wrong format: PDF required but final PDF is not attached";
  if (!isValidationPassed(doc.validationStatus)) return "not validated";
  if (!isReviewReadyForExport(doc.reviewStatus)) return "not approved";
  if (byteSize(doc) === 0) return "zero-byte or missing file bytes";
  return exportBlockReason(state) ?? "not export-ready";
}

function plannedStatusFor(doc: GeneratedDocLike | null, file: SubmissionPlanFile): Pick<PlannedPackageDocument, "status" | "blockerReason" | "generationMode"> {
  const mode: PlannedPackageDocument["generationMode"] = file.templateRequired ? "manual_upload_required" : "generated";
  if (!doc) {
    return {
      status: file.required ? "missing" : "not_applicable",
      generationMode: mode,
      blockerReason: file.required ? `${file.exactFileName} is planned as required but has not been generated or uploaded.` : null,
    };
  }

  const state = deriveDocumentOutputState(doc);
  const format = expectedFormat(file.format);
  if (format === "PDF" && activeStatus(doc.format) !== "PDF") {
    return {
      status: "blocked",
      generationMode: "manual_upload_required",
      blockerReason: `${file.exactFileName} requires PDF but current document format is ${doc.format ?? "unknown"}. Upload an approved final PDF mapped to this planned document.`,
    };
  }
  if (state === "READY_FOR_EXPORT" && byteSize(doc) > 0) return { status: "export_ready", generationMode: mode, blockerReason: null };
  if (isReviewReadyForExport(doc.reviewStatus)) return { status: "approved", generationMode: mode, blockerReason: documentOutputBlockReason(doc) };
  if (isValidationPassed(doc.validationStatus)) return { status: "valid", generationMode: mode, blockerReason: documentOutputBlockReason(doc) };
  if (GENERATED_STATUS.has(activeStatus(doc.generationStatus))) return { status: "generated", generationMode: mode, blockerReason: documentOutputBlockReason(doc) };
  return { status: "blocked", generationMode: mode, blockerReason: documentOutputBlockReason(doc) ?? "Generated row is not usable for final packaging." };
}

export function mapRequirementsToEvidence(requirements: RequirementLike[], expertMatches: MatchLike[] = [], projectMatches: MatchLike[] = []): RequirementEvidenceStatus[] {
  const hasReviewedExpert = selectedReviewedExperts(expertMatches) > 0;
  const hasReviewedProject = selectedReviewedProjects(projectMatches) > 0;

  return requirements.map((req) => {
    const links = req.complianceMatrixRows ?? [];
    const strongestEvidenceLevel = strongestSupportLevel(links);
    const mandatory = isMandatoryRequirement(req);
    const hasTrustedTrace = hasRequirementSourceTrace(req) && evidenceRank(strongestEvidenceLevel) >= evidenceRank("PARTIAL");
    const blockerReason = hasTrustedTrace
      ? null
      : links.length === 0
        ? "No selected or linked evidence is traced to this requirement."
        : !hasRequirementSourceTrace(req)
          ? "Requirement lacks source file, page, and exact quote trace, so linked evidence is not trusted."
          : "Linked evidence is weaker than PARTIAL.";

    return {
      requirementId: req.id,
      title: req.title,
      mandatory,
      selectedEvidenceCount: links.length,
      strongestEvidenceLevel,
      hasTrustedTrace,
      hasReviewedExpert,
      hasReviewedProject,
      blockerReason,
    };
  });
}

export function deriveRequiredPackageDocuments(tender: { id: string; requirements?: RequirementLike[] } & Record<string, unknown>, generated: GeneratedDocLike[] = []): PlannedPackageDocument[] {
  const plan = buildSubmissionPlanWithDerivedFallback({
    ...tender,
    requirements: (tender.requirements ?? []).map((req) => ({
      ...req,
      title: req.title,
      requirementType: req.requirementType ?? "TECHNICAL",
      priority: req.priority ?? "OPTIONAL",
    })),
  });
  const docsByKey = new Map<string, GeneratedDocLike[]>();
  for (const doc of generated) {
    const key = keyForDocument(doc);
    if (!key) continue;
    const docs = docsByKey.get(key) ?? [];
    docs.push(doc);
    docsByKey.set(key, docs);
  }

  return plan.files.map((file) => {
    const key = submissionPlanFileKey(file.exactFileName);
    const doc = chooseBestGeneratedDocument(docsByKey.get(key) ?? []);
    const derived = plannedStatusFor(doc, file);
    return {
      key,
      displayName: file.exactFileName,
      required: file.required,
      envelope: envelope(file.envelope),
      expectedFormat: expectedFormat(file.format),
      sourceRequirementIds: file.sourceRequirementIds,
      generationMode: derived.generationMode,
      generatedDocumentId: doc?.id ?? null,
      status: derived.status,
      blockerReason: derived.blockerReason,
    };
  });
}

export function mapGeneratedDocumentsToSubmissionPlan(generated: GeneratedDocLike[], planned: PlannedPackageDocument[]): GeneratedPackageDocument[] {
  const plannedByKey = new Map(planned.map((p) => [p.key, p]));
  return generated.map((doc) => {
    const key = keyForDocument(doc);
    const plannedDocumentKey = plannedByKey.has(key) ? key : null;
    const outputState = deriveDocumentOutputState(doc);
    const exportCandidate = Boolean(plannedDocumentKey) && isFinalExportCandidateDocument(doc);
    const exportReady = exportCandidate && outputState === "READY_FOR_EXPORT" && byteSize(doc) > 0;
    const exclusionReason = generatedDocumentExclusionReason(doc, plannedDocumentKey);
    return {
      id: doc.id,
      key: key || null,
      name: doc.name ?? doc.exactFileName ?? doc.id,
      finalFileName: doc.exactFileName ?? doc.name ?? `${doc.id}.docx`,
      documentType: doc.documentType ?? "",
      format: activeStatus(doc.format) || expectedFormat(doc.exactFileName),
      generationStatus: doc.generationStatus ?? "",
      validationStatus: doc.validationStatus ?? "",
      reviewStatus: doc.reviewStatus ?? "",
      plannedDocumentKey,
      outputState,
      exportCandidate,
      exportReady,
      blockerReason: exportReady ? null : documentOutputBlockReason(doc) ?? exclusionReason,
      exclusionReason,
      sizeBytes: byteSize(doc),
    };
  });
}

export function detectDocumentsOutsidePlan(generated: GeneratedPackageDocument[]): GeneratedPackageDocument[] {
  return generated.filter((doc) => !doc.plannedDocumentKey);
}

export function detectMissingRequiredDocuments(planned: PlannedPackageDocument[]): PlannedPackageDocument[] {
  return planned.filter((doc) => doc.required && doc.status === "missing");
}

export function detectPdfExportRequirements(planned: PlannedPackageDocument[], generated: GeneratedPackageDocument[]) {
  const requiredPdf = planned.filter((doc) => doc.required && doc.expectedFormat === "PDF");
  const missing = requiredPdf.filter((doc) => !generated.some((generatedDoc) => generatedDoc.plannedDocumentKey === doc.key && generatedDoc.format === "PDF" && generatedDoc.exportReady));
  return { pdfRequired: requiredPdf.length > 0, pdfConversionAvailable: false, requiredPdfMissing: missing.length > 0, missing };
}

export function buildFinalZipManifestFromModel(tenderId: string, planned: PlannedPackageDocument[], generated: GeneratedPackageDocument[]): FinalZipManifest {
  const files = planned
    .filter((doc) => doc.status !== "not_applicable")
    .map((plannedDoc) => {
      const doc = generated.find((g) => g.plannedDocumentKey === plannedDoc.key && g.exportReady)
        ?? generated.find((g) => g.plannedDocumentKey === plannedDoc.key && g.exportCandidate)
        ?? generated.find((g) => g.plannedDocumentKey === plannedDoc.key)
        ?? null;
      const approved = doc ? isReviewReadyForExport(doc.reviewStatus) : false;
      const formatMatches = !doc || doc.format === plannedDoc.expectedFormat;
      const exportReady = Boolean(doc?.exportReady && approved && doc.sizeBytes > 0 && formatMatches);
      return {
        plannedDocumentKey: plannedDoc.key,
        finalFileName: plannedDoc.displayName,
        sourceDocumentId: doc?.id ?? null,
        sourceUploadId: null,
        format: doc?.format ?? plannedDoc.expectedFormat,
        sizeBytes: doc?.sizeBytes ?? 0,
        envelope: plannedDoc.envelope,
        required: plannedDoc.required,
        approved,
        exportReady,
        blockerReason: exportReady || !plannedDoc.required
          ? null
          : plannedDoc.blockerReason ?? doc?.blockerReason ?? `${plannedDoc.displayName} is not ready for ZIP export.`,
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
    ...files.filter((file) => file.required && !file.exportReady).map((file) => file.finalFileName),
    ...duplicates.map((name) => `Duplicate filename: ${name}`),
  ];

  return {
    tenderId,
    files,
    missingRequiredFiles,
    extraFilesExcluded: generated
      .filter((doc) => !doc.plannedDocumentKey)
      .map((doc) => `${doc.finalFileName}: ${doc.exclusionReason ?? "outside submission plan"}`),
    ready: missingRequiredFiles.length === 0,
  };
}

function buildDocumentBlockers(planned: PlannedPackageDocument[]): FinalPackageBlocker[] {
  return planned
    .filter((doc) => doc.required && doc.blockerReason)
    .map((doc) => ({
      area: "documents" as const,
      code: doc.status === "missing" ? "PLANNED_DOCUMENT_MISSING" : doc.expectedFormat === "PDF" ? "PDF_REQUIRED_NOT_READY" : "PLANNED_DOCUMENT_BLOCKED",
      title: doc.displayName,
      documentName: doc.displayName,
      generatedDocumentId: doc.generatedDocumentId,
      reason: doc.blockerReason ?? "Required document is not ready.",
      nextAction: doc.status === "missing"
        ? "Generate the planned document or upload the required original."
        : doc.expectedFormat === "PDF"
          ? "Upload an approved final PDF mapped to this planned document."
          : "Validate, review, and approve this document.",
    }));
}

function buildRequirementBlockers(statuses: RequirementEvidenceStatus[]): FinalPackageBlocker[] {
  return statuses
    .filter((status) => status.mandatory && !status.hasTrustedTrace)
    .map((status) => ({
      area: "requirements" as const,
      code: "MANDATORY_REQUIREMENT_EVIDENCE_NOT_TRUSTED",
      title: status.title,
      requirementId: status.requirementId,
      reason: status.blockerReason ?? "Mandatory requirement lacks trusted traced evidence.",
      nextAction: `Add trusted traced evidence for mandatory requirement: ${status.title}`,
    }));
}

function deriveSummaryStatus(args: { manifestReady: boolean; missingRequired: number; documentBlockers: number; requirementBlockers: number; generatedCount: number }): FinalPackageReadinessModel["summary"]["status"] {
  if (args.manifestReady) return "export_ready";
  if (args.missingRequired > 0) return "generation_ready";
  if (args.documentBlockers > 0 || args.requirementBlockers > 0) return "review_required";
  if (args.generatedCount === 0) return "draft_ready";
  return "export_blocked";
}

export async function getFinalPackageReadinessModel(prisma: any, tenderId: string, userId: string): Promise<FinalPackageReadinessModel> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      exactFileNaming: true,
      exactFileOrder: true,
      pageLimit: true,
      submissionMethod: true,
      tenderCategory: true,
      analysisExtractionStatus: true,
      requirements: { include: { complianceMatrixRows: true } },
      generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
      expertMatches: { include: { expert: { select: { trustLevel: true } } } },
      projectMatches: { include: { project: { select: { trustLevel: true } } } },
    },
  });
  if (!tender) throw new Error("Tender not found");

  const requirementEvidenceStatuses = mapRequirementsToEvidence(tender.requirements, tender.expertMatches, tender.projectMatches);
  const planned = deriveRequiredPackageDocuments(tender, tender.generatedDocuments);
  const generated = mapGeneratedDocumentsToSubmissionPlan(tender.generatedDocuments, planned);
  const missingRequired = detectMissingRequiredDocuments(planned);
  const extraGeneratedOutsidePlan = detectDocumentsOutsidePlan(generated);
  const pdfRequirements = detectPdfExportRequirements(planned, generated);
  const documentBlockers = buildDocumentBlockers(planned);
  const requirementBlockers = buildRequirementBlockers(requirementEvidenceStatuses);
  const manifest = buildFinalZipManifestFromModel(tenderId, planned, generated);
  const exportBlockers: FinalPackageBlocker[] = manifest.missingRequiredFiles.map((name) => ({
    area: "export",
    code: "FINAL_ZIP_FILE_NOT_READY",
    title: name,
    documentName: name,
    reason: `${name} is missing, duplicate, wrong format, zero-byte, or unapproved.`,
    nextAction: "Resolve the document blocker and re-check final ZIP readiness.",
  }));

  const selectedProjects = tender.projectMatches.filter((match: MatchLike) => match.isSelected);
  const reviewedSelectedProjects = selectedReviewedProjects(tender.projectMatches);
  const highScoreSelectedProjects = selectedProjects.filter((match: MatchLike) => Number(match.score ?? 0) >= 90).length;
  const belowThresholdSelectedProjects = selectedProjects.filter((match: MatchLike) => Number(match.score ?? 0) < 90).length;
  const blockerCount = requirementBlockers.length + documentBlockers.length + exportBlockers.length;
  const status = deriveSummaryStatus({
    manifestReady: manifest.ready,
    missingRequired: missingRequired.length,
    documentBlockers: documentBlockers.length,
    requirementBlockers: requirementBlockers.length,
    generatedCount: generated.length,
  });

  return {
    tenderId,
    requirementEvidenceStatuses,
    projectMatchSummary: {
      selectedReviewed: reviewedSelectedProjects,
      highScoreSelected: highScoreSelectedProjects,
      belowThresholdSelected: belowThresholdSelectedProjects,
      missingComparableCoverage: tender.requirements.some((req: RequirementLike) => activeStatus(req.requirementType) === "PROJECT_EXPERIENCE") && reviewedSelectedProjects === 0 ? 1 : 0,
      explanation: reviewedSelectedProjects > 0 && highScoreSelectedProjects === 0
        ? "Selected projects are reviewed but below 90% match; improve relevance or accept with justification."
        : null,
    },
    requirements: {
      total: requirementEvidenceStatuses.length,
      mandatory: requirementEvidenceStatuses.filter((status) => status.mandatory).length,
      traced: requirementEvidenceStatuses.filter((status) => status.hasTrustedTrace).length,
      mandatoryTraced: requirementEvidenceStatuses.filter((status) => status.mandatory && status.hasTrustedTrace).length,
      strongEvidence: requirementEvidenceStatuses.filter((status) => status.strongestEvidenceLevel === "FULL").length,
      weakEvidence: requirementEvidenceStatuses.filter((status) => ["WEAK", "PARTIAL"].includes(status.strongestEvidenceLevel)).length,
      missingEvidence: requirementEvidenceStatuses.filter((status) => status.strongestEvidenceLevel === "NONE").length,
      coverageRatio: requirementEvidenceStatuses.length ? requirementEvidenceStatuses.filter((status) => status.hasTrustedTrace).length / requirementEvidenceStatuses.length : 0,
      blockers: requirementBlockers,
    },
    evidence: {
      rows: tender.requirements.reduce((sum: number, req: RequirementLike) => sum + (req.complianceMatrixRows?.length ?? 0), 0),
      selected: tender.requirements.reduce((sum: number, req: RequirementLike) => sum + (req.complianceMatrixRows?.length ?? 0), 0),
      strong: requirementEvidenceStatuses.filter((status) => status.strongestEvidenceLevel === "FULL").length,
      substantial: requirementEvidenceStatuses.filter((status) => status.strongestEvidenceLevel === "SUBSTANTIAL").length,
      weak: requirementEvidenceStatuses.filter((status) => ["WEAK", "PARTIAL"].includes(status.strongestEvidenceLevel)).length,
      missing: requirementEvidenceStatuses.filter((status) => status.strongestEvidenceLevel === "NONE").length,
      expertMatches: tender.expertMatches.length,
      reviewedExpertMatches: selectedReviewedExperts(tender.expertMatches),
      projectMatches: tender.projectMatches.length,
      reviewedProjectMatches: reviewedSelectedProjects,
      blockers: requirementBlockers,
    },
    documents: {
      planned,
      required: planned.filter((doc) => doc.required),
      generated,
      valid: generated.filter((doc) => isValidationPassed(doc.validationStatus)),
      approved: generated.filter((doc) => isReviewReadyForExport(doc.reviewStatus)),
      missingRequired,
      extraGeneratedOutsidePlan,
      exportReady: generated.filter((doc) => doc.exportReady),
      blockers: documentBlockers,
    },
    export: {
      ready: manifest.ready,
      zipReady: manifest.ready,
      pdfRequired: pdfRequirements.pdfRequired,
      pdfConversionAvailable: pdfRequirements.pdfConversionAvailable,
      requiredPdfMissing: pdfRequirements.requiredPdfMissing,
      workspaceCount: generated.length,
      exportCandidateCount: generated.filter((doc) => doc.exportCandidate).length,
      blockers: exportBlockers,
      manifest,
    },
    summary: {
      status,
      score: Math.max(0, Math.min(100, Math.round(100 - blockerCount * 12 - missingRequired.length * 8))),
      blockerCount,
      nextBestActions: [...requirementBlockers, ...documentBlockers, ...exportBlockers].slice(0, 8).map((blocker) => blocker.nextAction),
    },
  };
}
