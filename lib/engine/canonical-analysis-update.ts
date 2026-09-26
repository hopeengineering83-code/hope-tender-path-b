// Single source of truth for turning an AI analysis result into the canonical
// Tender update payload (client/procuring-entity metadata, submission details,
// source-traceability columns, and the metadataContaminated flag).
//
// Previously this ~30-field mapping was duplicated inline in THREE places:
//   - the streaming AI Analyze route (handleStreamingAnalyze)
//   - the non-streaming AI Analyze route (POST)
//   - the durable worker (lib/ai-jobs/analysis-job-service.ts finalizeJob)
//
// The duplication caused real divergence bugs (PR #855: the non-streaming and
// durable paths dropped req.sourceSectionHeading; the durable path persisted NO
// client metadata at all and skipped contamination detection). Centralising the
// mapping here guarantees every analysis path writes identical, fully-traceable
// canonical metadata and runs the same contamination check — satisfying the
// CLAUDE.md requirements for client extraction (priority #3) and contamination
// blocking (priority #6).
//
// This module is PURE: no Prisma, no I/O. It returns a plain data object the
// caller spreads into its own `tx.tender.update({ data })`, plus the computed
// `metadataContaminated` flag. That keeps it trivially unit-testable without a
// database.

import type { AIAnalysisResult } from "../ai";
import {
  containsMetadataPlaceholder,
  isValidClientContact,
  isValidCountry,
  isValidReferenceNumber,
} from "./metadata-validators";
import { detectMetadataContamination } from "./tender-metadata-completeness";

export type CanonicalAnalysisExisting = {
  // Existing canonical values that gate whether the AI value is allowed to
  // overwrite them (mirrors the route's conditional spreads exactly).
  clientName?: string | null;
  submissionMethod?: string | null;
  submissionEmails?: string | null;
  notes?: string | null;
  // Per-field source file IDs, resolved by the caller from the ACTUAL extraction
  // evidence (the active file whose extracted text contains the field's
  // supporting quote — see attributeMetadataSourceFileId). Each is the real
  // source file id, or null when the quote is missing / not found in any active
  // file (→ ungrounded). A key left undefined leaves that column untouched.
  clientNameSourceFileId?: string | null;
  submissionMethodSourceFileId?: string | null;
  submissionAddressSourceFileId?: string | null;
  submissionEmailSourceFileId?: string | null;
  // Source file IDs for title and deadline evidence — resolved by the caller
  // from the AI's tenderTitleSourceQuote and deadlineSourceQuote via
  // attributeMetadataSourceFileId. Without these, BuildPlan preflight cannot
  // pass source-evidence validation for title or deadline.
  titleSourceFileId?: string | null;
  deadlineSourceFileId?: string | null;
  // Existing contactDetailsSourceJson — when provided, AI's contactDetailsSource
  // is MERGED with this (preserving fileId for entries AI doesn't re-emit).
  // Without this, AI re-runs would overwrite the entire JSON and lose
  // repair-written fileId for procurementReferenceNumber.
  existingContactDetailsSourceJson?: string | null;
};

export type CanonicalAnalysisUpdate = {
  // Spread directly into prisma `tx.tender.update({ data })`. Typed loosely on
  // purpose so this module stays Prisma-agnostic and unit-testable.
  data: Record<string, unknown>;
  // True when any client/entity field is contaminated by portal noise / unrelated
  // text. Callers persist this as Tender.metadataContaminated (it is already
  // included in `data`, but is returned separately for logging/diagnostics).
  metadataContaminated: boolean;
};

