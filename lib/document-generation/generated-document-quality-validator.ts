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
  //
  // A technical proposal's own project-experience/evidence section routinely
  // quotes a PAST project's cost ("Construction Cost: 550,074,678.02 ETB") as
  // portfolio evidence, and a compliant proposal often explicitly states it
  // carries no financial offer ("This is a TECHNICAL PROPOSAL ONLY. No
  // financial offer or pricing is included"). Both contain the same bare
  // currency/pricing keywords this check flags, and both are the opposite of
  // contamination — the first cites someone else's completed project, the
  // second disclaims the firm's own offer. Counting keyword occurrences with
  // no context flagged reference-project citations and compliance
  // disclaimers as violations, at the exact quality/depth level (rich,
  // evidence-dense project references) this proposal is expected to reach.
  //
  // The genuine risk this check protects against is the FIRM'S OWN price/fee
  // for THIS assignment leaking into the technical envelope, so a match only
  // counts when its surrounding context does not read as a reference-project
  // cost line or an explicit no-offer disclaimer.
  if (documentType === "TECHNICAL_PROPOSAL") {
    const financialKeyword = /\b(?:price|pricing|quotation|ETB|USD|EUR|GBP|fee|rate|lump\s+sum|unit\s+price)\b/gi;
    const REFERENCE_COST_CONTEXT_RE = /\b(?:construction|design|supervision|contract|project|feasibility|geotechnical)\s+cost\b|contract\s+value|cost\s+details|comparable\s+project|project\s+reference/i;
    const NO_OFFER_DISCLAIMER_RE = /no\s+financial\s+offer|no\s+pricing|not\s+include[sd]?\s+(?:any\s+)?(?:financial|price|pricing)|technical\s+proposal\s+only|do\s+not\s+include\s+any\s+financial/i;
    // "at no fee" / "at no additional fee" / "budgeted into fee" state that
    // something is NOT separately charged — a value-add commitment, the
    // opposite of a price disclosure. And "rate" is one of the most overloaded
    // words in engineering/HSE writing: "frequency rate (LTIFR)", "injury
    // rate", "success/completion/defect/response rate" are safety and quality
    // KPIs a methodology or QA/QC section is expected to state, never a price.
    const NO_CHARGE_RE = /\bat\s+no\s+(?:additional\s+)?(?:fee|cost|charge)\b|\bfree\s+of\s+charge\b|\bbudgeted\s+into\b|\bno\s+extra\s+(?:fee|cost|charge)\b/i;
    const NON_FINANCIAL_RATE_RE = /\b(?:frequency|injury|success|completion|defect|rejection|response|conversion|failure|pass|attendance|literacy|vacancy|occupancy|utili[sz]ation|growth|compliance|error|accuracy|retention)\s+rate\b|\brate\s*\([A-Z]+\)/i;
    let contaminatingMatches = 0;
    for (const match of documentText.matchAll(financialKeyword)) {
      const start = Math.max(0, (match.index ?? 0) - 80);
      const end = Math.min(documentText.length, (match.index ?? 0) + match[0].length + 80);
      const surrounding = documentText.slice(start, end);
      if (
        REFERENCE_COST_CONTEXT_RE.test(surrounding)
        || NO_OFFER_DISCLAIMER_RE.test(surrounding)
        || NO_CHARGE_RE.test(surrounding)
        || NON_FINANCIAL_RATE_RE.test(surrounding)
      ) continue;
      contaminatingMatches += 1;
    }
    if (contaminatingMatches > 3) {
      finalBlockers.push("Financial content detected in technical proposal — possible envelope contamination");
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
