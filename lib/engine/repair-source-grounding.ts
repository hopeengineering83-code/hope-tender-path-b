// lib/engine/repair-source-grounding.ts
//
// Attempts to repair ungrounded mandatory requirements by finding matching
// text in uploaded tender files with extractedText.
//
// Repair rules:
// - Only uses uploaded tender files with non-empty extractedText.
// - Never fabricates quotes — only saves text actually found in the file.
// - Saves sourceTenderFileId, sourceExactQuote, sourceConfidence > 0.
// - Saves sourcePageNumber and sourceSectionHeading when detectable.
// - Low-confidence matches are saved but flagged with a warning.

import { prisma } from "../prisma";
import { computeProvenPageNumber } from "./page-provenance";

export type RepairSourceGroundingResult = {
  checkedCount: number;
  repairedCount: number;
  remainingCount: number;
  repairedRequirementIds: string[];
  remainingRequirements: Array<{ id: string; title: string }>;
  warnings: string[];
};

// Stop-words excluded from key-phrase extraction to reduce false positives.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "that", "this", "these", "those",
  "it", "its", "not", "no", "all", "any", "each", "which", "who", "when",
  "where", "how", "what", "why", "as", "if", "so", "than", "then", "also",
  "more", "most", "only", "such", "must", "shall", "very", "per", "upon",
  "about", "after", "before", "between", "during", "into", "through",
  "above", "below", "under", "over", "within", "without", "including",
  "based", "provide", "submit", "required", "requirement", "minimum",
  "maximum", "least", "date", "time", "year", "years", "month", "months",
]);

function extractKeyPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP_WORDS.has(w))
    .filter((w, i, a) => a.indexOf(w) === i) // unique
    .slice(0, 12);
}

// Find the best match for the given key phrases within the source text.
// Returns the quote (≤500 chars) and a confidence score 0–1.
function findBestQuote(
  keyPhrases: string[],
  sourceText: string,
): { quote: string; confidence: number; offset: number } | null {
  if (keyPhrases.length === 0 || sourceText.length === 0) return null;

  const lower = sourceText.toLowerCase();
  const WINDOW = 600;
  const MIN_MATCHES = 2;

  let bestScore = 0;
  let bestOffset = -1;

  // Slide a window across the text and count phrase hits in each window.
  for (let start = 0; start < lower.length - 50; start += 80) {
    const end = Math.min(start + WINDOW, lower.length);
    const window = lower.slice(start, end);
    const hits = keyPhrases.filter((p) => window.includes(p)).length;
    const score = hits / keyPhrases.length;
    if (hits >= MIN_MATCHES && score > bestScore) {
      bestScore = score;
      bestOffset = start;
    }
  }

  if (bestOffset < 0) return null;

  // Extract up to 500 chars of real (un-lowercased) text around the best window.
  const rawSlice = sourceText.slice(bestOffset, Math.min(bestOffset + 500, sourceText.length)).trim();
  if (rawSlice.length < 20) return null;

  return { quote: rawSlice, confidence: bestScore, offset: bestOffset };
}

// Attempt to detect a page number from the text around an offset.
// Uses computeProvenPageNumber with the file's stored totalPages as the
// authoritative guard. Pages outside 1..totalPages are rejected; page 1
// is only allowed when totalPages === 1 and there are no page boundaries.
function detectPageNumber(text: string, offset: number, totalPages: number | null | undefined = null): number | null {
  return computeProvenPageNumber(text, offset, totalPages);
}

