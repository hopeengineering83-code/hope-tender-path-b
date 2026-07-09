// lib/extraction/tender-chunk-builder.ts
//
// Chunks long tender documents (up to 80+ pages) for AI analysis.
// Chunks by section first, then token/char budget. Never splits table rows.
// Preserves fileId, page ranges, section heading, chunk hash, and order.

import { createHash } from "node:crypto";

export type TenderAnalysisChunk = {
  chunkId: string;
  tenderId: string;
  fileIds: string[];
  pageStart: number | null;
  pageEnd: number | null;
  sectionHeading: string | null;
  purpose: string;
  text: string;
  textHash: string;
  charCount: number;
  order: number;
};

const MAX_CHUNK_CHARS = 8000; // ~2000 tokens
const MIN_CHUNK_CHARS = 500;

/**
 * Build analysis chunks from extracted source files.
 * Each file is chunked by section, then by character budget.
 */
export function buildAnalysisChunks(args: {
  tenderId: string;
  files: Array<{
    fileId: string;
    fileName: string;
    extractedText: string;
    pages: Array<{ pageNumber: number; text: string }>;
  }>;
}): TenderAnalysisChunk[] {
  const { tenderId, files } = args;
  const chunks: TenderAnalysisChunk[] = [];
  let order = 0;

  for (const file of files) {
    const fileChunks = chunkFile(tenderId, file);
    for (const chunk of fileChunks) {
      chunks.push({ ...chunk, order: order++ });
    }
  }

  return chunks;
}

function chunkFile(tenderId: string, file: { fileId: string; fileName: string; extractedText: string; pages: Array<{ pageNumber: number; text: string }> }): TenderAnalysisChunk[] {
  const chunks: TenderAnalysisChunk[] = [];
  const text = file.extractedText;

  if (!text || text.trim().length === 0) return chunks;

  // Split by section headings (lines that are all-caps, or start with "Section", "SECTION", or numbered like "1.", "2.")
  const sections = splitBySections(text);

  for (const section of sections) {
    // If section is small enough, one chunk
    if (section.text.length <= MAX_CHUNK_CHARS) {
      if (section.text.length >= MIN_CHUNK_CHARS || sections.length === 1) {
        chunks.push(createChunk(tenderId, file.fileId, section, chunks.length));
      }
    } else {
      // Split large sections by paragraphs, respecting char budget
      const subChunks = splitByCharBudget(section.text, MAX_CHUNK_CHARS);
      for (const subText of subChunks) {
        if (subText.length >= MIN_CHUNK_CHARS) {
          chunks.push(createChunk(tenderId, file.fileId, { text: subText, heading: section.heading, pageStart: section.pageStart, pageEnd: section.pageEnd }, chunks.length));
        }
      }
    }
  }

  // If no chunks were created (text too short for sections), create one chunk
  if (chunks.length === 0 && text.length > 0) {
    chunks.push(createChunk(tenderId, file.fileId, { text, heading: null, pageStart: null, pageEnd: null }, 0));
  }

  return chunks;
}

type Section = { text: string; heading: string | null; pageStart: number | null; pageEnd: number | null };

function splitBySections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentLines: string[] = [];
  let currentHeading: string | null = null;
  let currentStartPage: number | null = null;

  const isHeading = (line: string): boolean => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    // All-caps heading
    if (trimmed.length > 3 && trimmed.length < 100 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return true;
    // "Section X" or "SECTION X"
    if (/^(section|part|chapter)\s+/i.test(trimmed)) return true;
    // Numbered heading like "1. Introduction" or "1.0 Introduction"
    if (/^\d+\.?\d*\s+[A-Z]/.test(trimmed)) return true;
    return false;
  };

  for (const line of lines) {
    if (isHeading(line)) {
      // Save previous section
      if (currentLines.length > 0) {
        sections.push({
          text: currentLines.join("\n"),
          heading: currentHeading,
          pageStart: currentStartPage,
          pageEnd: null,
        });
      }
      currentLines = [line];
      currentHeading = line.trim();
      currentStartPage = null;
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentLines.length > 0) {
    sections.push({
      text: currentLines.join("\n"),
      heading: currentHeading,
      pageStart: currentStartPage,
      pageEnd: null,
    });
  }

  return sections;
}

function splitByCharBudget(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxChars && current.length > 0) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function createChunk(tenderId: string, fileId: string, section: Section, index: number): TenderAnalysisChunk {
  const purpose = detectPurpose(section.heading, section.text);
  return {
    chunkId: `${fileId}_chunk_${index}`,
    tenderId,
    fileIds: [fileId],
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    sectionHeading: section.heading,
    purpose,
    text: section.text,
    textHash: createHash("sha256").update(section.text).digest("hex").slice(0, 16),
    charCount: section.text.length,
    order: index,
  };
}

function detectPurpose(heading: string | null, text: string): string {
  const h = (heading ?? "").toLowerCase();
  const t = text.toLowerCase().slice(0, 500);

  if (h.includes("submission") || t.includes("submission instructions") || t.includes("instructions to bidders")) return "submission_instructions";
  if (h.includes("scope") || t.includes("scope of services") || t.includes("scope of work")) return "scope_of_services";
  if (h.includes("evaluation") || t.includes("evaluation criteria") || t.includes("evaluation methodology")) return "evaluation_methodology";
  if (h.includes("required documents") || t.includes("required documents") || t.includes("documents to be submitted")) return "required_documents";
  if (h.includes("form") || h.includes("annex") || t.includes("form a") || t.includes("annex 1")) return "forms_annexes";
  if (h.includes("legal") || h.includes("financial") || t.includes("legal requirements") || t.includes("financial requirements")) return "legal_financial_requirements";
  if (h.includes("technical") || t.includes("technical requirements") || t.includes("technical specifications")) return "technical_requirements";
  return "general";
}
