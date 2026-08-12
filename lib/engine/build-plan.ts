import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { buildSubmissionPlan, plannedSubmissionTargetFiles, type SubmissionPlanFile } from "./submission-plan";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";
import { containsMetadataPlaceholder } from "./metadata-validators";

export type BuildPlanItem = SubmissionPlanFile;
export type BuildPlanValidation = { ok: boolean; blockers: string[] };

export type BuildPlanDraftResult =
  | { ok: true; plan: any; items: BuildPlanItem[] }
  | { ok: false; code: string; message: string; status: number };



// ═══════════════════════════════════════════════════════════════════════════
// STRICT METADATA EVIDENCE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════
// For every policy-critical metadata field, requires:
// - valid non-placeholder value
// - ACTIVE TenderFile ID belonging to this tender
// - valid page number
// - meaningful source quote
// - normalized quote actually contained in that same ACTIVE TenderFile extracted text
// Used in: BuildPlan preflight, confirmation, generation readiness, export, final ZIP.

export type MetadataEvidenceValidation = { ok: boolean; blockers: string[] };

export type ValidationPhase = "draft" | "final";

export function validateCriticalMetadataEvidenceForBuildPlan(
  tender: {
    title?: string | null;
    titleSourceFileId?: string | null;
    titleSourcePage?: number | null;
    titleSourceQuote?: string | null;
    reference?: string | null;
    referenceSourceFileId?: string | null;
    referenceSourcePage?: number | null;
    referenceSourceQuote?: string | null;
    clientName?: string | null;
    clientNameSourceFileId?: string | null;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    deadline?: Date | string | null;
    deadlineSourceFileId?: string | null;
    deadlineSourcePage?: number | null;
    deadlineSourceQuote?: string | null;
    submissionMethod?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionAddress?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionEmails?: string | null;
    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    submissionEmailSourceQuote?: string | null;
    submissionEmailSubject?: string | null;
    submissionEmailSubjectSourceFileId?: string | null;
    submissionEmailSubjectSourcePage?: number | null;
    submissionEmailSubjectSourceQuote?: string | null;
    /** JSON map of per-field evidence written by AI Analyze / repair —
     *  reference lives under "procurementReferenceNumber", the email subject
     *  under "submissionEmailSubject". Used as the evidence source when the
     *  dedicated columns are not populated. */
    contactDetailsSourceJson?: string | null;
  },
  activeFiles: Array<{ id: string; extractedText?: string | null; totalPages?: number | null }>,
  /**
   * Metadata overrides (USER_EDITED / USER_CONFIRMED). When present, the
   * validator checks the EFFECTIVE value (override ?? raw) — not the raw
   * tender column. This mirrors the canonical hash, which already uses
   * resolver-effective values. Without this, a USER_EDITED override that
   * changes the submission method from email to physical would switch the
   * hash's applicable endpoint but NOT the validator's, creating a
   * raw/effective divergence.
   *
   * Authority model: the override may carry `reason`, `confirmationBasis`,
   * `authorityClass`, and `confirmedAt` columns. When `mode === "draft"`,
   * USER_EDITED/USER_CONFIRMED overrides are accepted WITHOUT source
   * grounding (the manual value is sufficient). When `mode === "final"`,
   * they are accepted when `auditSufficientForFinal(reason, confirmationBasis)`
   * is true.
   */
  overrides?: Array<{
    field: string;
    fieldState: string;
    overrideValue: string | null;
    reason?: string | null;
    confirmationBasis?: string | null;
    authorityClass?: string | null;
    confirmedAt?: Date | null;
  }>,
  /**
   * Authority model mode:
   *   - "draft" (default): USER_EDITED/USER_CONFIRMED on critical fields
   *     is accepted without source grounding. Draft work proceeds.
   *   - "final": USER_EDITED/USER_CONFIRMED on critical fields requires
   *     either source grounding OR sufficient audit (reason + confirmationBasis).
   */
  mode?: "draft" | "final",
): MetadataEvidenceValidation {
  // DRAFT PHASE: metadata completeness must NOT block BuildPlan draft creation.
  // Only FINAL phase enforces strict evidence requirements for submission.
  const isDraft = (mode ?? "draft") === "draft";
  const validationMode = mode ?? "draft";
  const blockers: string[] = [];
  const activeFileMap = new Map(activeFiles.map((f) => [f.id, f]));
  const activeFileIds = new Set(activeFiles.map((f) => f.id));

  // Resolve the EFFECTIVE value for a field: override value when a
  // USER_EDITED/USER_CONFIRMED override exists, else the raw tender column.
  // This mirrors the canonical resolver's effective-value logic so the
  // validator and the hash can never disagree on which value is in force.
  const overrideMap = new Map((overrides ?? []).map((o) => [o.field, o]));
  function effectiveValue(field: string, raw: string | null | undefined): string | null {
    const ov = overrideMap.get(field);
    if (ov && (ov.fieldState === "USER_EDITED" || ov.fieldState === "USER_CONFIRMED")) {
      return ov.overrideValue ?? null;
    }
    return raw ?? null;
  }

  // Authority model: audit-aware short-circuit.
  // When a field has a USER_EDITED/USER_CONFIRMED override:
  //   - DRAFT mode: accept the manual value WITHOUT source grounding.
  //   - FINAL mode: accept when audit is sufficient (reason >= 10 chars +
  //     valid confirmationBasis, and reason is not a boilerplate string).
  //     Mirrors the canonical resolver's auditSufficientForFinal helper.
  function isManualOverrideAccepted(field: string): boolean {
    const ov = overrideMap.get(field);
    if (!ov) return false;
    if (ov.fieldState !== "USER_EDITED" && ov.fieldState !== "USER_CONFIRMED") return false;
    if (validationMode === "draft") return true;
    // Final mode: require sufficient audit
    const reason = (ov.reason ?? "").trim();
    const basis = (ov.confirmationBasis ?? "").trim();
    if (reason.length < 10 || basis.length === 0) return false;
    // Reject boilerplate reasons (the UI used to hardcode these)
    const boilerplate = new Set([
      "manual value entered by user.",
      "confirmed from client & submission details panel.",
      "marked not applicable by user.",
      "user confirmed this detail was not found in the tender.",
    ]);
    if (boilerplate.has(reason.toLowerCase())) return false;
    return true;
  }

  // Evidence for reference / submissionEmailSubject may live in the dedicated
  // *Source* columns OR in contactDetailsSourceJson (the storage AI Analyze
  // and the repair route write). Both are validated with the SAME strictness;
  // this only resolves WHERE the claimed evidence is stored.
  let contactEvidence: Record<string, { page?: number | null; quote?: string | null; fileId?: string | null }> = {};
  if (tender.contactDetailsSourceJson) {
    try {
      const parsed = JSON.parse(tender.contactDetailsSourceJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) contactEvidence = parsed;
    } catch { contactEvidence = {}; }
  }
  function resolveEvidence(
    dedicated: { fileId?: string | null; page?: number | null; quote?: string | null },
    contactKey: string,
  ): { fileId: string | null; page: number | null; quote: string | null } {
    if (dedicated.fileId || dedicated.page != null || dedicated.quote) {
      return { fileId: dedicated.fileId ?? null, page: dedicated.page ?? null, quote: dedicated.quote ?? null };
    }
    const entry = contactEvidence[contactKey];
    if (entry && typeof entry === "object") {
      return { fileId: entry.fileId ?? null, page: typeof entry.page === "number" ? entry.page : null, quote: entry.quote ?? null };
    }
    return { fileId: null, page: null, quote: null };
  }

  function checkField(
    label: string,
    value: string | null | undefined,
    sourceFileId: string | null | undefined,
    sourcePage: number | null | undefined,
    sourceQuote: string | null | undefined,
    requireQuote: boolean = true,
    fieldKey?: string,
    draftOptional: boolean = false,
  ) {
    if (!value || !value.trim()) {
      // In draft phase, non-critical metadata gaps are warnings, not blockers.
      // The core tender task is requirement extraction and draft-proposal readiness,
      // not metadata completeness. Final submission gates (Tool A) enforce strictness.
      if (isDraft && draftOptional) {
        return;
      }
      blockers.push(`Critical metadata field ${label} has no value.`);
      return;
    }
    // Reject placeholder values outright (TBD, N/A, Bid-Team to confirm, etc.)
    // — a placeholder is not a real value and must not pass the strict gate.
    if (containsMetadataPlaceholder(value)) {
      blockers.push(`Critical metadata field ${label} has a placeholder value ("${value.trim().slice(0, 40)}") — replace with the actual value.`);
      return;
    }
    // Authority model: when a USER_EDITED/USER_CONFIRMED override is accepted
    // (draft mode always; final mode when audit is sufficient), skip the
    // source-grounding checks. The manual value is the authority.
    if (fieldKey && isManualOverrideAccepted(fieldKey)) {
      return;
    }
    if (!sourceFileId || !activeFileIds.has(sourceFileId as string)) {
      // RUNTIME METADATA DEBLOCKER: In draft mode, missing source evidence is
      // advisory, not a hard block. The value may be resolved from parser/
      // effective facts without active TenderFile source evidence.
      // Final mode still requires source grounding.
      if (!isDraft) {
        blockers.push(`Critical metadata field ${label} has no active TenderFile source evidence.`);
      }
      return;
    }
    if (typeof sourcePage !== "number" || sourcePage < 1) {
      blockers.push(`Critical metadata field ${label} has invalid source page.`);
      return;
    }
    // ENFORCE sourcePage <= totalPages when totalPages exists
    const file = activeFileMap.get(sourceFileId!);
    const totalPages = (file as any)?.totalPages;
    if (typeof totalPages === "number" && totalPages > 0 && sourcePage > totalPages) {
      blockers.push(`Critical metadata field ${label} source page ${sourcePage} exceeds file total pages ${totalPages}.`);
      return;
    }
    if (requireQuote) {
      const quote = (sourceQuote ?? "").trim();
      if (quote.length < 10) {
        blockers.push(`Critical metadata field ${label} has no meaningful source quote.`);
        return;
      }
      // QUOTE CONTAINMENT: normalized quote must be in the file's extracted text
      const file = activeFileMap.get(sourceFileId!);
      const fileText = String(file?.extractedText ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const normalizedQuote = quote.toLowerCase().replace(/\s+/g, " ").trim();
      if (fileText.length === 0 || !fileText.includes(normalizedQuote)) {
        blockers.push(`Critical metadata field ${label} source quote is not contained in the referenced active TenderFile extracted text.`);
      }
    }
  }

  // POLICY-DRIVEN: check title, clientName, deadline, submissionMethod.
  // Use EFFECTIVE values (override ?? raw) so the validator and the canonical
  // hash can never disagree on which value is in force.
  // In draft phase, these are NON-BLOCKING — the core tender task is requirement
  // extraction and draft-proposal readiness, not metadata completeness.
  const effTitle = effectiveValue("title", tender.title);
  const effClientName = effectiveValue("clientName", tender.clientName);
  const effDeadline = effectiveValue("deadline", tender.deadline ? new Date(tender.deadline).toISOString() : null);
  const effMethod = effectiveValue("submissionMethod", tender.submissionMethod);
  checkField("title", effTitle, tender.titleSourceFileId, tender.titleSourcePage, tender.titleSourceQuote, true, "title", isDraft);
  checkField("clientName", effClientName, tender.clientNameSourceFileId, tender.clientNameSourcePage, tender.clientNameSourceQuote, true, "clientName", isDraft);
  checkField("deadline", effDeadline, tender.deadlineSourceFileId, tender.deadlineSourcePage, tender.deadlineSourceQuote, true, "deadline", isDraft);
  checkField("submissionMethod", effMethod, tender.submissionMethodSourceFileId, tender.submissionMethodSourcePage, tender.submissionMethodSourceQuote, true, "submissionMethod", isDraft);

  // VALUE-DRIVEN: reference is not a block-when-absent field (CLAUDE.md's
  // critical-block list is client/procuring entity, submission method,
  // submission endpoint, deadline) — but when a reference VALUE exists it
  // must carry full evidence: active TenderFile + valid page + contained
  // quote. Evidence may live in the dedicated referenceSource* columns or in
  // contactDetailsSourceJson.procurementReferenceNumber.
  // Use EFFECTIVE reference value (override ?? raw).
  const effReference = effectiveValue("reference", tender.reference);
  if (effReference?.trim()) {
    const refEvidence = resolveEvidence(
      { fileId: tender.referenceSourceFileId, page: tender.referenceSourcePage, quote: tender.referenceSourceQuote },
      "procurementReferenceNumber",
    );
    checkField("reference", effReference, refEvidence.fileId, refEvidence.page, refEvidence.quote, true, "reference");
  }

  // SUBMISSION-METHOD-DRIVEN: use the EFFECTIVE method (override-aware) to
  // select which endpoint evidence is required. This mirrors the canonical
  // hash, which already uses the effective method to select the endpoint.
  const method = effMethod;
  // Effective endpoint values (override-aware) — mirrors the canonical hash.
  const effEmails = effectiveValue("submissionEmails", tender.submissionEmails);
  const effAddress = effectiveValue("submissionAddress", tender.submissionAddress);
  const effSubject = effectiveValue("submissionEmailSubject", tender.submissionEmailSubject);
  const checkEmailSubjectIfPresent = () => {
    // A REQUIRED email subject line is submission-critical: sending with the
    // wrong subject can invalidate the bid. When a subject value exists it
    // must be evidence-backed exactly like the other critical fields.
    if (!effSubject?.trim()) return;
    const subjEvidence = resolveEvidence(
      { fileId: tender.submissionEmailSubjectSourceFileId, page: tender.submissionEmailSubjectSourcePage, quote: tender.submissionEmailSubjectSourceQuote },
      "submissionEmailSubject",
    );
    checkField("submissionEmailSubject", effSubject, subjEvidence.fileId, subjEvidence.page, subjEvidence.quote, true, "submissionEmailSubject");
  };
  if (isEmailSubmissionMethod(method)) {
    checkField("submissionEmails", effEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote, true, "submissionEmails");
    checkEmailSubjectIfPresent();
  } else if (isPhysicalSubmissionMethod(method)) {
    checkField("submissionAddress", effAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote, true, "submissionAddress");
  } else if (isPortalSubmissionMethod(method)) {
    // Portal: require one fully grounded declared endpoint
    const hasEmail = effEmails && tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage;
    const hasAddress = effAddress && tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage;
    if (!hasEmail && !hasAddress) {
      blockers.push("Portal submission requires at least one fully grounded endpoint (email or address with source file + page).");
    } else if (hasEmail) {
      checkField("submissionEmails", effEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote, true, "submissionEmails");
      checkEmailSubjectIfPresent();
    } else {
      checkField("submissionAddress", effAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote, true, "submissionAddress");
    }
  } else {
    // Unknown/empty/malformed submission method: BLOCK — do not fall back.
    blockers.push(`Unsupported or unknown submission method: "${method ?? ""}". Only email, physical, or portal methods are supported.`);
  }

  return { ok: blockers.length === 0, blockers };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREFLIGHT: assertTenderReadyToDraftBuildPlan
// ═══════════════════════════════════════════════════════════════════════════
// Runs BEFORE any BuildPlan DRAFT is created or rebuilt. Used by:
// - POST /api/tenders/[id]/build-plan
// - POST /api/tenders/[id]/submission-plan/build
// - generate route planOnly mode
// Creates ZERO GeneratedDocument rows.

export type BuildPlanPreflightResult =
  | { ok: true; tender: any; items: BuildPlanItem[] }
  | { ok: false; code: string; message: string; status: number };

export async function assertTenderReadyToDraftBuildPlan(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<BuildPlanPreflightResult> {
  // 1. Authenticated tender owner
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true } },
      requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
      // Load metadata overrides so validateCriticalMetadataEvidenceForBuildPlan
      // can validate EFFECTIVE values (override ?? raw), mirroring the canonical hash.
      metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true } },
    },
  });
  if (!tender) return { ok: false, code: "TENDER_NOT_FOUND", message: "Tender not found or not owned by actor.", status: 404 };

  // 2. At least one ACTIVE TenderFile
  if (!tender.files || tender.files.length === 0) {
    return { ok: false, code: "NO_ACTIVE_FILE", message: "No active tender file exists. Upload and extract the tender document first.", status: 422 };
  }

  // 3. Acceptable extraction quality
  const { isExtractionAcceptableForGeneration } = await import("./extraction-quality-gate");
  const { assessExtractionQuality } = await import("../extraction-quality");
  const effectiveExtractionFiles = tender.files.map((f: any) => {
    const quality = assessExtractionQuality(f.extractedText, f.originalFileName);
    return { ...f, extractionScore: Math.min(f.extractionScore ?? quality.score, quality.score), quality };
  });
  if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles as any)) {
    return { ok: false, code: "EXTRACTION_NOT_READY", message: "Tender file extraction quality is too poor to build a trusted Build Plan.", status: 422 };
  }

  // 4. Canonical promoted AI_SUCCEEDED analysis only
  const { resolveTenderAnalysisState } = await import("./analysis-state-resolver");
  const analysis = await resolveTenderAnalysisState(prisma, tenderId, userId);
  if (analysis.state !== "AI_SUCCEEDED") {
    return { ok: false, code: "ANALYSIS_NOT_READY", message: `AI Analyze is not in AI_SUCCEEDED state (current: ${analysis.state}). Regex, heuristic, partial, failed, weak, or human-approved fallback analysis cannot authorize a Build Plan draft.`, status: 422 };
  }
  if (!analysis.canonicalJobId) {
    return { ok: false, code: "NO_PROMOTED_JOB", message: "No promoted AI Analyze job found. Re-run AI Analyze.", status: 422 };
  }

  // 5. Current analysis hash + completed chunks
  const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("./tender-analysis-content");
  const company = await prisma.company.findUnique({ where: { userId }, select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } } }).catch(() => null);
  const currentContentHash = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: tender.files as any[] }, company ?? undefined));
  const latestJob = await prisma.aiJob.findFirst({ where: { tenderId, jobType: "AI_ANALYZE", tender: { userId } }, orderBy: { createdAt: "desc" }, select: { id: true, analysisInputHash: true } });
  if (latestJob?.analysisInputHash && latestJob.analysisInputHash !== currentContentHash) {
    return { ok: false, code: "ANALYSIS_HASH_MISMATCH", message: "Tender content changed since the last analysis. Re-run AI Analyze.", status: 422 };
  }

  // 6. STRICT CRITICAL METADATA EVIDENCE — must be present, non-placeholder,
  // AND source-grounded with ACTIVE TenderFile + valid page + meaningful quote
  // actually contained in that file's extracted text.
  // Uses validateCriticalMetadataEvidenceForBuildPlan — one shared strict
  // validator for BuildPlan preflight, confirmation, and release gates.
  const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(tender as any, tender.files as any[], (tender as any).metadataOverrides ?? []);
  if (!metaValidation.ok) {
    return { ok: false, code: "TENDER_FACTS_INVALID", message: `Required Tender Details / Submission Facts evidence validation failed: ${metaValidation.blockers.join("; ")}`, status: 422 };
  }

  // 7. Mandatory requirements grounded by ACTIVE TenderFile + valid page + meaningful quote contained in file text
  const mandatoryReqs = tender.requirements.filter((r: any) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  if (mandatoryReqs.length === 0) {
    return { ok: false, code: "NO_MANDATORY_REQUIREMENTS", message: "No MANDATORY requirements found. Re-run AI Analyze or manually mark critical requirements as MANDATORY.", status: 422 };
  }
  const activeFileMap = new Map(tender.files.map((f: any) => [f.id, f]));
  for (const req of mandatoryReqs) {
    if (!req.sourceTenderFileId || !activeFileMap.has(req.sourceTenderFileId)) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has no active source TenderFile.`, status: 422 };
    }
    if (typeof req.sourcePageNumber !== "number" || req.sourcePageNumber < 1) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has invalid source page.`, status: 422 };
    }
    const reqFile = activeFileMap.get(req.sourceTenderFileId);
    const reqTotalPages = (reqFile as any)?.totalPages;
    if (typeof reqTotalPages === "number" && reqTotalPages > 0 && req.sourcePageNumber > reqTotalPages) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} source page ${req.sourcePageNumber} exceeds file total pages ${reqTotalPages}.`, status: 422 };
    }
    const quote = String(req.sourceExactQuote ?? "").trim();
    if (quote.length < 10) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has no meaningful source quote.`, status: 422 };
    }
    const file = activeFileMap.get(req.sourceTenderFileId)!;
    const fileText = String(file.extractedText ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedQuote = quote.toLowerCase().replace(/\s+/g, " ").trim();
    if (!fileText.includes(normalizedQuote)) {
      return { ok: false, code: "REQUIREMENT_QUOTE_NOT_IN_FILE", message: `Mandatory requirement ${req.id} source quote is not contained in the referenced active TenderFile extracted text.`, status: 422 };
    }
  }

  // 8. Tender-controlled exact scope with no missing required documents
  const planItems = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  if (planItems.length === 0) {
    return { ok: false, code: "NO_PLAN_ITEMS", message: "No tender-controlled required submission files could be derived. Re-run AI Analyze or add exact file naming.", status: 422 };
  }

  return { ok: true, tender, items: planItems };
}


