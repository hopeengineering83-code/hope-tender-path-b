/**
 * Effective Tender Facts Resolver
 *
 * The single server-side function that merges:
 * - source-grounded Tender scalar values;
 * - active metadata overrides (USER_EDITED, USER_CONFIRMED, NOT_APPLICABLE, IGNORED_WITH_REASON);
 * - human-confirmed operational values with audit context;
 * - derived submission-method context (normalized method);
 * - manual requirements where applicable.
 *
 * All downstream consumers MUST use this one effective fact view:
 * - canonical field resolver;
 * - BuildPlan hash;
 * - BuildPlan builder;
 * - readiness snapshot;
 * - proposal title;
 * - cover letter;
 * - company matching context;
 * - document headers;
 * - filenames;
 * - submission instructions;
 * - final ZIP manifest;
 * - export readiness;
 * - UI panels.
 *
 * This function does NOT write manual values into raw source-extracted columns.
 * It returns a merged view that consumers use read-only.
 */

import type { TenderMetadataOverride } from "@prisma/client";
import { normalizeSubmissionMethod, type NormalizedSubmissionMethod } from "./submission-method-policy";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EffectiveTenderFact = {
  /** The field key (e.g., "clientName", "deadline", "submissionMethod"). */
  field: string;
  /** The effective value (override ?? raw). */
  effectiveValue: string | null;
  /** The raw tender scalar value (before override). */
  rawValue: string | null;
  /** The override row, if any. */
  override: TenderMetadataOverride | null;
  /** The authority class of this fact. */
  authorityClass: "SOURCE_GROUNDED" | "HUMAN_CONFIRMED_OPERATIONAL" | "NOT_STATED_IN_SOURCE" | "UNKNOWN" | "REJECTED_CANDIDATE";
  /** The normalized submission method (only for the "submissionMethod" field). */
  normalizedMethod?: NormalizedSubmissionMethod;
  /** The audit reason (only for HUMAN_CONFIRMED_OPERATIONAL). */
  reason?: string | null;
  /** The confirmation basis (only for HUMAN_CONFIRMED_OPERATIONAL). */
  confirmationBasis?: string | null;
  /** When the fact was confirmed. */
  confirmedAt?: Date | null;
};

