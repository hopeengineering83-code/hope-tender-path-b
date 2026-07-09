/**
 * Generation Pipeline Integration
 *
 * Thin adapter that exposes the new document-content-quality modules to the
 * existing generation pipeline (lib/engine/generate-elite.ts and
 * lib/engine/proposal-intelligence.ts) WITHOUT requiring a full rewrite.
 *
 * Three responsibilities:
 *
 *   1. detectFinancialProposalRequiredFromText(tenderText)
 *      — single source of truth for "should this tender have a financial
 *        proposal?". Supersedes the inline regex that lived in
 *        proposal-intelligence.ts before this PR.
 *
 *   2. buildTenderDocumentTypeAdvisory(tenderText)
 *      — returns a structured advisory describing the detected tender type
 *        (EOI / RFQ / RFP / etc.) and the document-type adjustments the
 *        generation pipeline SHOULD make. The advisory is non-binding —
 *        generate-elite.ts logs it and uses it to tweak the document title
 *        and cover-letter language, but does NOT restructure the entire
 *        document based on it (that is deferred to a future PR).
 *
 *   3. buildServiceStreamMethodologyBlock(serviceStreams)
 *      — returns a markdown block with HAEC service-stream-specific
 *        methodology sections. generate-elite.ts can inject this block
 *        into the technical approach section when AI generation is
 *        unavailable or as a supplement.
 *
 * This module does NOT touch:
 *   - lib/engine/export-readiness.ts (parallel PR — final package readiness)
 *   - lib/engine/tender-fact-authority.ts (parallel PR — canonical fact authority)
 *   - lib/engine/effective-tender-facts.ts (parallel PR — canonical fact authority)
 */

import { classifyTender, type TenderType, type CompanyService } from "../engine/tender-classification";
import { detectFinancialProposalRequired } from "./tender-document-context";
import { getCombinedMethodology, type MethodologySection } from "./haec-service-methodology";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TenderDocumentTypeAdvisory = {
  tenderType: TenderType;
  isEoi: boolean;
  isRfq: boolean;
  isRfpLike: boolean;
  financialProposalRequired: boolean;
  /** Suggested document title — e.g. "Expression of Interest" for EOI tenders. */
  suggestedDocumentTitle: string;
  /** Advisory notes for the generation pipeline (logged, not enforced). */
  notes: string[];
};

// ─── (1) Financial-proposal detection ───────────────────────────────────────

/**
 * Single source of truth for "should this tender have a financial proposal?".
 * Re-exports detectFinancialProposalRequired from tender-document-context.ts
 * so callers in lib/engine/ have a single import path.
 */
export function detectFinancialProposalRequiredFromText(tenderText: string): boolean {
  return detectFinancialProposalRequired(tenderText);
}

// ─── (2) Tender-type advisory ───────────────────────────────────────────────

/**
 * Build a tender-type-aware advisory for the generation pipeline.
 *
 * The advisory describes the detected tender type and the document-type
 * adjustments the generation pipeline SHOULD make. It is non-binding —
 * generate-elite.ts logs it and uses it to tweak the document title and
 * cover-letter language.
 */
export function buildTenderDocumentTypeAdvisory(tenderText: string): TenderDocumentTypeAdvisory {
  const classification = classifyTender(tenderText);
  const tenderType = classification.tenderType;
  const financialProposalRequired = detectFinancialProposalRequired(tenderText);

  const isEoi = tenderType === "EOI" || tenderType === "REOI";
  const isRfq = tenderType === "RFQ";
  const isRfpLike =
    tenderType === "RFP"
    || tenderType === "ITB"
    || tenderType === "RFT"
    || tenderType === "consultancy"
    || tenderType === "works"
    || tenderType === "framework";

  const notes: string[] = [];
  let suggestedDocumentTitle = "Technical Proposal";

  if (isEoi) {
    suggestedDocumentTitle = "Expression of Interest";
    notes.push("EOI tender — the response should be a brief EOI document, not a full RFP technical methodology.");
    notes.push("EOI should NOT include a financial proposal or price schedule.");
  } else if (isRfq) {
    suggestedDocumentTitle = "Quotation";
    notes.push("RFQ tender — the response should be a quotation with price schedule, not a long technical proposal.");
  } else if (isRfpLike) {
    suggestedDocumentTitle = "Technical Proposal";
    notes.push("RFP-like tender — full technical proposal with methodology, work plan, team, and compliance matrix.");
    if (!financialProposalRequired) {
      notes.push("Tender states financial proposal is NOT required — exclude financial proposal and price schedule.");
    }
  } else {
    notes.push(`Unclassified tender type "${tenderType}" — defaulting to Technical Proposal.`);
  }

  if (financialProposalRequired && (tenderType === "RFP" || tenderType === "ITB" || tenderType === "RFT")) {
    notes.push("Two-envelope / separate-envelope language detected — keep technical and financial content separated.");
  }

  return {
    tenderType,
    isEoi,
    isRfq,
    isRfpLike,
    financialProposalRequired,
    suggestedDocumentTitle,
    notes,
  };
}

// ─── (3) Service-stream methodology block ───────────────────────────────────

/**
 * Build a markdown block with HAEC service-stream-specific methodology
 * sections. generate-elite.ts can inject this block into the technical
 * approach section when AI generation is unavailable or as a supplement.
 *
 * Returns null when no service streams are detected (caller should fall
 * back to the existing generic methodology).
 */
export function buildServiceStreamMethodologyBlock(serviceStreams: CompanyService[]): string | null {
  if (!serviceStreams || serviceStreams.length === 0) return null;
  const streams = serviceStreams.filter((s) => s !== "unknown");
  if (streams.length === 0) return null;

  const sections: MethodologySection[] = getCombinedMethodology(streams);
  if (sections.length === 0) return null;

  const parts: string[] = [
    "### Service-Stream-Specific Methodology",
    "",
    `The methodology below is tailored to the following identified service streams: ${streams.join(", ")}.`,
    "",
  ];

  for (const section of sections) {
    parts.push(`#### ${section.title}`);
    parts.push("");
    parts.push(section.content);
    if (section.deliverables.length > 0) {
      parts.push("");
      parts.push("**Deliverables:**");
      for (const d of section.deliverables) parts.push(`- ${d}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}