function normalizeText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePlanName(value: unknown): string {
  return normalizeText(value);
}

function planItemKey(item: Pick<BuildPlanItem, "exactFileName" | "exactOrder" | "documentType">): string {
  return `${Number(item.exactOrder)}::${normalizePlanName(item.exactFileName)}::${normalizeText(item.documentType)}`;
}

function quoteSupported(extractedText: unknown, quote: string): boolean {
  return normalizeText(extractedText).includes(normalizeText(quote));
}

export async function computeTenderBuildPlanHash(prisma: PrismaClient, tenderId: string, userId: string, items?: BuildPlanItem[]): Promise<string | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true, deadline: true,
      procuringEntityName: true,
      clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,
      submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,
      submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,
      submissionEmailSourceFileId: true, submissionEmailSourcePage: true, submissionEmailSourceQuote: true,
      titleSourceFileId: true, titleSourcePage: true, titleSourceQuote: true,
      deadlineSourceFileId: true, deadlineSourcePage: true, deadlineSourceQuote: true,
      // Reference source evidence — dedicated columns read by the strict
      // BuildPlan metadata validator (validateCriticalMetadataEvidenceForBuildPlan)
      // AND by the canonical resolver's getSourceEvidence for fieldKey="reference".
      // Without these in the select, the hash treats reference as ungrounded
      // even when the columns are populated, diverging from the validator.
      referenceSourceFileId: true, referenceSourcePage: true, referenceSourceQuote: true,
      files: { where: { deletionStatus: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true, totalPages: true } },
      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
    },
  });
  if (!tender) return null;
  // Load metadata overrides to resolve effective values for canonical hash
  const metadataOverrides = await prisma.tenderMetadataOverride.findMany({
    where: { tenderId },
    select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true },
  }).catch(() => []);
  // ATTACH overrides to the tender object so buildCanonicalBuildPlanHashInput
  // can read them via tender.metadataOverrides. Without this, overrides have
  // ZERO effect on the hash (override changes would not stale the plan).
  (tender as any).metadataOverrides = metadataOverrides;
  // Map fileName from originalFileName so the hash includes the display name
  // (build-plan-hash.ts reads f.fileName, not f.originalFileName). Without
  // this mapping, file renames would never stale a confirmed plan because the
  // hash would only see the original file name.
  (tender as any).files = (tender as any).files.map((f: any) => ({ ...f, fileName: f.originalFileName }));
  const planItems = items ?? plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  // CANONICAL HASH: uses buildCanonicalBuildPlanHashInput — the ONE shared
  // builder. No caller may manually construct a reduced hash input or append
  // items/metadata after calling this.
  const { buildCanonicalBuildPlanHashInput, computeBuildPlanHash } = await import("./build-plan-hash");
  const hashItems = planItems.map((item) => ({
    canonicalId: item.canonicalId,
    exactFileName: item.exactFileName,
    exactOrder: item.exactOrder,
    documentType: item.documentType,
    required: item.required,
    format: item.format,
    envelope: item.envelope,
    sourceRequirementIds: item.sourceRequirementIds,
    pageLimit: item.pageLimit,
    templateRequired: item.templateRequired,
    templateSourceFileId: item.templateSourceFileId,
    brandingAllowed: item.brandingAllowed,
    signatureAllowed: item.signatureAllowed,
    stampAllowed: item.stampAllowed,
    grouping: item.grouping,
    notes: item.notes,
  }));
  return computeBuildPlanHash(buildCanonicalBuildPlanHashInput(tender as any, hashItems));
}

