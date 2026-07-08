// lib/engine/source-driven-tender-detail.ts
//
// Source-driven tender fact model. The tender document is the authority —
// not a predesigned fixed metadata format. This module defines the types
// and helpers for deriving tender facts from extracted source evidence.
//
// Key principles:
//   • Facts come from the tender source text, not from a hardcoded list
//   • A fact is "required" only when the tender itself requires it
//   • Missing optional facts never block draft work
//   • Final Submission Check applies only tender-derived requirements
//   • No universal "always critical" field list drives draft workflow

export type SourceDrivenFactStatus =
  | "extracted_valid"
  | "missing"
  | "unclear"
  | "manual_confirmed"
  | "ignored_not_applicable"
  | "rejected_invalid";

export type SourceDrivenFactRequiredFor =
  | "draft_context"
  | "final_submission"
  | "optional"
  | "not_required";

export type SourceDrivenTenderFact = {
  key: string;
  label: string;
  value: string | number | boolean | string[] | null;
  normalizedValue?: unknown;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  confidence: "high" | "medium" | "low";
  status: SourceDrivenFactStatus;
  requiredFor: SourceDrivenFactRequiredFor;
  reason?: string;
};

export type SourceDrivenTenderDetail = {
  tenderId: string;
  facts: SourceDrivenTenderFact[];
  /** Facts that were extracted and valid */
  extractedCount: number;
  /** Facts that are missing but relevant to this tender */
  missingRelevantCount: number;
  /** Facts that are not applicable to this tender */
  notApplicableCount: number;
  /** Coverage = extracted / (extracted + missing relevant) */
  coverageRatio: number;
  /** Submission method determined from tender instructions */
  submissionMethod: "EMAIL" | "PORTAL" | "PHYSICAL" | "HYBRID" | "UNKNOWN";
  /** Whether the tender explicitly requires a deadline */
  requiresDeadline: boolean;
  /** Whether the tender explicitly requires a physical address */
  requiresPhysicalAddress: boolean;
  /** Whether the tender explicitly requires an email endpoint */
  requiresEmailEndpoint: boolean;
  /** Whether the tender mentions a pre-bid meeting */
  hasPreBidMeeting: boolean;
  /** Whether the tender mentions a bid bond */
  hasBidBond: boolean;
  /** Whether the tender mentions a mandatory site visit */
  hasMandatorySiteVisit: boolean;
  /** Whether the tender mentions a budget */
  hasBudget: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { isDisplayValidMetadataValue, NOT_EXTRACTED } from "./metadata-display-sanitizer";

/**
 * Derive a source-driven tender detail from raw tender columns.
 * 
 * This function reads the extracted tender data and classifies each fact
 * based on what the tender actually provides — not on a universal
 * "always critical" field list.
 */
export function deriveSourceDrivenTenderDetail(
  tender: Record<string, unknown>,
): SourceDrivenTenderDetail {
  const facts: SourceDrivenTenderFact[] = [];

  // Determine submission method from tender text.
  // Order matters: HYBRID must be checked BEFORE EMAIL/PHYSICAL because
  // hybrid tender text often contains both "email" and "physical" keywords
  // (e.g., "Hybrid submission: email or physical").
  const rawSubmissionMethod = String(tender.submissionMethod ?? "").toLowerCase();
  const submissionMethod: SourceDrivenTenderDetail["submissionMethod"] =
    rawSubmissionMethod.includes("hybrid") ? "HYBRID"
    : rawSubmissionMethod.includes("portal") || rawSubmissionMethod.includes("e-procurement") ? "PORTAL"
    : rawSubmissionMethod.includes("physical") || rawSubmissionMethod.includes("sealed") || rawSubmissionMethod.includes("courier") || rawSubmissionMethod.includes("hand") ? "PHYSICAL"
    : rawSubmissionMethod.includes("email") ? "EMAIL"
    : "UNKNOWN";

  // Determine what the tender requires based on its actual content
  const requiresEmailEndpoint = submissionMethod === "EMAIL" || submissionMethod === "HYBRID";
  const requiresPhysicalAddress = submissionMethod === "PHYSICAL" || submissionMethod === "HYBRID";
  const requiresDeadline = true; // Deadlines are generally required for final submission
  const hasPreBidMeeting = !!(tender.preBidMeetingDate || tender.preBidMeetingLocation);
  const hasBidBond = !!tender.bidBondAmount;
  const hasMandatorySiteVisit = !!tender.mandatorySiteVisit;
  const hasBudget = !!tender.budget;

  // ─── Build facts from tender columns ───────────────────────────

  const fieldDefs: Array<{
    key: string;
    label: string;
    value: unknown;
    requiredFor: SourceDrivenFactRequiredFor;
    pageKey?: string;
    quoteKey?: string;
  }> = [
    { key: "title", label: "Tender Title", value: tender.title, requiredFor: "draft_context", pageKey: "titleSourcePage", quoteKey: "titleSourceQuote" },
    { key: "reference", label: "Reference Number", value: tender.reference, requiredFor: "optional" },
    { key: "clientName", label: "Client / Procuring Entity", value: tender.clientName ?? tender.procuringEntityName, requiredFor: "draft_context", pageKey: "clientNameSourcePage", quoteKey: "clientNameSourceQuote" },
    { key: "deadline", label: "Submission Deadline", value: tender.deadline, requiredFor: requiresDeadline ? "final_submission" : "optional", pageKey: "deadlineSourcePage", quoteKey: "deadlineSourceQuote" },
    { key: "submissionMethod", label: "Submission Method", value: tender.submissionMethod, requiredFor: "draft_context" },
    { key: "submissionEmails", label: "Submission Emails", value: tender.submissionEmails, requiredFor: requiresEmailEndpoint ? "final_submission" : "optional" },
    { key: "submissionAddress", label: "Submission Address", value: tender.submissionAddress, requiredFor: requiresPhysicalAddress ? "final_submission" : "not_required" },
    { key: "country", label: "Country", value: tender.country, requiredFor: "optional" },
    { key: "budget", label: "Budget", value: tender.budget, requiredFor: "optional" },
    { key: "bidBondAmount", label: "Bid Bond", value: tender.bidBondAmount, requiredFor: "optional" },
    { key: "pageLimit", label: "Page Limit", value: tender.pageLimit, requiredFor: "optional" },
    { key: "validityDays", label: "Proposal Validity", value: tender.validityDays, requiredFor: "optional" },
    { key: "mandatorySiteVisit", label: "Mandatory Site Visit", value: tender.mandatorySiteVisit, requiredFor: "optional" },
    { key: "preBidMeetingDate", label: "Pre-bid Meeting", value: tender.preBidMeetingDate, requiredFor: "optional" },
    { key: "evaluationMethodology", label: "Evaluation Methodology", value: tender.evaluationMethodology, requiredFor: "optional" },
    { key: "clientContactName", label: "Client Contact", value: tender.clientContactName, requiredFor: "optional" },
    { key: "clientContactEmail", label: "Contact Email", value: tender.clientContactEmail, requiredFor: "optional" },
    { key: "clientContactPhone", label: "Contact Phone", value: tender.clientContactPhone, requiredFor: "optional" },
  ];

  for (const def of fieldDefs) {
    const isValid = isDisplayValidMetadataValue(def.key, def.value);
    const sourcePage = def.pageKey ? (tender[def.pageKey] as number | null | undefined) ?? null : null;
    const sourceQuote = def.quoteKey ? (tender[def.quoteKey] as string | null | undefined) ?? null : null;
    const hasSourceEvidence = sourcePage !== null && sourceQuote !== null;

    let status: SourceDrivenFactStatus;
    let confidence: "high" | "medium" | "low";
    let value: SourceDrivenTenderFact["value"];

    if (!isValid) {
      // Value is missing, placeholder, or invalid
      if (def.value === null || def.value === undefined || def.value === "") {
        status = "missing";
      } else {
        status = "rejected_invalid";
      }
      confidence = "low";
      value = null;
    } else {
      status = "extracted_valid";
      confidence = hasSourceEvidence ? "high" : "medium";
      value = typeof def.value === "boolean" ? def.value : String(def.value).trim();
    }

    // Skip facts that are not required and not present
    if (status === "missing" && def.requiredFor === "not_required") {
      continue;
    }

    facts.push({
      key: def.key,
      label: def.label,
      value,
      sourcePage,
      sourceQuote,
      confidence,
      status,
      requiredFor: def.requiredFor,
      reason: status === "rejected_invalid" ? "Value is invalid, placeholder, or contaminated" : undefined,
    });
  }

  const extractedCount = facts.filter((f) => f.status === "extracted_valid").length;
  const missingRelevantCount = facts.filter((f) => f.status === "missing" && f.requiredFor !== "not_required" && f.requiredFor !== "optional").length;
  const notApplicableCount = facts.filter((f) => f.status === "ignored_not_applicable").length;
  const coverageRatio = extractedCount + missingRelevantCount > 0
    ? extractedCount / (extractedCount + missingRelevantCount)
    : 1;

  return {
    tenderId: String(tender.id ?? ""),
    facts,
    extractedCount,
    missingRelevantCount,
    notApplicableCount,
    coverageRatio,
    submissionMethod,
    requiresDeadline,
    requiresPhysicalAddress,
    requiresEmailEndpoint,
    hasPreBidMeeting,
    hasBidBond,
    hasMandatorySiteVisit,
    hasBudget,
  };
}

/**
 * Check whether a fact is required for final submission based on
 * tender-derived requirements (not a universal list).
 */
export function isFactRequiredForFinal(
  fact: SourceDrivenTenderFact,
  detail: SourceDrivenTenderDetail,
): boolean {
  // Only facts explicitly required by the tender or submission method
  if (fact.requiredFor === "final_submission") return true;
  
  // Email tender requires email endpoint
  if (fact.key === "submissionEmails" && detail.requiresEmailEndpoint) return true;
  
  // Physical tender requires address
  if (fact.key === "submissionAddress" && detail.requiresPhysicalAddress) return true;
  
  // Deadline is required for final submission
  if (fact.key === "deadline" && detail.requiresDeadline) return true;
  
  return false;
}

/**
 * Check whether a fact blocks draft generation.
 * Answer: NEVER. No metadata fact blocks draft work.
 */
export function doesFactBlockDraft(_fact: SourceDrivenTenderFact): boolean {
  return false;
}

export { NOT_EXTRACTED };
