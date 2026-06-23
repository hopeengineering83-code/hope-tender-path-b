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
    evaluationMethodology: aiResult.evaluationMethodology || null,
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
    ...(aiResult.contactDetailsSource != null ? { contactDetailsSourceJson: JSON.stringify(aiResult.contactDetailsSource) } : {}),
    ...(aiResult.submissionMethodSourcePage !== undefined ? { submissionMethodSourcePage: aiResult.submissionMethodSourcePage } : {}),
    ...(aiResult.submissionMethodSourceQuote !== undefined ? { submissionMethodSourceQuote: aiResult.submissionMethodSourceQuote } : {}),
    ...(aiResult.submissionAddressSourcePage !== undefined ? { submissionAddressSourcePage: aiResult.submissionAddressSourcePage } : {}),
    ...(aiResult.submissionAddressSourceQuote !== undefined ? { submissionAddressSourceQuote: aiResult.submissionAddressSourceQuote } : {}),
    ...(aiResult.evaluationCriteriaSource !== undefined ? { evaluationCriteriaSourceJson: aiResult.evaluationCriteriaSource ? JSON.stringify(aiResult.evaluationCriteriaSource) : null } : {}),
    metadataContaminated,
  };

  return { data, metadataContaminated };
}