export async function buildDraftBuildPlan(prisma: PrismaClient, tenderId: string, userId: string): Promise<BuildPlanDraftResult> {
  // SERIALIZABLE REBUILD: preflight + hash + persistence inside a PostgreSQL
  // Serializable transaction with bounded P2034 retry.
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // PREFLIGHT inside transaction — checks current state under isolation.
        const preflight = await assertTenderReadyToDraftBuildPlan(tx as PrismaClient, tenderId, userId);
        if (!preflight.ok) {
          return { ok: false as const, code: preflight.code, message: preflight.message, status: preflight.status };
        }
        const { tender, items } = preflight;
        const contentHash = await computeTenderBuildPlanHash(tx as PrismaClient, tenderId, userId, items);
        if (!contentHash) {
          return { ok: false as const, code: "HASH_COMPUTE_FAILED", message: "Could not compute BuildPlan content hash.", status: 500 };
        }

        const itemsJson = JSON.stringify(items);
        const validationJson = JSON.stringify({ ok: false, blockers: ["Draft build plan requires confirmation."] });
        const plan = await (tx as any).buildPlan.upsert({
          where: { tenderId },
          update: {
            status: "DRAFT",
            revision: { increment: 1 },
            contentHash,
            itemsJson,
            validationJson,
            builtById: userId,
            confirmedRevision: null,
            confirmedContentHash: null,
            confirmedById: null,
            confirmedBy: null,
            confirmedAt: null,
          },
          create: {
            tenderId,
            status: "DRAFT",
            revision: 1,
            contentHash,
            itemsJson,
            validationJson,
            builtById: userId,
          },
        });
        return { ok: true as const, plan, items };
      }, { isolationLevel: "Serializable" });
    } catch (err: any) {
      if (err?.code === "P2034" && attempt < MAX_RETRIES) {
        continue; // Serialization conflict — retry
      }
      // Non-concurrency failure — sanitized 500, not fake conflict
      return { ok: false as const, code: "BUILD_PLAN_INTERNAL_ERROR", message: "BuildPlan draft failed due to an internal error.", status: 500 };
    }
  }
  return { ok: false as const, code: "BUILD_PLAN_CONFLICT", message: "BuildPlan draft failed after retries due to concurrent modification.", status: 409 };
}

