// lib/extraction/tender-source-evidence-ledger.ts
//
// Source evidence records for all extracted facts and requirements.
// Every extracted fact must preserve: fileId, page/sheet reference, quote, quote hash.

import { createHash } from "node:crypto";

export type TenderSourceEvidence = {
  evidenceId: string;
  tenderId: string;
  fileId: string;
  fileName: string;
  pageNumber: number | null;
  sheetName: string | null;
  rowNumber: number | null;
  quote: string;
  quoteHash: string;
  charStart: number | null;
  charEnd: number | null;
  evidenceType:
    | "submission_instruction"
    | "deadline"
    | "submission_method"
    | "submission_email"
    | "submission_address"
    | "evaluation_criteria"
    | "required_document"
    | "scope_of_services"
    | "deliverable"
    | "expert_requirement"
    | "project_reference_requirement"
    | "legal_requirement"
    | "financial_requirement"
    | "form_or_annex"
    | "other";
  confidence: number;
};

/**
 * Compute a stable hash for a quote string.
 */
export function computeQuoteHash(quote: string): string {
  return createHash("sha256").update(quote.trim()).digest("hex").slice(0, 16);
}

/**
 * Create a source evidence record.
 */
export function createEvidence(args: {
  tenderId: string;
  fileId: string;
  fileName: string;
  pageNumber?: number | null;
  sheetName?: string | null;
  rowNumber?: number | null;
  quote: string;
  charStart?: number | null;
  charEnd?: number | null;
  evidenceType: TenderSourceEvidence["evidenceType"];
  confidence?: number;
}): TenderSourceEvidence {
  return {
    evidenceId: `${args.fileId}_${computeQuoteHash(args.quote)}`,
    tenderId: args.tenderId,
    fileId: args.fileId,
    fileName: args.fileName,
    pageNumber: args.pageNumber ?? null,
    sheetName: args.sheetName ?? null,
    rowNumber: args.rowNumber ?? null,
    quote: args.quote.trim(),
    quoteHash: computeQuoteHash(args.quote),
    charStart: args.charStart ?? null,
    charEnd: args.charEnd ?? null,
    evidenceType: args.evidenceType,
    confidence: args.confidence ?? 0.8,
  };
}

/**
 * Verify that a quote actually exists in the extracted text.
 * Returns true if the quote is found (case-insensitive, trimmed).
 */
export function verifyQuoteInText(quote: string, text: string): boolean {
  if (!quote || !text) return false;
  const normalizedQuote = quote.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  return normalizedText.includes(normalizedQuote);
}

/**
 * Verify that a quote exists in any of the extracted source files' pages.
 * Returns the page number where the quote was found, or null if not found.
 */
export function findQuoteInPages(quote: string, pages: Array<{ pageNumber: number; text: string }>): number | null {
  for (const page of pages) {
    if (verifyQuoteInText(quote, page.text)) {
      return page.pageNumber;
    }
  }
  return null;
}

/**
 * Extract evidence from text for a specific evidence type.
 * Scans for keywords and creates evidence records with quotes.
 */
export function extractEvidenceFromText(args: {
  tenderId: string;
  fileId: string;
  fileName: string;
  text: string;
  pageNumber: number | null;
}): TenderSourceEvidence[] {
  const { tenderId, fileId, fileName, text, pageNumber } = args;
  const evidence: TenderSourceEvidence[] = [];
  const lines = text.split("\n");

  const patterns: Array<{ type: TenderSourceEvidence["evidenceType"]; regex: RegExp }> = [
    { type: "deadline", regex: /(?:submission\s+)?deadline[:\s]+([^\n]{5,80})/i },
    { type: "submission_method", regex: /submission\s+method[:\s]+([^\n]{3,80})/i },
    { type: "submission_email", regex: /submission\s+email[s]?[:\s]+([^\n]{5,200})/i },
    { type: "submission_address", regex: /(?:submission|physical)\s+address[:\s]+([^\n]{10,300})/i },
    { type: "evaluation_criteria", regex: /(?:evaluation|scoring)\s+(?:criteria|methodology)[:\s]+([^\n]{5,200})/i },
    { type: "required_document", regex: /required\s+documents?[:\s]+([^\n]{5,200})/i },
    { type: "scope_of_services", regex: /scope\s+of\s+(?:services?|work)[:\s]+([^\n]{10,500})/i },
  ];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (const { type, regex } of patterns) {
      const match = line.match(regex);
      if (match) {
        const quote = match[0].trim();
        if (quote.length >= 5) {
          evidence.push(createEvidence({
            tenderId, fileId, fileName,
            pageNumber,
            rowNumber: li + 1,
            quote,
            evidenceType: type,
            confidence: 0.75,
          }));
        }
      }
    }
  }

  return evidence;
}

/**
 * Check if a fact is source-grounded (has a verified quote in active text).
 */
export function isSourceGrounded(evidence: TenderSourceEvidence, activeFileTexts: Map<string, string>): boolean {
  const text = activeFileTexts.get(evidence.fileId);
  if (!text) return false;
  return verifyQuoteInText(evidence.quote, text);
}