export type EffectiveTenderFacts = {
  /** Per-field effective facts. */
  facts: Map<string, EffectiveTenderFact>;
  /** The normalized submission method derived from the effective submission method. */
  normalizedSubmissionMethod: NormalizedSubmissionMethod;
  /** The effective submission method value. */
  effectiveSubmissionMethod: string | null;
  /** The effective deadline (as a Date if parseable). */
  effectiveDeadline: Date | null;
  /** The effective client name. */
  effectiveClientName: string | null;
  /** The effective title. */
  effectiveTitle: string | null;
  /** The effective reference number. */
  effectiveReference: string | null;
  /** The effective submission emails (as an array, split on pipe). */
  effectiveSubmissionEmails: string[];
  /** The effective submission address. */
  effectiveSubmissionAddress: string | null;
  /** The effective submission email subject. */
  effectiveSubmissionEmailSubject: string | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the effective value for a field: override value when a
 * USER_EDITED/USER_CONFIRMED override exists, else the raw tender column.
 */
function resolveEffectiveValue(
  field: string,
  rawValue: string | null | undefined,
  overrides: Map<string, TenderMetadataOverride>,
): string | null {
  const ov = overrides.get(field);
  if (ov && (ov.fieldState === "USER_EDITED" || ov.fieldState === "USER_CONFIRMED")) {
    return ov.overrideValue ?? null;
  }
  return rawValue ?? null;
}

/**
 * Determine the authority class for a field based on its override state
 * and whether it has a value.
 */
function determineAuthorityClass(
  field: string,
  effectiveValue: string | null,
  override: TenderMetadataOverride | null,
): EffectiveTenderFact["authorityClass"] {
  if (!effectiveValue || !effectiveValue.trim()) {
    if (override?.fieldState === "NOT_APPLICABLE" || override?.fieldState === "IGNORED_WITH_REASON") {
      return "NOT_STATED_IN_SOURCE";
    }
    return "UNKNOWN";
  }
  if (override && (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED")) {
    return "HUMAN_CONFIRMED_OPERATIONAL";
  }
  if (override?.fieldState === "NOT_APPLICABLE" || override?.fieldState === "IGNORED_WITH_REASON") {
    return "NOT_STATED_IN_SOURCE";
  }
  // No override — check if the value is garbage
  // (delegated to the canonical resolver's validation)
  return "SOURCE_GROUNDED";
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the effective tender facts from raw tender values + overrides.
 *
 * This is the SINGLE function all downstream consumers should use to get
 * the effective view of tender metadata. It merges source-grounded values
 * with human-confirmed overrides and provides a normalized submission method.
 *
 * @param tender - The raw tender object with scalar columns.
 * @param overrides - The active TenderMetadataOverride rows for this tender.
 * @returns The effective tender facts view.
 */
export function resolveEffectiveTenderFacts(
  tender: Record<string, unknown>,
  overrides: TenderMetadataOverride[],
): EffectiveTenderFacts {
  const overrideMap = new Map(overrides.map((o) => [o.field, o]));
  const facts = new Map<string, EffectiveTenderFact>();

  // Resolve all known metadata fields
  const knownFields = [
    "title", "reference", "clientName", "deadline", "submissionMethod",
    "submissionAddress", "submissionEmails", "submissionEmailSubject",
    "country", "currency", "donorAgency", "implementingAgency", "legalClientName",
    "clientContactName", "clientContactTitle", "clientContactEmail", "clientContactPhone",
    "clientAddress", "clientCity", "clientWebsite", "clientRepresentative",
    "preBidChannel", "preBidMeetingDate", "preBidMeetingLocation",
    "evaluationCriteria", "evaluationMethodology",
    "pageLimit", "validityDays", "bidBondAmount", "bidBondCurrency",
    "numberOfCopiesRequired", "mandatorySiteVisit", "budget", "category",
  ];

  for (const field of knownFields) {
    const rawValue = tender[field] != null ? String(tender[field]) : null;
    const override = overrideMap.get(field) ?? null;
    const effectiveValue = resolveEffectiveValue(field, rawValue, overrideMap);
    const authorityClass = determineAuthorityClass(field, effectiveValue, override);

    const fact: EffectiveTenderFact = {
      field,
      effectiveValue,
      rawValue,
      override,
      authorityClass,
    };

    // Add audit context for HUMAN_CONFIRMED_OPERATIONAL
    if (authorityClass === "HUMAN_CONFIRMED_OPERATIONAL" && override) {
      fact.reason = override.reason;
      fact.confirmationBasis = override.confirmationBasis;
      fact.confirmedAt = override.confirmedAt;
    }

    // Add normalized method for the submissionMethod field
    if (field === "submissionMethod") {
      fact.normalizedMethod = normalizeSubmissionMethod(effectiveValue);
    }

    facts.set(field, fact);
  }

  // Extract key effective values for convenience
  const effectiveSubmissionMethod = resolveEffectiveValue("submissionMethod", tender.submissionMethod as string | null, overrideMap);
  const effectiveDeadlineStr = resolveEffectiveValue("deadline", tender.deadline ? new Date(tender.deadline as string).toISOString() : null, overrideMap);
  const effectiveSubmissionEmailsStr = resolveEffectiveValue("submissionEmails", tender.submissionEmails as string | null, overrideMap);

  // Parse deadline
  let effectiveDeadline: Date | null = null;
  if (effectiveDeadlineStr) {
    const parsed = new Date(effectiveDeadlineStr);
    if (!isNaN(parsed.getTime())) effectiveDeadline = parsed;
  }

  // Split submission emails on pipe separator
  const effectiveSubmissionEmails = effectiveSubmissionEmailsStr
    ? effectiveSubmissionEmailsStr.split("|").map((e) => e.trim()).filter(Boolean)
    : [];

  return {
    facts,
    normalizedSubmissionMethod: normalizeSubmissionMethod(effectiveSubmissionMethod),
    effectiveSubmissionMethod,
    effectiveDeadline,
    effectiveClientName: resolveEffectiveValue("clientName", tender.clientName as string | null, overrideMap),
    effectiveTitle: resolveEffectiveValue("title", tender.title as string | null, overrideMap),
    effectiveReference: resolveEffectiveValue("reference", tender.reference as string | null, overrideMap),
    effectiveSubmissionEmails,
    effectiveSubmissionAddress: resolveEffectiveValue("submissionAddress", tender.submissionAddress as string | null, overrideMap),
    effectiveSubmissionEmailSubject: resolveEffectiveValue("submissionEmailSubject", tender.submissionEmailSubject as string | null, overrideMap),
  };
}

// ─── New effective fact authority layer (async, prisma-backed) ──────────────
//
// This is the NEW authority layer that combines:
//   1. TenderFactsLedger facts
//   2. parseTenderDocumentIntelligence() facts from full extracted text
//   3. manual overrides
//   4. clean scalar fallback only when no ledger/parser fact exists
//
// The existing `resolveEffectiveTenderFacts(tender, overrides)` above is
// kept for backward compatibility (it's synchronous, scalar+override only).
// New code should use `getEffectiveTenderFacts(prisma, tenderId, userId)`.

import type { PrismaClient } from "@prisma/client";
import { buildTenderFactSourceText, parseTenderDocumentIntelligence, normalizeEmailList as parserNormalizeEmailList } from "./source-driven-tender-text-parser";
import { getTenderFactLedgerSnapshot, AUTHORITY_STATE } from "./tender-facts-ledger-service";
import { containsMetadataPlaceholder, isValidClientName, isValidReferenceNumber, isValidCountry } from "./metadata-validators";

export type EffectiveTenderFactStatus =
  | "resolved_from_ledger"
  | "resolved_from_source_text"
  | "resolved_from_manual_override"
  | "resolved_from_scalar_fallback"
  | "not_applicable"
  | "missing"
  | "invalid";

export type EffectiveTenderFactSource = "ledger" | "parser" | "manual" | "scalar" | "none";

export type EffectiveTenderFactRequiredFor =
  | "draft_context"
  | "final_submission"
  | "optional"
  | "not_required";

export type EffectiveTenderFactEntry = {
  key: string;
  label: string;
  value: string | string[] | null;
  status: EffectiveTenderFactStatus;
  requiredFor: EffectiveTenderFactRequiredFor;
  source: EffectiveTenderFactSource;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  blockerReason?: string | null;
};

export type EffectiveTenderFactsResult = {
  tenderId: string;
  sourceTextHash: string | null;
  tenderType: string | null;
  serviceStreams: string[];
  projectTitle: string | null;
  clientOrProcuringEntity: string | null;
  referenceNumber: string | null;
  country: string | null;
  deadlineDisplay: string | null;
  deadlineIso: string | null;
  submissionMethod: "Email" | "Portal" | "Physical" | "Hybrid" | "Unknown";
  submissionFormat: string | null;
  submissionEmails: string[];
  submissionEmailSubject: string | null;
  submissionAddress: string | null;
  physicalSubmissionRequired: boolean;
  portalSubmissionRequired: boolean;
  financialProposalRequired: boolean | null;
  financialProposalInstruction: string | null;
  evaluationMethodology: string | null;
  requiredDocuments: string[];
  facts: EffectiveTenderFactEntry[];
  warnings: string[];
};

function isCleanScalarValue(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (containsMetadataPlaceholder(trimmed)) return false;
  return true;
}

function isCleanDeadline(value: Date | string | null | undefined): boolean {
  if (!value) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return !isNaN(d.getTime());
  }
  return false;
}

/**
 * Get the effective tender facts for a tender. This is the SINGLE authority
 * layer used by all panels and gates. Combines ledger, parser, manual
 * overrides, and scalar fallback.
 */
export async function getEffectiveTenderFacts(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<EffectiveTenderFactsResult> {
  const tender = await (prisma as any).tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, reference: true, clientName: true, procuringEntityName: true,
      deadline: true, submissionMethod: true, submissionEmails: true, submissionAddress: true,
      submissionEmailSubject: true, country: true, evaluationMethodology: true, description: true,
      intakeSummary: true, analysisSummary: true, category: true, metadataContaminated: true,
      analysisExtractionStatus: true, technicalWeight: true, financialWeight: true,
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true } },
      metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true } },
    },
  });

  if (!tender) {
    return emptyResult(tenderId, ["Tender not found"]);
  }

  // Manual overrides — the module doc for this function has always claimed
  // "manual overrides" as one of the four layers combined here, and
  // EffectiveTenderFactStatus/Source already define resolved_from_manual_
  // override / "manual" for exactly this, but no override was ever actually
  // queried or consulted. A USER_CONFIRMED/USER_EDITED override is a direct
  // human correction, so it is honored ahead of the parser/scalar fallback —
  // same as resolveEffectiveTenderFacts above and the older sibling
  // resolveEffectiveValue helper. NOT_APPLICABLE/IGNORED_WITH_REASON are
  // audited absences, not values, and are intentionally NOT consulted here
  // (matches the rest of the authority model).
  const overrideMap = new Map(
    (tender.metadataOverrides ?? []).map((o: any) => [o.field, o]),
  );
  function manualOverrideValue(field: string): string | null {
    const ov = overrideMap.get(field) as { fieldState: string; overrideValue: string | null } | undefined;
    if (ov && (ov.fieldState === "USER_EDITED" || ov.fieldState === "USER_CONFIRMED") && ov.overrideValue) {
      return ov.overrideValue;
    }
    return null;
  }

  const sourceText = buildTenderFactSourceText({
    extractedText: tender.files?.map((f: any) => f.extractedText).filter(Boolean).join("\n\n") || null,
    intakeSummary: tender.intakeSummary,
    analysisSummary: tender.analysisSummary,
    description: tender.description,
    evaluationMethodology: tender.evaluationMethodology,
  });

  const intelligence = sourceText.trim()
    ? parseTenderDocumentIntelligence(sourceText, {
        tenderTitle: tender.title,
        tenderReference: tender.reference,
        tenderClientName: tender.clientName,
        tenderSubmissionMethod: tender.submissionMethod,
        tenderDeadline: tender.deadline,
        tenderSubmissionEmails: tender.submissionEmails,
        tenderSubmissionAddress: tender.submissionAddress,
      })
    : null;

  let ledgerSnapshot: Awaited<ReturnType<typeof getTenderFactLedgerSnapshot>> | null = null;
  try {
    ledgerSnapshot = await getTenderFactLedgerSnapshot(prisma, tenderId);
  } catch {
    ledgerSnapshot = null;
  }

  const facts: EffectiveTenderFactEntry[] = [];
  const warnings: string[] = [];

  // Tender type
  const tenderType = intelligence?.tenderType && intelligence.tenderType !== "Unknown" ? intelligence.tenderType : null;
  facts.push({ key: "tenderType", label: "Tender Type", value: tenderType, status: tenderType ? "resolved_from_source_text" : "missing", requiredFor: "optional", source: tenderType ? "parser" : "none" });

  // Service streams
  const serviceStreams = intelligence?.serviceStreams ?? [];
  facts.push({ key: "serviceStreams", label: "Service Streams", value: serviceStreams.length > 0 ? serviceStreams : null, status: serviceStreams.length > 0 ? "resolved_from_source_text" : "missing", requiredFor: "optional", source: serviceStreams.length > 0 ? "parser" : "none" });

  // Project title (parser → scalar)
  const projectTitle = resolveSimple({ key: "projectTitle", label: "Project Title", parserValue: intelligence?.projectTitle ?? null, scalarValue: tender.title, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("title"), isClean: isCleanScalarValue, requiredFor: "draft_context", facts });

  // Client
  const clientOrProcuringEntity = resolveSimple({ key: "clientName", label: "Client / Procuring Entity", parserValue: intelligence?.clientOrProcuringEntity ?? null, scalarValue: tender.clientName || tender.procuringEntityName, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("clientName"), isClean: (v) => isCleanScalarValue(v) && isValidClientName(v), requiredFor: "draft_context", facts });

  // Reference
  const referenceNumber = resolveSimple({ key: "reference", label: "Reference Number", parserValue: null, scalarValue: tender.reference, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("reference"), isClean: (v) => isCleanScalarValue(v) && isValidReferenceNumber(v), requiredFor: "optional", facts });

  // Country
  const country = resolveSimple({ key: "country", label: "Country", parserValue: null, scalarValue: tender.country, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("country"), isClean: (v) => isCleanScalarValue(v) && isValidCountry(v), requiredFor: "optional", facts });

  // Deadline
  const parserDeadlineDisplay = intelligence?.submissionInstructions.deadlineDisplay ?? null;
  const parserDeadlineIso = intelligence?.submissionInstructions.deadlineIso ?? null;
  const deadlineResult = resolveDeadline(parserDeadlineDisplay, parserDeadlineIso, tender.deadline, ledgerSnapshot?.facts, manualOverrideValue("deadline"), facts);

  // Submission method
  const parserMethod = intelligence?.submissionInstructions.method && intelligence.submissionInstructions.method !== "Unknown" ? intelligence.submissionInstructions.method : null;
  const submissionMethod = resolveMethod(parserMethod, tender.submissionMethod, ledgerSnapshot?.facts, manualOverrideValue("submissionMethod"), facts);

  // Submission format
  const submissionFormat = intelligence?.submissionInstructions.format ?? null;
  facts.push({ key: "submissionFormat", label: "Submission Format", value: submissionFormat, status: submissionFormat ? "resolved_from_source_text" : "missing", requiredFor: "optional", source: submissionFormat ? "parser" : "none" });

  // Emails
  const parserEmails = intelligence?.submissionInstructions.emails ?? [];
  const scalarEmails = parserNormalizeEmailList(tender.submissionEmails);
  const submissionEmails = resolveEmails(parserEmails, scalarEmails, ledgerSnapshot?.facts, manualOverrideValue("submissionEmails"), facts);

  // Email subject
  const submissionEmailSubject = resolveSimple({ key: "submissionEmailSubject", label: "Email Subject", parserValue: intelligence?.submissionInstructions.emailSubject ?? null, scalarValue: tender.submissionEmailSubject, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("submissionEmailSubject"), isClean: isCleanScalarValue, requiredFor: "optional", facts });

  // Submission address
  const submissionAddress = resolveSimple({ key: "submissionAddress", label: "Submission Address", parserValue: intelligence?.submissionInstructions.physicalAddress ?? null, scalarValue: tender.submissionAddress, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("submissionAddress"), isClean: isCleanScalarValue, requiredFor: submissionMethod === "Physical" || submissionMethod === "Hybrid" ? "final_submission" : "optional", facts });

  // Financial proposal — per Pillar 6, default is UNKNOWN (null) instead of
  // true. Only set to true/false when the source explicitly states it.
  const financialProposalRequired: boolean | null = intelligence ? intelligence.financialProposalRequired : null;
  const financialProposalInstruction = financialProposalRequired === false ? "Not required at this stage. Do not generate a financial proposal." : null;
  facts.push({ key: "financialProposalRequired", label: "Financial Proposal Required", value: financialProposalRequired === null ? "Unknown" : financialProposalRequired ? "Yes" : "No", status: intelligence ? "resolved_from_source_text" : "missing", requiredFor: "optional", source: intelligence ? "parser" : "none" });

  // Evaluation methodology
  const evaluationMethodology = resolveSimple({ key: "evaluationMethodology", label: "Evaluation Methodology", parserValue: intelligence?.evaluationMethodology?.methodology ?? null, scalarValue: tender.evaluationMethodology, ledgerFacts: ledgerSnapshot?.facts, overrideValue: manualOverrideValue("evaluationMethodology"), isClean: isCleanScalarValue, requiredFor: "optional", facts });

  // Required documents
  const requiredDocuments = intelligence?.requiredDocuments.filter((d) => d.required).map((d) => d.name) ?? [];
  facts.push({ key: "requiredDocuments", label: "Required Documents", value: requiredDocuments.length > 0 ? requiredDocuments : null, status: requiredDocuments.length > 0 ? "resolved_from_source_text" : "missing", requiredFor: "optional", source: requiredDocuments.length > 0 ? "parser" : "none" });

  // Collect warnings
  for (const f of facts) {
    if (f.status === "missing" && (f.requiredFor === "draft_context" || f.requiredFor === "final_submission")) {
      warnings.push(`${f.label} is missing.`);
    }
  }

  return {
    tenderId,
    sourceTextHash: sourceText ? simpleHash(sourceText) : null,
    tenderType, serviceStreams, projectTitle, clientOrProcuringEntity, referenceNumber, country,
    deadlineDisplay: deadlineResult.display, deadlineIso: deadlineResult.iso,
    submissionMethod, submissionFormat, submissionEmails, submissionEmailSubject, submissionAddress,
    physicalSubmissionRequired: submissionMethod === "Physical" || submissionMethod === "Hybrid",
    portalSubmissionRequired: submissionMethod === "Portal" || submissionMethod === "Hybrid",
    financialProposalRequired, financialProposalInstruction, evaluationMethodology, requiredDocuments,
    facts, warnings,
  };
}