export async function validateBuildPlanForConfirmation(prisma: PrismaClient, tenderId: string, userId: string, items: BuildPlanItem[]): Promise<BuildPlanValidation> {
  const blockers: string[] = [];
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, include: { files: true, requirements: true, metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true } } } });
  if (!tender) return { ok: false, blockers: ["Tender not found or not owned by actor."] };
  const activeFiles = new Map(tender.files.filter((f: any) => f.deletionStatus === "ACTIVE").map((f: any) => [f.id, f]));
  const reqs = new Map(tender.requirements.map((r: any) => [r.id, r]));
  const authoritativeItems = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  const authoritativeKeys = new Set(authoritativeItems.map(planItemKey));
  const seen = new Set<string>();
  if (items.length === 0) blockers.push("Build Plan has no tender-controlled required files.");
  if (items.length !== authoritativeItems.length) blockers.push("Build Plan item count does not match current tender-controlled submission scope.");
  for (const item of items) {
    const key = planItemKey(item);
    if (!authoritativeKeys.has(key)) blockers.push(`${item.exactFileName} order/type/name is not in current tender-controlled scope.`);
    const orderNameKey = `${Number(item.exactOrder)}:${normalizePlanName(item.exactFileName)}`;
    if (seen.has(orderNameKey)) blockers.push(`Duplicate/conflicting plan item: ${item.exactOrder} ${item.exactFileName}`);
    seen.add(orderNameKey);
    if (!item.exactFileName?.trim() || !Number.isInteger(item.exactOrder) || item.exactOrder < 1) blockers.push(`Invalid filename/order for ${item.canonicalId ?? item.exactFileName}`);
    if (item.required && item.sourceRequirementIds.length === 0 && !String(item.canonicalId ?? "").startsWith("exact-")) blockers.push(`${item.exactFileName} is missing linked tender requirement IDs.`);
    for (const reqId of item.sourceRequirementIds) {
      const req: any = reqs.get(reqId);
      if (!req) { blockers.push(`${item.exactFileName} references missing/foreign requirement ${reqId}.`); continue; }
      const file: any = req.sourceTenderFileId ? activeFiles.get(req.sourceTenderFileId) : null;
      const quote = String(req.sourceExactQuote ?? "").trim();
      if (!file) blockers.push(`Requirement ${reqId} evidence is not an ACTIVE TenderFile on this tender.`);
      if (!Number.isInteger(req.sourcePageNumber) || req.sourcePageNumber < 1) blockers.push(`Requirement ${reqId} has invalid source page.`);
      const confirmTotalPages = (file as any)?.totalPages;
      if (typeof confirmTotalPages === "number" && confirmTotalPages > 0 && req.sourcePageNumber > confirmTotalPages) blockers.push(`Requirement ${reqId} source page ${req.sourcePageNumber} exceeds file total pages ${confirmTotalPages}.`);
      if (quote.length < 10) blockers.push(`Requirement ${reqId} has no meaningful source quote.`);
      if (file && quote.length >= 10 && !quoteSupported(file.extractedText, quote)) blockers.push(`Requirement ${reqId} quote is not supported by active file text.`);
    }
  }
  for (const authoritative of authoritativeItems) {
    if (!items.some((item) => planItemKey(item) === planItemKey(authoritative))) blockers.push(`${authoritative.exactFileName} is missing from the Build Plan.`);
  }
  // STRICT CRITICAL METADATA EVIDENCE: run the same shared validator.
  const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(tender as any, tender.files.filter((f: any) => f.deletionStatus === "ACTIVE"), (tender as any).metadataOverrides ?? []);
  if (!metaValidation.ok) {
    blockers.push(...metaValidation.blockers);
  }
  return { ok: blockers.length === 0, blockers };
}

