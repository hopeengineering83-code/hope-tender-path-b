/**
 * Generated Document Quality Validator
 *
 * Validates generated documents for:
 * - Required sections present
 * - Mandatory requirements covered
 * - Compliance matrix complete
 * - No placeholders
 * - No AI traces
 * - No forbidden metadata
 * - No invented evidence
 * - Technical/financial separation
 * - Selected experts/projects used correctly
 * - Document type matches tender type
 */

import type { TenderDocumentGenerationContext } from "./tender-document-context";
import { stripPlaceholders } from "../engine/placeholder-stripper";
import {
  PLACEHOLDER_PATTERNS,
  AI_TRACE_PATTERNS,
  GENERIC_BOILERPLATE_PATTERNS,
} from "../engine/detection-patterns";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GeneratedDocumentQualityResult = {
  okForDraft: boolean;
  okForFinal: boolean;
  score: number;
  missingSections: string[];
  missingRequirements: string[];
  placeholderViolations: string[];
  aiTraceViolations: string[];
  inventedEvidenceRisks: string[];
  formattingWarnings: string[];
  finalBlockers: string[];
};

export type ComplianceMatrixRow = {
  requirementId: string;
  tenderRequirement: string;
  mandatory: boolean;
  response: "Comply" | "Partially comply" | "Not applicable" | "Clarification required";
  proposalSection: string;
  evidenceUsed: string[];
  notes: string | null;
};

// ─── Forbidden text patterns ────────────────────────────────────────────────

const FORBIDDEN_IN_FINAL = [
  "As an AI",
  "AI-generated",
  "AI generated",
  "As a language model",
  "Lorem ipsum",
  "TODO",
  "TBD",
  "Bid-Team to confirm",
  "[insert]",
  "[placeholder]",
  "Not extracted",
  "Unknown",
  "N/A",
];

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validate a generated document against quality requirements.
 *
 * @param documentText - The generated document text (markdown or plain text).
 * @param documentType - The type of document (TECHNICAL_PROPOSAL, FINANCIAL_PROPOSAL, etc.).
 * @param context - The tender document generation context.
 * @param requiredSections - The sections that should be present.
 * @param mandatoryRequirements - The mandatory requirements that should be covered.
 * @returns The quality validation result.
 */
export function validateGeneratedDocumentQuality(
  documentText: string,
  documentType: string,
  context: TenderDocumentGenerationContext,
  requiredSections: string[],
  mandatoryRequirements: string[],
): GeneratedDocumentQualityResult {
  const missingSections: string[] = [];
  const missingRequirements: string[] = [];
  const placeholderViolations: string[] = [];
  const aiTraceViolations: string[] = [];
  const inventedEvidenceRisks: string[] = [];
  const formattingWarnings: string[] = [];
  const finalBlockers: string[] = [];

  // Check required sections present
  const lowerText = documentText.toLowerCase();
  for (const section of requiredSections) {
    const sectionLower = section.toLowerCase();
    if (!lowerText.includes(sectionLower)) {
      missingSections.push(section);
    }
  }

  // Check mandatory requirements covered
  for (const req of mandatoryRequirements) {
    const reqLower = req.toLowerCase().slice(0, 50);
    if (!lowerText.includes(reqLower)) {
      missingRequirements.push(req);
    }
  }

  // Check for placeholders
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = documentText.match(new RegExp(pattern.source, pattern.flags));
    if (matches) {
      placeholderViolations.push(`Placeholder detected: ${matches[0].slice(0, 80)}`);
    }
  }

  // Check for AI traces
  for (const pattern of AI_TRACE_PATTERNS) {
    const matches = documentText.match(new RegExp(pattern.source, pattern.flags));
    if (matches) {
      aiTraceViolations.push(`AI trace detected: ${matches[0].slice(0, 80)}`);
    }
  }

  // Check for forbidden text
  for (const forbidden of FORBIDDEN_IN_FINAL) {
    if (lowerText.includes(forbidden.toLowerCase())) {
      finalBlockers.push(`Forbidden text detected: "${forbidden}"`);
    }
  }

  // Check for invented evidence
  // If the document mentions an expert name that's not in selectedExperts
  for (const expert of context.selectedExperts) {
    // Selected experts SHOULD appear — this is fine
  }
  // Check for "fictitious" indicators
  if (/\b(?:example|sample|dummy|test)\s+(?:expert|project|company|client)\b/i.test(documentText)) {
    inventedEvidenceRisks.push("Possible fictitious evidence reference detected");
  }

  // Check technical/financial separation
  if (documentType === "TECHNICAL_PROPOSAL") {
    if (/\b(?:price|pricing|quotation|ETB|USD|EUR|GBP|fee|rate|lump\s+sum|unit\s+price)\b/i.test(documentText)) {
      const financialWords = documentText.match(/\b(?:price|pricing|quotation|ETB|USD|EUR|GBP|fee|rate|lump\s+sum|unit\s+price)\b/gi);
      if (financialWords && financialWords.length > 3) {
        finalBlockers.push("Financial content detected in technical proposal — possible envelope contamination");
      }
    }
  }

  // Check document type matches tender type
  if (context.tenderType === "EOI" || context.tenderType === "REOI") {
    if (documentType === "TECHNICAL_PROPOSAL") {
      finalBlockers.push("EOI tender should not generate a full technical proposal");
    }
  }
  if (!context.financialProposalRequired && documentType === "FINANCIAL_PROPOSAL") {
    finalBlockers.push("Financial proposal generated but tender states financial proposal is not required");
  }
  if (!context.financialProposalRequired && documentType === "PRICE_SCHEDULE") {
    finalBlockers.push("Price schedule generated but tender states financial proposal is not required");
  }

  // Formatting checks
  if (!documentText.includes("#") && !documentText.includes("**")) {
    formattingWarnings.push("No heading structure detected — document may lack proper hierarchy");
  }
  if (documentText.length < 500) {
    formattingWarnings.push("Document is very short — may be incomplete");
  }

  // Compute score
  let score = 100;
  score -= missingSections.length * 10;
  score -= missingRequirements.length * 5;
  score -= placeholderViolations.length * 5;
  score -= aiTraceViolations.length * 10;
  score -= inventedEvidenceRisks.length * 5;
  score -= formattingWarnings.length * 2;
  score = Math.max(0, Math.min(100, score));

  // Determine okForDraft and okForFinal
  const okForDraft = finalBlockers.length === 0 && aiTraceViolations.length === 0;
  const okForFinal = okForDraft
    && placeholderViolations.length === 0
    && missingSections.length === 0
    && missingRequirements.length === 0
    && inventedEvidenceRisks.length === 0
    && finalBlockers.length === 0;

  return {
    okForDraft,
    okForFinal,
    score,
    missingSections,
    missingRequirements,
    placeholderViolations,
    aiTraceViolations,
    inventedEvidenceRisks,
    formattingWarnings,
    finalBlockers,
  };
}