// ─── Resolution helpers ─────────────────────────────────────────────────────

function resolveSimple(args: {
  key: string; label: string; parserValue: string | null; scalarValue: string | null | undefined;
  ledgerFacts: ReadonlyArray<any> | undefined; overrideValue?: string | null; isClean: (v: string | null | undefined) => boolean;
  requiredFor: EffectiveTenderFactRequiredFor; facts: EffectiveTenderFactEntry[];
}): string | null {
  const { key, label, parserValue, scalarValue, ledgerFacts, overrideValue, isClean, requiredFor, facts } = args;
  const ledgerFact = ledgerFacts?.find((f) => f.semanticKey === key);
  if (ledgerFact) {
    const ls = String(ledgerFact.authorityState).toUpperCase();
    if (ls === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED || ls === "HUMAN_CONFIRMED_OPERATIONAL") {
      const value = ledgerFact.normalizedValue ?? ledgerFact.rawSourceValue;
      if (value) {
        facts.push({ key, label, value, status: "resolved_from_ledger", requiredFor, source: "ledger", sourcePage: ledgerFact.sourcePage ?? null, sourceQuote: ledgerFact.sourceQuote ?? null });
        return value;
      }
    }
    if (ls === AUTHORITY_STATE.NOT_APPLICABLE) {
      facts.push({ key, label, value: null, status: "not_applicable", requiredFor: "optional", source: "ledger" });
      return null;
    }
  }
  if (overrideValue && isClean(overrideValue)) {
    facts.push({ key, label, value: overrideValue, status: "resolved_from_manual_override", requiredFor, source: "manual" });
    return overrideValue;
  }
  if (parserValue && isClean(parserValue)) {
    facts.push({ key, label, value: parserValue, status: "resolved_from_source_text", requiredFor, source: "parser" });
    return parserValue;
  }
  if (scalarValue && isClean(scalarValue)) {
    facts.push({ key, label, value: scalarValue, status: "resolved_from_scalar_fallback", requiredFor, source: "scalar" });
    return scalarValue;
  }
  if (scalarValue && !isClean(scalarValue)) {
    facts.push({ key, label, value: null, status: "invalid", requiredFor, source: "none", blockerReason: `Scalar value is invalid or placeholder` });
  } else {
    facts.push({ key, label, value: null, status: "missing", requiredFor, source: "none" });
  }
  return null;
}