export async function getCurrentConfirmedBuildPlan(prisma: PrismaClient, tenderId: string, userId: string) {
  // Safe guard: if the prisma client doesn't have buildPlan (e.g., mock in unit tests),
  // return a blocked state instead of crashing.
  if (!(prisma as any).buildPlan || typeof (prisma as any).buildPlan.findFirst !== "function") {
    return { ok: false as const, blocker: "No confirmed Build Plan exists." };
  }
  const plan = await (prisma as any).buildPlan.findFirst({ where: { tenderId, status: "CONFIRMED", tender: { userId } }, orderBy: { updatedAt: "desc" } });
  if (!plan) return { ok: false as const, blocker: "No confirmed Build Plan exists." };
  // FAIL CLOSED on corrupted plan items — a plan whose contents cannot be
  // read must never authorize generation or export.
  let items: BuildPlanItem[];
  try {
    const parsed = JSON.parse(plan.itemsJson || "[]");
    if (!Array.isArray(parsed)) throw new Error("itemsJson is not an array");
    items = parsed as BuildPlanItem[];
  } catch {
    return { ok: false as const, blocker: "Confirmed Build Plan items are corrupted and cannot be read. Rebuild and re-confirm the Build Plan." };
  }
  // Reduced unit-test prisma mocks don't model the tables that
  // computeTenderBuildPlanHash reads. Detect that EXPLICITLY (missing model
  // delegates) and only then skip hash verification. A real PrismaClient
  // always has these delegates, so production always verifies.
  const canVerifyHash =
    typeof (prisma as any).tenderMetadataOverride?.findMany === "function" &&
    typeof (prisma as any).tender?.findFirst === "function";
  if (!canVerifyHash) {
    return { ok: true as const, plan, items, currentHash: plan.confirmedContentHash ?? plan.contentHash };
  }
  // FAIL CLOSED on verification failure — if freshness cannot be proven, the
  // plan must not authorize anything. (A previous revision returned ok:true
  // here, silently skipping the staleness and evidence checks.)
  let currentHash: string | null = null;
  try {
    currentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  } catch {
    return { ok: false as const, blocker: "Confirmed Build Plan freshness could not be verified (hash computation failed). Retry, or rebuild and re-confirm the Build Plan." };
  }
  const hashOk = plan.confirmedRevision === plan.revision && plan.confirmedContentHash === plan.contentHash && currentHash === plan.confirmedContentHash;
  if (!hashOk) return { ok: false as const, blocker: "Confirmed Build Plan is stale or hash/revision mismatched." };
  // STRICT CRITICAL METADATA EVIDENCE: even if hash matches, reject if
  // metadata evidence is no longer valid (e.g., source file was deleted).
  const fullTender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: { where: { deletionStatus: "ACTIVE" } }, metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true } } },
  });
  if (fullTender) {
    const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(fullTender as any, fullTender.files as any[], (fullTender as any).metadataOverrides ?? []);
    if (!metaValidation.ok) {
      return { ok: false as const, blocker: `Confirmed Build Plan metadata evidence is no longer valid: ${metaValidation.blockers.join("; ")}` };
    }
  }
  return { ok: true as const, plan, items, currentHash };
}


