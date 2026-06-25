// Single source of truth for turning an AI analysis result into the canonical
// Tender update payload (client/procuring-entity metadata, submission details,
// source-traceability columns, and the metadataContaminated flag).
//
// This module is intentionally Prisma-free. It supplies a runtime contract so
// every caller can reject unsupported Tender keys before a database write. That
// prevents a deployment with stale mapper code from leaking raw Prisma errors
// or partially promoting an analysis.

import type { AIAnalysisResult } from "../ai";
import {
  containsMetadataPlaceholder,
  isValidClientContact,
  isValidCountry,
  isValidReferenceNumber,
} from "./metadata-validators";
import { detectMetadataContamination } from "./tender-metadata-completeness";

export type CanonicalAnalysisExisting = {
  clientName?: string | null;
  submissionMethod?: string | null;
  submissionEmails?: string | null;
  notes?: string | null;
};

export type CanonicalAnalysisUpdate = {
  data: Record<string, unknown>;
  metadataContaminated: boolean;
};

/**
 * Contract for every value that may be passed to prisma.tender.update during
 * canonical AI promotion. Keep this list aligned with prisma/schema.prisma.
 * Classification-only AI fields belong in their own canonical records, not in
 * Tender unless a reviewed schema migration adds them.
 */
export const CANONICAL_TENDER_UPDATE_FIELDS = [
  "analysisSummary",
  "title",
  "evaluationMethodology",
  "exactFileNaming",
  "exactFileOrder",
  "category",
  "notes",
  "status",
  "stage",
  "procuringEntityName",
  "clientName",
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "country",
  "clientAddress",
  "clientContactName",
  "clientContactTitle",
  "clientContactEmail",
  "clientContactPhone",
  "submissionAddress",
  "clientCity",
  "clientWebsite",
  "submissionEmailSubject",
  "preBidChannel",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "clientRepresentative",
  "reference",
  "submissionMethod",
  "submissionEmails",
  "clientNameSourcePage",
  "clientNameSourceQuote",
  "submissionEmailSourcePage",
  "contactDetailsSourceJson",
  "submissionMethodSourcePage",
  "submissionMethodSourceQuote",
  "submissionAddressSourcePage",
  "submissionAddressSourceQuote",
  "evaluationCriteriaSourceJson",
  "metadataContaminated",
  "analysisExtractionStatus",
] as const;

const CANONICAL_TENDER_UPDATE_FIELD_SET = new Set<string>(CANONICAL_TENDER_UPDATE_FIELDS);

/**
 * Fails closed before Prisma when a caller tries to append an unsupported
 * field. This is deliberately reusable by streaming, HTTP, and durable paths.
 */
export function assertCanonicalTenderUpdateFields(data: Record<string, unknown>): void {
  const unsupported = Object.keys(data).filter((key) => !CANONICAL_TENDER_UPDATE_FIELD_SET.has(key));
  if (unsupported.length > 0) {
    throw new Error(`CANONICAL_TENDER_UPDATE_CONTRACT_FAILED: ${unsupported.join(", ")}`);
  }
}

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
 * Build the canonical Tender update payload from a complete AI analysis.
 * Placeholder and contaminated values are blocked before they become factual
 * tender metadata. Callers must still enforce promotion and ZIP gates.
 */
export function buildCanonicalAnalysisTenderUpdate(
  aiResult: AIAnalysisResult,
  existing: CanonicalAnalysisExisting = {},
): CanonicalAnalysisUpdate {
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

  assertCanonicalTenderUpdateFields(data);
  return { data, metadataContaminated };
}