function resolveDeadline(
  parserDisplay: string | null, parserIso: string | null,
  scalarDeadline: Date | string | null,
  ledgerFacts: ReadonlyArray<any> | undefined,
  overrideValue: string | null,
  facts: EffectiveTenderFactEntry[],
): { display: string | null; iso: string | null } {
  const key = "deadline"; const label = "Submission Deadline";
  const ledgerFact = ledgerFacts?.find((f) => f.semanticKey === key);
  if (ledgerFact) {
    const ls = String(ledgerFact.authorityState).toUpperCase();
    if (ls === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED || ls === "HUMAN_CONFIRMED_OPERATIONAL") {
      const value = ledgerFact.normalizedValue ?? ledgerFact.rawSourceValue;
      if (value) {
        facts.push({ key, label, value, status: "resolved_from_ledger", requiredFor: "final_submission", source: "ledger" });
        return { display: value, iso: value };
      }
    }
  }
  if (overrideValue && isCleanDeadline(overrideValue)) {
    const d = new Date(overrideValue);
    const display = d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
    const iso = d.toISOString();
    facts.push({ key, label, value: display, status: "resolved_from_manual_override", requiredFor: "final_submission", source: "manual" });
    return { display, iso };
  }
  if (parserDisplay) {
    facts.push({ key, label, value: parserDisplay, status: "resolved_from_source_text", requiredFor: "final_submission", source: "parser" });
    return { display: parserDisplay, iso: parserIso };
  }
  if (isCleanDeadline(scalarDeadline)) {
    const d = scalarDeadline instanceof Date ? scalarDeadline : new Date(scalarDeadline as string);
    const display = d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
    const iso = d.toISOString();
    facts.push({ key, label, value: display, status: "resolved_from_scalar_fallback", requiredFor: "final_submission", source: "scalar" });
    return { display, iso };
  }
  facts.push({ key, label, value: null, status: "missing", requiredFor: "final_submission", source: "none" });
  return { display: null, iso: null };
}