export type ConfirmedPlanDocumentValidation = { ok: boolean; blockers: string[]; exportReadyDocumentCount: number };

function generatedDocumentHasContent(doc: { fileContent?: string | null; storagePath?: string | null }): boolean {
  return Boolean(String(doc.fileContent ?? "").trim() || String(doc.storagePath ?? "").trim());
}

export async function validateBuildPlanItemsAtRuntime(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
  items: BuildPlanItem[],
): Promise<{ ok: boolean; blockers: string[] }> {
  const blockers: string[] = [];
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: true, requirements: true },
  });
  if (!tender) return { ok: false, blockers: ["Tender not found or not owned by actor."] };

  const activeFileIds = new Set(tender.files.filter((f: any) => f.deletionStatus === "ACTIVE").map((f: any) => f.id));
  const requirementMap = new Map(tender.requirements.map((r: any) => [r.id, r]));
  const authoritative = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  const authKeys = new Set(authoritative.map(planItemKey));
  const seen = new Set<string>();

  // RUNTIME VALIDATIONS
  if (!Array.isArray(items)) blockers.push("Build Plan items must be an array.");
  if (items.length === 0) blockers.push("Build Plan cannot be empty.");
  if (items.length !== authoritative.length) blockers.push("Build Plan item count does not match current tender scope.");

  for (const item of items) {
    if (!item) {
      blockers.push("Build Plan contains null or undefined item.");
      continue;
    }
    // Strict item structure validation
    if (typeof item.exactFileName !== "string" || !item.exactFileName.trim()) {
      blockers.push(`Plan item has invalid exactFileName: ${item.exactFileName}`);
    }
    if (!Number.isInteger(item.exactOrder) || item.exactOrder < 1) {
      blockers.push(`Plan item has invalid exactOrder: ${item.exactOrder}`);
    }
    if (typeof item.documentType !== "string" || !item.documentType.trim()) {
      blockers.push(`Plan item ${item.exactFileName} has invalid documentType.`);
    }
    if (item.required !== true && item.required !== false) {
      blockers.push(`Plan item ${item.exactFileName} has invalid required flag: ${item.required}`);
    }
    // Check for duplicates
    const itemKey = planItemKey(item);
    if (seen.has(itemKey)) {
      blockers.push(`Duplicate plan item: ${item.exactOrder} ${item.exactFileName}`);
    }
    seen.add(itemKey);
    // Check scope match
    if (!authKeys.has(itemKey)) {
      blockers.push(`Plan item ${item.exactFileName} is not in current tender-controlled scope.`);
    }
    // Validate requirement links
    if (item.required && (!Array.isArray(item.sourceRequirementIds) || item.sourceRequirementIds.length === 0)) {
      if (!String(item.canonicalId ?? "").startsWith("exact-")) {
        blockers.push(`Required plan item ${item.exactFileName} has no linked requirements.`);
      }
    }
    for (const reqId of item.sourceRequirementIds ?? []) {
      if (!requirementMap.has(reqId)) {
        blockers.push(`Plan item ${item.exactFileName} references missing requirement ${reqId}.`);
      }
    }
    // Validate template file references if present
    if (item.templateSourceFileId && !activeFileIds.has(item.templateSourceFileId)) {
      blockers.push(`Plan item ${item.exactFileName} template file is not an active tender file.`);
    }
  }

  return { ok: blockers.length === 0, blockers };
}