function canonicalEvaluationMethodology(aiResult: AIAnalysisResult): string | null {
  const methodology = aiResult.evaluationMethodology?.trim();
  if (methodology) return methodology;
  const criteria = aiResult.evaluationCriteriaSource;
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  const lines = criteria
    .map((item) => {
      const criterion = item?.criterion?.trim();
      if (!criterion) return null;
      // Weight is source text (for example "40 points", "25%", or
      // "pass/fail"), not necessarily a percentage. Preserve it verbatim;
      // coercing every value to `%` silently changes the tender's scoring rule.
      const statedWeight = typeof item.weight === "string" ? item.weight.trim() : "";
      const weight = statedWeight ? ` — ${statedWeight}` : " — weight not stated";
      return `${criterion}${weight}`;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : null;
}

// The single note line every AI promotion appends, after stripping any prior
// analysis-source / fallback-diagnostics lines.
const AI_ANALYSIS_NOTE = "Analysis source: AI (re-run via AI Analyze button).";

export function buildAnalysisNotes(existingNotes: string | null | undefined): string | null {
  const lines = (existingNotes ?? "").split("\n");
  return (
    lines
      .filter(
        (line) =>
          !/^Analysis source:/i.test(line.trim()) &&
          !/^Analysis fallback diagnostics:/i.test(line.trim()),
      )
      .concat([AI_ANALYSIS_NOTE])
      .join("\n")
      .trim() || null
  );
}

/**
 * Build the canonical Tender update payload from an AI analysis result.
 *
 * Mirrors the proven streaming-path mapping verbatim: every client/contact/
 * submission field is gated by the same validators (containsMetadataPlaceholder,
 * isValidClientContact, isValidCountry, isValidReferenceNumber) so placeholder
 * text ("Bid-Team to confirm", "TBD", "N/A") never enters canonical metadata,
 * and submissionMethod/submissionEmails only fill when not already set.
 */
/**
 * Merge AI's contactDetailsSource with the existing contactDetailsSourceJson.
 *
 * AI re-runs must NOT destroy repair-written fileId entries. When AI emits
 * a contactDetailsSource, we merge it with the existing JSON:
 *   - For keys AI re-emits: AI's value wins (AI may update page/quote), but
 *     if AI's entry lacks fileId, preserve the existing fileId.
 *   - For keys AI does NOT re-emit: preserve the existing entry entirely
 *     (including fileId).
 *
 * This prevents the "AI re-run silently ungrounds reference" bug where a
 * repair-written procurementReferenceNumber.fileId would be lost.
 */
function mergeContactDetailsSource(
  aiSource: Record<string, { page: number | null; quote: string | null; fileId?: string | null }>,
  existingJson: string | null | undefined,
): Record<string, { page: number | null; quote: string | null; fileId?: string | null }> {
  // Parse existing JSON (tolerant of null/malformed)
  let existing: Record<string, { page?: number | null; quote?: string | null; fileId?: string | null }> = {};
  if (existingJson) {
    try {
      existing = typeof existingJson === "string" ? JSON.parse(existingJson) : (existingJson ?? {});
    } catch {
      existing = {};
    }
  }

  const merged: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> = {};

  // First, copy all existing entries (preserves entries AI doesn't re-emit)
  for (const [key, val] of Object.entries(existing)) {
    if (val && typeof val === "object") {
      merged[key] = {
        page: typeof val.page === "number" ? val.page : null,
        quote: typeof val.quote === "string" ? val.quote : null,
        fileId: typeof val.fileId === "string" && val.fileId.length > 0 ? val.fileId : null,
      };
    }
  }

  // Then, overlay AI's entries. AI wins for page/quote. For fileId:
  //   - If AI provides a fileId (rare — only from guardAiPageNumbers), use it.
  //   - If AI does NOT provide a fileId BUT the quote is UNCHANGED from the
  //     existing entry, preserve the existing fileId (it's still valid for
  //     the same quote).
  //   - If AI does NOT provide a fileId AND the quote CHANGED, drop the
  //     existing fileId (it was attributed to the OLD quote and may not
  //     point to a file containing the NEW quote). Let resolveReferenceFileId
  //     or a subsequent repair re-resolve it.
  for (const [key, val] of Object.entries(aiSource)) {
    if (val && typeof val === "object") {
      const existingEntry = merged[key];
      const existingFileId = existingEntry?.fileId ?? null;
      const existingQuote = existingEntry?.quote ?? null;
      const newQuote = val.quote ?? null;
      const quotesMatch = existingQuote !== null && newQuote !== null &&
        existingQuote.toLowerCase().replace(/\s+/g, " ").trim() === newQuote.toLowerCase().replace(/\s+/g, " ").trim();
      const aiFileId = typeof val.fileId === "string" && val.fileId.length > 0 ? val.fileId : null;
      // Preserve existing fileId only when AI doesn't provide one AND the quote is unchanged
      const fileId = aiFileId ?? (quotesMatch ? existingFileId : null) ?? null;
      merged[key] = {
        page: val.page ?? null,
        quote: newQuote,
        fileId,
      };
    }
  }

  return merged;
}

export function buildCanonicalAnalysisTenderUpdate(
  aiResult: AIAnalysisResult,
  existing: CanonicalAnalysisExisting = {},
): CanonicalAnalysisUpdate {
  // Contamination is evaluated on the effective client name (AI value, falling
  // back to the existing canonical clientName) plus the other entity fields.
  const clientNameForContaminationCheck = aiResult.procuringEntityName || existing.clientName;
  const metadataContaminated =
    detectMetadataContamination(clientNameForContaminationCheck).contaminated ||
    detectMetadataContamination(aiResult.legalClientName).contaminated ||
    detectMetadataContamination(aiResult.donorAgency).contaminated ||
    detectMetadataContamination(aiResult.implementingAgency).contaminated ||
    detectMetadataContamination(aiResult.clientAddress).contaminated ||
    detectMetadataContamination(aiResult.submissionAddress).contaminated ||
    detectMetadataContamination(aiResult.clientContactName).contaminated;

  const data: Record<string, unknown> = {
    analysisSummary: aiResult.summary,
    ...(aiResult.tenderTitle && !containsMetadataPlaceholder(aiResult.tenderTitle) ? { title: aiResult.tenderTitle } : {}),
    // Source evidence for title (page/quote extracted by AI, source file ID
    // resolved by the caller from the quote). Persisted so BuildPlan preflight
    // can verify quote containment against the active file.
    ...(aiResult.tenderTitleSourcePage !== undefined ? { titleSourcePage: aiResult.tenderTitleSourcePage } : {}),
    ...(aiResult.tenderTitleSourceQuote !== undefined ? { titleSourceQuote: aiResult.tenderTitleSourceQuote } : {}),
    ...(existing.titleSourceFileId !== undefined ? { titleSourceFileId: existing.titleSourceFileId } : {}),
    // Deadline value (ISO date string) — persisted as Tender.deadline so
    // downstream gates can read it without re-running AI. Validated to ISO
    // YYYY-MM-DD format by the parser before reaching here.
    ...(aiResult.deadline ? { deadline: new Date(aiResult.deadline) } : {}),
    // Source evidence for deadline (page/quote extracted by AI, source file ID
    // resolved by the caller from the quote).
    ...(aiResult.deadlineSourcePage !== undefined ? { deadlineSourcePage: aiResult.deadlineSourcePage } : {}),
    ...(aiResult.deadlineSourceQuote !== undefined ? { deadlineSourceQuote: aiResult.deadlineSourceQuote } : {}),
    ...(existing.deadlineSourceFileId !== undefined ? { deadlineSourceFileId: existing.deadlineSourceFileId } : {}),
    evaluationMethodology: canonicalEvaluationMethodology(aiResult),
    exactFileNaming: JSON.stringify(aiResult.exactFileNaming),
    exactFileOrder: JSON.stringify(aiResult.exactFileOrder),
    ...(aiResult.tenderCategory ? { category: aiResult.tenderCategory } : {}),
    notes: buildAnalysisNotes(existing.notes),
    status: "AI_ANALYZED",
    stage: "ANALYSIS",
    ...(aiResult.procuringEntityName != null && !containsMetadataPlaceholder(aiResult.procuringEntityName)
      ? { procuringEntityName: aiResult.procuringEntityName, ...(!existing.clientName ? { clientName: aiResult.procuringEntityName } : {}) }
      : {}),
    ...(aiResult.legalClientName != null && !containsMetadataPlaceholder(aiResult.legalClientName) ? { legalClientName: aiResult.legalClientName } : {}),
    ...(aiResult.donorAgency != null && !containsMetadataPlaceholder(aiResult.donorAgency) ? { donorAgency: aiResult.donorAgency } : {}),
    ...(aiResult.implementingAgency != null && !containsMetadataPlaceholder(aiResult.implementingAgency) ? { implementingAgency: aiResult.implementingAgency } : {}),
    ...(aiResult.country != null && isValidCountry(aiResult.country) ? { country: aiResult.country } : {}),
    ...(aiResult.clientAddress != null && !containsMetadataPlaceholder(aiResult.clientAddress) ? { clientAddress: aiResult.clientAddress } : {}),
    ...(aiResult.clientContactName != null && isValidClientContact(aiResult.clientContactName) ? { clientContactName: aiResult.clientContactName } : {}),
    ...(aiResult.clientContactTitle != null && !containsMetadataPlaceholder(aiResult.clientContactTitle) ? { clientContactTitle: aiResult.clientContactTitle } : {}),
    ...(aiResult.clientContactEmail != null && !containsMetadataPlaceholder(aiResult.clientContactEmail) ? { clientContactEmail: aiResult.clientContactEmail } : {}),
    ...(aiResult.clientContactPhone != null && !containsMetadataPlaceholder(aiResult.clientContactPhone) ? { clientContactPhone: aiResult.clientContactPhone } : {}),
    ...(aiResult.submissionAddress != null && !containsMetadataPlaceholder(aiResult.submissionAddress) ? { submissionAddress: aiResult.submissionAddress } : {}),
    ...(aiResult.clientCity != null && !containsMetadataPlaceholder(aiResult.clientCity) ? { clientCity: aiResult.clientCity } : {}),
    ...(aiResult.clientWebsite != null && !containsMetadataPlaceholder(aiResult.clientWebsite) ? { clientWebsite: aiResult.clientWebsite } : {}),
    ...(aiResult.submissionEmailSubject != null && !containsMetadataPlaceholder(aiResult.submissionEmailSubject) ? { submissionEmailSubject: aiResult.submissionEmailSubject } : {}),
    ...(aiResult.preBidChannel != null && !containsMetadataPlaceholder(aiResult.preBidChannel) ? { preBidChannel: aiResult.preBidChannel } : {}),
    ...(aiResult.preBidMeetingDate != null ? { preBidMeetingDate: new Date(aiResult.preBidMeetingDate) } : {}),
    ...(aiResult.preBidMeetingLocation != null && !containsMetadataPlaceholder(aiResult.preBidMeetingLocation) ? { preBidMeetingLocation: aiResult.preBidMeetingLocation } : {}),
    ...(aiResult.clientRepresentative != null && !containsMetadataPlaceholder(aiResult.clientRepresentative) ? { clientRepresentative: aiResult.clientRepresentative } : {}),
    ...(aiResult.procurementReferenceNumber != null && isValidReferenceNumber(aiResult.procurementReferenceNumber) ? { reference: aiResult.procurementReferenceNumber } : {}),
    ...(aiResult.submissionMethod != null && !existing.submissionMethod ? { submissionMethod: aiResult.submissionMethod } : {}),
    ...(aiResult.submissionEmails != null && !existing.submissionEmails ? { submissionEmails: aiResult.submissionEmails } : {}),
    ...(aiResult.clientNameSourcePage !== undefined ? { clientNameSourcePage: aiResult.clientNameSourcePage } : {}),
    ...(aiResult.clientNameSourceQuote !== undefined ? { clientNameSourceQuote: aiResult.clientNameSourceQuote } : {}),
    ...(aiResult.submissionEmailSourcePage !== undefined ? { submissionEmailSourcePage: aiResult.submissionEmailSourcePage } : {}),
    // Persist the submission email source quote so BuildPlan preflight can
    // verify quote containment against the active file (previously only the
    // file ID and page were stored, so email evidence could not be verified).
    ...(aiResult.submissionEmailSourceQuote !== undefined ? { submissionEmailSourceQuote: aiResult.submissionEmailSourceQuote } : {}),
    ...(aiResult.contactDetailsSource != null ? { contactDetailsSourceJson: JSON.stringify(mergeContactDetailsSource(aiResult.contactDetailsSource, existing.existingContactDetailsSourceJson ?? null)) } : {}),
    ...(aiResult.submissionMethodSourcePage !== undefined ? { submissionMethodSourcePage: aiResult.submissionMethodSourcePage } : {}),
    ...(aiResult.submissionMethodSourceQuote !== undefined ? { submissionMethodSourceQuote: aiResult.submissionMethodSourceQuote } : {}),
    ...(aiResult.submissionAddressSourcePage !== undefined ? { submissionAddressSourcePage: aiResult.submissionAddressSourcePage } : {}),
    ...(aiResult.submissionAddressSourceQuote !== undefined ? { submissionAddressSourceQuote: aiResult.submissionAddressSourceQuote } : {}),
    // Bind each metadata field's source evidence to the ACTUAL file the caller
    // resolved from the supporting quote (attributeMetadataSourceFileId). The
    // value is the real source file id or null (ungrounded); a column is only
    // written when the caller supplied that key.
    ...(existing.clientNameSourceFileId !== undefined ? { clientNameSourceFileId: existing.clientNameSourceFileId } : {}),
    ...(existing.submissionMethodSourceFileId !== undefined ? { submissionMethodSourceFileId: existing.submissionMethodSourceFileId } : {}),
    ...(existing.submissionAddressSourceFileId !== undefined ? { submissionAddressSourceFileId: existing.submissionAddressSourceFileId } : {}),
    ...(existing.submissionEmailSourceFileId !== undefined ? { submissionEmailSourceFileId: existing.submissionEmailSourceFileId } : {}),
    ...(aiResult.evaluationCriteriaSource !== undefined ? { evaluationCriteriaSourceJson: aiResult.evaluationCriteriaSource ? JSON.stringify(aiResult.evaluationCriteriaSource) : null } : {}),
    metadataContaminated,
  };

  return { data, metadataContaminated };
}