function resolveMethod(
  parserMethod: string | null, scalarMethod: string | null | undefined,
  ledgerFacts: ReadonlyArray<any> | undefined,
  overrideValue: string | null,
  facts: EffectiveTenderFactEntry[],
): "Email" | "Portal" | "Physical" | "Hybrid" | "Unknown" {
  const key = "submissionMethod"; const label = "Submission Method";
  const ledgerFact = ledgerFacts?.find((f) => f.semanticKey === key);
  if (ledgerFact) {
    const ls = String(ledgerFact.authorityState).toUpperCase();
    if (ls === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED || ls === "HUMAN_CONFIRMED_OPERATIONAL") {
      const value = ledgerFact.normalizedValue ?? ledgerFact.rawSourceValue;
      if (value) {
        facts.push({ key, label, value, status: "resolved_from_ledger", requiredFor: "draft_context", source: "ledger" });
        return normalizeMethod(value);
      }
    }
  }
  if (overrideValue && isCleanScalarValue(overrideValue)) {
    facts.push({ key, label, value: overrideValue, status: "resolved_from_manual_override", requiredFor: "draft_context", source: "manual" });
    return normalizeMethod(overrideValue);
  }
  if (parserMethod) {
    facts.push({ key, label, value: parserMethod, status: "resolved_from_source_text", requiredFor: "draft_context", source: "parser" });
    return normalizeMethod(parserMethod);
  }
  if (scalarMethod && isCleanScalarValue(scalarMethod)) {
    facts.push({ key, label, value: scalarMethod, status: "resolved_from_scalar_fallback", requiredFor: "draft_context", source: "scalar" });
    return normalizeMethod(scalarMethod);
  }
  facts.push({ key, label, value: null, status: scalarMethod ? "invalid" : "missing", requiredFor: "draft_context", source: "none" });
  return "Unknown";
}