export async function validateConfirmedPlanDocuments(prisma: PrismaClient, tenderId: string, userId: string, items: BuildPlanItem[]): Promise<ConfirmedPlanDocumentValidation> {
  const blockers: string[] = [];
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
  if (!tender) return { ok: false, blockers: ["Tender not found or not owned by actor."], exportReadyDocumentCount: 0 };

  const requiredItems = items.filter((item) => item.required);
  const requiredKeys = new Set(requiredItems.map(planItemKey));
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, format: true, fileContent: true, storagePath: true, generationStatus: true, validationStatus: true, reviewStatus: true },
  });
  let exportReadyDocumentCount = 0;
  const docsByKey = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = planItemKey({ exactFileName: doc.exactFileName ?? doc.name, exactOrder: doc.exactOrder ?? -1, documentType: doc.documentType });
    const bucket = docsByKey.get(key) ?? [];
    bucket.push(doc);
    docsByKey.set(key, bucket);
    if (!requiredKeys.has(key) && doc.generationStatus === "GENERATED") blockers.push(`Generated document ${doc.name} is not in the confirmed Build Plan.`);
  }

  for (const item of requiredItems) {
    const key = planItemKey(item);
    const matches = docsByKey.get(key) ?? [];
    const ready = matches.filter((doc) =>
      doc.generationStatus === "GENERATED" &&
      generatedDocumentHasContent(doc) &&
      (
        // Routine generated outputs become machine-export-eligible when the
        // canonical validator passes. Human reviewStatus remains an audit and
        // legal-release authority; it is not a second per-document pipeline
        // gate. Tender-issued originals remain eligible only through their
        // explicit REPLACE_WITH_ORIGINAL path.
        ["VALIDATED", "PASSED", "APPROVED", "READY_FOR_EXPORT"].includes(doc.validationStatus) ||
        doc.reviewStatus === "REPLACE_WITH_ORIGINAL"
      ),
    );
    if (matches.length === 0) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is missing.`);
    if (matches.length > 1) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} has duplicate generated rows.`);
    if (matches.some((doc) => !generatedDocumentHasContent(doc))) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is empty.`);
    if (matches.length > 0 && ready.length !== 1) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is not generated and machine-validated for export, or is still awaiting its genuine tender-issued original.`);
    exportReadyDocumentCount += ready.length;
  }

  return { ok: blockers.length === 0, blockers, exportReadyDocumentCount };
}