// Attempt to detect the nearest preceding section heading.
function detectSectionHeading(text: string, offset: number): string | null {
  const before = text.slice(Math.max(0, offset - 600), offset);
  const headingMatch = before.match(/(?:^|\n)(#+\s+[^\n]{5,80}|[A-Z][^\n]{4,80})(?=\n)/m);
  if (!headingMatch) return null;
  const heading = headingMatch[1].replace(/^#+\s*/, "").trim();
  return heading.length >= 5 && heading.length <= 100 ? heading : null;
}

export async function repairSourceGrounding(tenderId: string): Promise<RepairSourceGroundingResult> {
  const warnings: string[] = [];

  // Fetch all MANDATORY ungrounded requirements (confidence <= 0 or not set).
  const ungrounded = await prisma.tenderRequirement.findMany({
    where: {
      tenderId,
      priority: "MANDATORY",
      sourceConfidence: { lte: 0 },
    },
    select: { id: true, title: true, description: true },
  });

  const checkedCount = ungrounded.length;
  if (checkedCount === 0) {
    return { checkedCount: 0, repairedCount: 0, remainingCount: 0, repairedRequirementIds: [], remainingRequirements: [], warnings };
  }

  // Fetch tender files with usable extracted text.
  const tenderFiles = await prisma.tenderFile.findMany({
    where: { tenderId, extractedText: { not: null } },
    select: { id: true, extractedText: true, fileName: true, totalPages: true, deletionStatus: true },
  });

  const usableFiles = tenderFiles.filter(
    (f) => f.extractedText && f.extractedText.trim().length > 100,
  );

  if (usableFiles.length === 0) {
    warnings.push("No tender files with usable extracted text found — repair could not run. Upload and process official tender files first.");
    return {
      checkedCount,
      repairedCount: 0,
      remainingCount: checkedCount,
      repairedRequirementIds: [],
      remainingRequirements: ungrounded.map((r) => ({ id: r.id, title: r.title })),
      warnings,
    };
  }

  const repairedIds: string[] = [];
  const remainingRequirements: Array<{ id: string; title: string }> = [];

  for (const req of ungrounded) {
    const keyPhrases = extractKeyPhrases(`${req.title} ${req.description}`);
    let bestMatch: { fileId: string; quote: string; confidence: number; page: number | null; heading: string | null } | null = null;

    for (const file of usableFiles) {
      const text = file.extractedText!;
      const result = findBestQuote(keyPhrases, text);
      if (!result) continue;
      if (!bestMatch || result.confidence > bestMatch.confidence) {
        bestMatch = {
          fileId: file.id,
          quote: result.quote,
          confidence: result.confidence,
          page: detectPageNumber(text, result.offset, file.totalPages),
          // Note: sourcePageNumber is always written below (even when null)
          // to clear stale page evidence from a prior repair.
          heading: detectSectionHeading(text, result.offset),
        };
      }
    }

    if (!bestMatch || bestMatch.confidence < 0.15) {
      remainingRequirements.push({ id: req.id, title: req.title });
      continue;
    }

    // Verify the quote is actually present in the file text (safety guard).
    const matchFile = usableFiles.find((f) => f.id === bestMatch!.fileId);
    if (!matchFile?.extractedText?.includes(bestMatch.quote.slice(0, 50))) {
      remainingRequirements.push({ id: req.id, title: req.title });
      warnings.push(`Requirement "${req.title}": quote verification failed — skipping.`);
      continue;
    }

    if (bestMatch.confidence < 0.35) {
      warnings.push(`Requirement "${req.title}": low-confidence match (${Math.round(bestMatch.confidence * 100)}%) — saved but needs verification.`);
    }

    await prisma.tenderRequirement.update({
      where: { id: req.id },
      data: {
        sourceTenderFileId: bestMatch.fileId,
        sourceExactQuote: bestMatch.quote.slice(0, 500),
        sourceConfidence: Math.round(bestMatch.confidence * 100) / 100,
        // Always write sourcePageNumber — even when null — to clear stale
        // page evidence from a prior repair that doesn't correspond to the
        // new quote.
        sourcePageNumber: bestMatch.page,
        ...(bestMatch.heading !== null ? { sourceSectionHeading: bestMatch.heading } : {}),
        updatedAt: new Date(),
      },
    });

    repairedIds.push(req.id);
  }

  return {
    checkedCount,
    repairedCount: repairedIds.length,
    remainingCount: remainingRequirements.length,
    repairedRequirementIds: repairedIds,
    remainingRequirements,
    warnings,
  };
}
