/**
 * Draft vs Final Gate Separation
 *
 * Four separate categories of metadata/requirement issues:
 *
 * A. Operational metadata warnings — never block draft work
 * B. Submission-critical metadata blockers — block only final export
 * C. Requirement extraction blockers — block AI analysis
 * D. Final-export blockers — block final export/ZIP
 *
 * Operational warnings include: missing reference, uncertain title, missing
 * country, missing donor, missing client website, missing postal address,
 * missing contact phone, uncertain budget, unknown category, missing optional
 * email subject. These must NEVER block: tender upload, source extraction,
 * OCR, AI analysis, requirement extraction, classification, service matching,
 * company evidence matching, CV matching, project-reference matching, draft
 * BuildPlan, draft technical proposal, draft financial proposal structure.
 *
 * Final blockers include: no deadline, no usable submission endpoint,
 * unresolved envelope conflict, missing mandatory document, unresolved
 * mandatory bid security, required proposal language unresolved, confirmed
 * BuildPlan mismatch, mandatory source requirement unresolved, mandatory PDF
 * output unavailable, invalid final ZIP contents.
 */

import { isCriticalField, type TenderPolicyContext } from "./tender-policy-registry";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";

// ─── Operational metadata warnings (never block draft) ─────────────────────

export const OPERATIONAL_WARNING_FIELDS = new Set([
  "reference",
  "country",
  "currency",
  "clientContactName",
  "clientContactEmail",
  "clientContactPhone",
  "clientContactTitle",
  "clientCity",
  "clientAddress",
  "clientWebsite",
  "clientRepresentative",
  "donorAgency",
  "implementingAgency",
  "legalClientName",
  "preBidChannel",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "submissionEmailSubject",
  "evaluationCriteria",
  "evaluationMethodology",
]);

/**
 * Check if a field is an operational warning (not blocking for draft work).
 */
export function isOperationalWarning(field: string): boolean {
  return OPERATIONAL_WARNING_FIELDS.has(field);
}

// ─── Submission-critical blockers (block only final export) ─────────────────

export const SUBMISSION_CRITICAL_FIELDS = new Set([
  "clientName",
  "title",
  "deadline",
  "submissionMethod",
  "submissionEndpoint",
]);

/**
 * Check if a field is submission-critical (blocks final export, not draft).
 */
export function isSubmissionCritical(field: string): boolean {
  return SUBMISSION_CRITICAL_FIELDS.has(field);
}

// ─── Gate category determination ────────────────────────────────────────────

export type GateCategory = "operational-warning" | "submission-critical" | "requirement-blocker" | "final-export-blocker";

export type GateDecision = {
  category: GateCategory;
  blocksDraft: boolean;
  blocksFinalExport: boolean;
  blocksAIAnalysis: boolean;
  label: string;
  description: string;
};

/**
 * Determine the gate category for a field based on its state.
 *
 * Operational warnings → display "WARNING — REVIEW WHEN AVAILABLE", never block.
 * Submission-critical → block final export only.
 * Requirement blockers → block AI analysis.
 * Final-export blockers → block final export + ZIP.
 */
export function determineGateCategory(
  field: string,
  hasValue: boolean,
  isGrounded: boolean,
  isOverridden: boolean,
  policyCtx: TenderPolicyContext,
): GateDecision {
  // Requirement extraction blockers (handled separately by the engine)
  if (field === "requiredDocuments") {
    return {
      category: "requirement-blocker",
      blocksDraft: true,
      blocksFinalExport: true,
      blocksAIAnalysis: true,
      label: "Requirement extraction blocker",
      description: "No requirements have been extracted. Run AI Analyze or manually enter requirements.",
    };
  }

  // Submission-critical fields
  const isCritical = isCriticalField(field, policyCtx);
  if (isCritical && !hasValue && !isOverridden) {
    return {
      category: "submission-critical",
      blocksDraft: false, // Draft work can proceed
      blocksFinalExport: true, // Final export blocked
      blocksAIAnalysis: false,
      label: "Submission-critical blocker",
      description: `Field "${field}" is required for final submission but is missing. Draft work can proceed.`,
    };
  }

  if (isCritical && hasValue && !isGrounded && !isOverridden) {
    return {
      category: "submission-critical",
      blocksDraft: false, // Draft work can proceed with ungrounded critical field
      blocksFinalExport: true, // Final export blocked until grounded
      blocksAIAnalysis: false,
      label: "Submission-critical blocker",
      description: `Field "${field}" has a value but is not source-grounded. Draft work can proceed. Final export requires grounding.`,
    };
  }

  // Operational warnings
  if (isOperationalWarning(field) && !hasValue && !isOverridden) {
    return {
      category: "operational-warning",
      blocksDraft: false,
      blocksFinalExport: false,
      blocksAIAnalysis: false,
      label: "WARNING — REVIEW WHEN AVAILABLE",
      description: `Optional field "${field}" is missing. This does not block any workflow.`,
    };
  }

  // Default: not blocking
  return {
    category: "operational-warning",
    blocksDraft: false,
    blocksFinalExport: false,
    blocksAIAnalysis: false,
    label: "OK",
    description: "",
  };
}

/**
 * Check if AI analysis is blocked based on extraction state.
 *
 * AI analysis is blocked when:
 * - Page count is unknown
 * - Pages are missing
 * - Failed pages exist
 * - OCR output is corrupted
 * - Text quality is below threshold
 */
export function isAIAnalysisBlocked(opts: {
  hasUnknownPageCount: boolean;
  hasMissingPages: boolean;
  hasFailedPages: boolean;
  isCorrupted: boolean;
  extractionScore: number | null;
}): { blocked: boolean; reason: string | null } {
  if (opts.hasUnknownPageCount) {
    return { blocked: true, reason: "Source page count is unknown. Upload a PDF with a known page count." };
  }
  if (opts.hasMissingPages) {
    return { blocked: true, reason: "Source pages are missing. Run Repair Extraction to recover missing pages." };
  }
  if (opts.hasFailedPages) {
    return { blocked: true, reason: "Failed pages exist. Run Repair Extraction to fix failed pages." };
  }
  if (opts.isCorrupted) {
    return { blocked: true, reason: "Extraction text is corrupted. Run Repair Extraction or enable OCR." };
  }
  if (opts.extractionScore !== null && opts.extractionScore < 40) {
    return { blocked: true, reason: `Extraction quality score (${opts.extractionScore}) is below threshold (40). Run Repair Extraction.` };
  }
  return { blocked: false, reason: null };
}