function resolveEmails(
  parserEmails: string[], scalarEmails: string[],
  ledgerFacts: ReadonlyArray<any> | undefined,
  overrideValue: string | null,
  facts: EffectiveTenderFactEntry[],
): string[] {
  const key = "submissionEmails"; const label = "Submission Emails";
  const ledgerFact = ledgerFacts?.find((f) => f.semanticKey === key);
  if (ledgerFact) {
    const ls = String(ledgerFact.authorityState).toUpperCase();
    if (ls === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED || ls === "HUMAN_CONFIRMED_OPERATIONAL") {
      const value = ledgerFact.normalizedValue ?? ledgerFact.rawSourceValue;
      if (value) {
        const emails = parserNormalizeEmailList(value);
        if (emails.length > 0) {
          facts.push({ key, label, value: emails, status: "resolved_from_ledger", requiredFor: "optional", source: "ledger" });
          return emails;
        }
      }
    }
  }
  if (overrideValue) {
    const overrideEmails = parserNormalizeEmailList(overrideValue);
    if (overrideEmails.length > 0) {
      facts.push({ key, label, value: overrideEmails, status: "resolved_from_manual_override", requiredFor: "optional", source: "manual" });
      return overrideEmails;
    }
  }
  if (parserEmails.length > 0) {
    facts.push({ key, label, value: parserEmails, status: "resolved_from_source_text", requiredFor: "optional", source: "parser" });
    return parserEmails;
  }
  if (scalarEmails.length > 0) {
    facts.push({ key, label, value: scalarEmails, status: "resolved_from_scalar_fallback", requiredFor: "optional", source: "scalar" });
    return scalarEmails;
  }
  facts.push({ key, label, value: null, status: "missing", requiredFor: "optional", source: "none" });
  return [];
}

function normalizeMethod(value: string): "Email" | "Portal" | "Physical" | "Hybrid" | "Unknown" {
  const lower = value.toLowerCase();
  if (lower.includes("hybrid")) return "Hybrid";
  if (lower.includes("portal") || lower.includes("e-procurement")) return "Portal";
  if (lower.includes("physical") || lower.includes("sealed") || lower.includes("hand") || lower.includes("courier")) return "Physical";
  if (lower.includes("email")) return "Email";
  return "Unknown";
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

function emptyResult(tenderId: string, warnings: string[]): EffectiveTenderFactsResult {
  return {
    tenderId, sourceTextHash: null, tenderType: null, serviceStreams: [],
    projectTitle: null, clientOrProcuringEntity: null, referenceNumber: null, country: null,
    deadlineDisplay: null, deadlineIso: null, submissionMethod: "Unknown", submissionFormat: null,
    submissionEmails: [], submissionEmailSubject: null, submissionAddress: null,
    physicalSubmissionRequired: false, portalSubmissionRequired: false,
    financialProposalRequired: null, financialProposalInstruction: null,
    evaluationMethodology: null, requiredDocuments: [], facts: [], warnings,
  };
}
