// Single source of truth for building the tender-analysis AI input content and
// its source-revision hash.
//
// Every caller must use this builder. The revision includes verified source
// byte identity, extraction revision, and the bounded analysis text. A byte or
// extraction change therefore cannot reuse stale chunk checkpoints even when
// the visible extracted text happens to remain identical.

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
  contentSha256?: string | null;
  contentByteLength?: number | null;
  integrityStatus?: string | null;
};

export type AnalysisContentCompanyDocument = {
  id?: string;
  originalFileName: string;
  category: string;
  extractedText?: string | null;
  contentSha256?: string | null;
  contentByteLength?: number | null;
  integrityStatus?: string | null;
  metadata?: string | null;
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

function metadataExtractionRevision(metadata: string | null | undefined): string {
  if (!metadata) return "revision:1";
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const revision = Number(parsed.extractionRevision);
    if (Number.isInteger(revision) && revision > 0) return `revision:${revision}`;
    if (typeof parsed.reExtractedAt === "string" && parsed.reExtractedAt.trim()) {
      return `legacy-reextract:${parsed.reExtractedAt.trim()}`;
    }
  } catch {
    // Legacy metadata is revision 1.
  }
  return "revision:1";
}

function sourceByteMarker(source: {
  contentSha256?: string | null;
  contentByteLength?: number | null;
  integrityStatus?: string | null;
}): string {
  return [
    source.integrityStatus ?? "UNKNOWN",
    source.contentSha256?.toLocaleLowerCase("en-US") ?? "no-sha256",
    Number.isInteger(source.contentByteLength) ? source.contentByteLength : 0,
  ].join(":");
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
    .map((file) => {
      const sourceMarker = `[SOURCE_BYTES:${sourceByteMarker(file)}]`;
      return file.extractedText
        ? `${formatTenderFileAnalysisMarker(file)}\n${sourceMarker}\n${extractRelevantSections(stripExtractionHeader(file.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
        : `${formatTenderFileAnalysisMarker(file)} ${file.classification ?? ""}\n${sourceMarker}`;
    })
    .join("\n\n");

  const companyContext = company?.documents?.length
    ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents
        .map((document) => {
          const textDigest = document.extractedText
            ? crypto.createHash("sha256").update(document.extractedText.slice(0, 10_000)).digest("hex").slice(0, 16)
            : "no-text";
          const revision = metadataExtractionRevision(document.metadata);
          const documentRef = document.id ?? document.originalFileName;
          return `- ${documentRef} | ${document.originalFileName} (${document.category}) [source:${sourceByteMarker(document)}] [${revision}] [text:${textDigest}]`;
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
 * and Engine continuation. Full SHA-256 avoids collisions between byte-identical
 * prefixes and remains stable across processes.
 */
export function computeAnalysisContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
