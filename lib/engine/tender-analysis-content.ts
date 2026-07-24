// Single source of truth for building the tender-analysis AI input content and
// its source revision.
//
// Every caller must use this builder. The revision is based on source identity,
// deterministic ordering, bounded extracted content, and the Company Vault
// digest. Upload integrity is enforced separately before a source can enter the
// pipeline. Replacing a source through the supported upload path creates a new
// source ID, so even byte-different files that extract to identical text receive
// a new revision without requiring every readiness consumer to load raw-byte
// metadata.

import crypto from "crypto";
import { formatTenderFileAnalysisMarker } from "./requirement-source-linkage";

export const MAX_FILE_CHARS_FOR_AI_ANALYSIS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_FILE_CHARS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 50_000) return raw;
  return 12_000;
})();

export const SECTION_SCAN_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_SECTION_SCAN_CHARS);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 10_000) return raw;
  return 3_000;
})();

export const MAX_TOTAL_AI_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_TOTAL_CHARS);
  if (Number.isFinite(raw) && raw >= 10_000 && raw <= 500_000) return raw;
  return 300_000;
})();

export const SECTION_KEYWORDS = /evaluation|scoring|criteria|submission|deadline|annex|appendix|form[s\s]|financial proposal|technical proposal|envelope|subject line|bid bond|eligibility|qualification|instructions to (bidders?|tenderers?)|evaluation matrix|scoring matrix|award criteria/i;

export type AnalysisContentFile = {
  id: string;
  originalFileName: string;
  extractedText?: string | null;
  classification?: string | null;
  createdAt?: Date;
};

export type AnalysisContentCompanyDocument = {
  originalFileName: string;
  category: string;
  extractedText?: string | null;
};

export type AnalysisContentTender = {
  title?: string | null;
  description?: string | null;
  intakeSummary?: string | null;
  files: AnalysisContentFile[];
};

export type AnalysisContentCompany = {
  documents?: AnalysisContentCompanyDocument[] | null;
} | null | undefined;

export function extractRelevantSections(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const scanBudget = maxChars - head.length;
  const tail = text.slice(head.length);
  const snippets: string[] = [];
  let budgetUsed = 0;
  let searchPos = 0;

  while (budgetUsed < scanBudget && searchPos < tail.length) {
    const nextMatch = tail.slice(searchPos).search(SECTION_KEYWORDS);
    if (nextMatch === -1) break;

    const matchStart = searchPos + nextMatch;
    const lineStart = tail.lastIndexOf("\n", matchStart) + 1;
    const snippetStart = Math.max(lineStart, matchStart - 200);
    const snippetEnd = Math.min(tail.length, snippetStart + SECTION_SCAN_CHARS);
    const snippet = tail.slice(snippetStart, snippetEnd);

    if (!head.includes(snippet.slice(0, 50))) {
      snippets.push(snippet);
      budgetUsed += snippet.length;
    }

    searchPos = snippetEnd;
    if (budgetUsed >= scanBudget) break;
  }

  if (snippets.length === 0) return head;
  return `${head}\n\n[... key sections extracted from remainder ...]\n\n${snippets.join("\n\n---\n\n")}`;
}

export function stripExtractionHeader(text: string): string {
  return text.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, "").trim();
}

export function buildTenderAnalysisContent(
  tender: AnalysisContentTender,
  company?: AnalysisContentCompany,
): string {
  const orderedFiles = [...tender.files].sort((a, b) => {
    const at = a.createdAt ? a.createdAt.getTime() : 0;
    const bt = b.createdAt ? b.createdAt.getTime() : 0;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const fileTexts = orderedFiles
    .map((file) => file.extractedText
      ? `${formatTenderFileAnalysisMarker(file)}\n${extractRelevantSections(stripExtractionHeader(file.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
      : `${formatTenderFileAnalysisMarker(file)} ${file.classification ?? ""}`)
    .join("\n\n");

  const companyContext = company?.documents?.length
    ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents
        .map((document) => {
          const textDigest = document.extractedText
            ? crypto.createHash("sha256").update(document.extractedText.slice(0, 10_000)).digest("hex").slice(0, 16)
            : "no-text";
          return `- ${document.originalFileName} (${document.category}) [digest:${textDigest}]`;
        })
        .sort()
        .join("\n")}`
    : "";

  return [
    `TENDER: ${tender.title ?? "[Untitled Tender]"}`,
    tender.description ? `DESCRIPTION: ${tender.description.slice(0, 2_000)}` : null,
    tender.intakeSummary ? `INTAKE NOTES: ${tender.intakeSummary.slice(0, 2_000)}` : null,
    fileTexts || null,
    companyContext || null,
  ].filter(Boolean).join("\n\n").slice(0, MAX_TOTAL_AI_CHARS);
}

/**
 * Canonical source revision used by analysis jobs, chunks, promotion, readiness,
 * and Engine continuation. Full SHA-256 avoids truncated-hash collisions.
 */
export function computeAnalysisContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
