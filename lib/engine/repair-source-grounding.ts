// lib/engine/repair-source-grounding.ts
//
// Repairs missing or stale source coordinates for mandatory/critical tender
// requirements. Every persisted quote is copied from an ACTIVE uploaded tender
// file, is re-checked for containment, and is paired with a proven page number.
// The service never invents quotes, never uses deleted files, and never turns a
// low-confidence lexical guess into release authority.

import { prisma } from "../prisma";
import { computeProvenPageNumber } from "./page-provenance";
import { isGroundedEvidenceInActiveFiles } from "./evidence-grounding";

export type RepairSourceGroundingResult = {
  checkedCount: number;
  repairedCount: number;
  remainingCount: number;
  repairedRequirementIds: string[];
  remainingRequirements: Array<{ id: string; title: string }>;
  warnings: string[];
};

export type RepairSourceGroundingOptions = {
  /** Injectable Prisma-compatible client for transactions/tests. */
  db?: any;
  /** When supplied, proves the tender belongs to the caller before mutation. */
  userId?: string;
};

export const MIN_AUTOMATIC_GROUNDING_CONFIDENCE = 0.5;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "that", "this", "these", "those",
  "it", "its", "not", "no", "all", "any", "each", "which", "who", "when",
  "where", "how", "what", "why", "as", "if", "so", "than", "then", "also",
  "more", "most", "only", "such", "must", "very", "per", "upon", "about",
  "after", "before", "between", "during", "into", "through", "above", "below",
  "under", "over", "within", "without", "including", "based", "provide",
  "submit", "required", "requirement", "minimum", "maximum", "least", "date",
  "time", "year", "years", "month", "months", "document", "tender", "bidder",
]);

export function extractSourceGroundingKeyPhrases(text: string): string[] {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .filter((word, index, all) => all.indexOf(word) === index)
    .slice(0, 16);
}

export function findBestSourceGroundingQuote(
  keyPhrases: string[],
  sourceText: string,
): { quote: string; confidence: number; offset: number } | null {
  if (keyPhrases.length < 2 || sourceText.trim().length < 20) return null;

  const lower = sourceText.toLocaleLowerCase("en-US");
  // The persisted quote is capped at 500 characters. Score the same compact
  // window so every term used to justify the match is actually inside the
  // exact quote that will be stored and re-validated by release gates.
  const windowSize = 500;
  const step = 60;
  const minimumHits = Math.min(3, keyPhrases.length);
  const denominator = Math.min(6, keyPhrases.length);
  let bestScore = 0;
  let bestOffset = -1;
  let bestHits = 0;

  const scoreWindow = (start: number) => {
    const window = lower.slice(start, Math.min(start + windowSize, lower.length));
    const hits = keyPhrases.filter((phrase) => window.includes(phrase)).length;
    if (hits < minimumHits) return { hits, score: 0 };
    return { hits, score: Math.min(1, hits / denominator) };
  };

  const lastStart = Math.max(0, lower.length - 20);
  for (let start = 0; start <= lastStart; start += step) {
    const { hits, score } = scoreWindow(start);
    if (score > bestScore || (score === bestScore && hits > bestHits)) {
      bestScore = score;
      bestOffset = start;
      bestHits = hits;
    }
    if (start + step > lastStart && start !== lastStart) {
      // Ensure the tail of the source is inspected once.
      const { hits: tailHits, score: tailScore } = scoreWindow(lastStart);
      if (tailScore > bestScore || (tailScore === bestScore && tailHits > bestHits)) {
        bestScore = tailScore;
        bestOffset = lastStart;
        bestHits = tailHits;
      }
      break;
    }
  }

  if (
    bestOffset < 0
    || bestHits < minimumHits
    || bestScore < MIN_AUTOMATIC_GROUNDING_CONFIDENCE
  ) return null;

  const quote = sourceText
    .slice(bestOffset, Math.min(bestOffset + windowSize, sourceText.length))
    .trim();
  if (quote.length < 20) return null;

  const normalizedQuote = quote.toLocaleLowerCase("en-US");
  const quoteHits = keyPhrases.filter((phrase) => normalizedQuote.includes(phrase)).length;
  if (quoteHits < minimumHits) return null;

  return { quote, confidence: bestScore, offset: bestOffset };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locate an already-extracted quote in current source bytes, tolerating only whitespace changes. */
function findExistingQuoteOffset(sourceText: string, quote: string): number | null {
  const exact = sourceText.indexOf(quote);
  if (exact >= 0) return exact;
  const terms = quote.trim().split(/\s+/).filter(Boolean).slice(0, 80);
  if (terms.length < 3) return null;
  const match = new RegExp(terms.map(escapeRegExp).join("\\s+"), "i").exec(sourceText);
  return match && typeof match.index === "number" ? match.index : null;
}

function detectPageNumber(
  text: string,
  offset: number,
  totalPages: number | null | undefined,
): number | null {
  return computeProvenPageNumber(text, offset, totalPages);
}

function detectSectionHeading(text: string, offset: number): string | null {
  const before = text.slice(Math.max(0, offset - 800), offset);
  const headingMatch = before.match(/(?:^|\n)(#+\s+[^\n]{5,100}|[A-Z][^\n]{4,100})(?=\n)/m);
  if (!headingMatch) return null;
  const heading = headingMatch[1].replace(/^#+\s*/, "").trim();
  return heading.length >= 5 && heading.length <= 120 ? heading : null;
}

type ActiveTenderFile = {
  id: string;
  extractedText: string | null;
  fileName: string;
  totalPages: number | null;
};

type RequirementToRepair = {
  id: string;
  title: string;
  description: string;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  sourceConfidence: number;
};

function bestRepairForRequirement(
  requirement: RequirementToRepair,
  files: ActiveTenderFile[],
): {
  fileId: string;
  quote: string;
  confidence: number;
  page: number;
  heading: string | null;
} | null {
  let best: {
    fileId: string;
    quote: string;
    confidence: number;
    page: number;
    heading: string | null;
  } | null = null;

  // First recover coordinates for a real quote already extracted by AI. This
  // is stronger than lexical matching and receives confidence 1.0.
  if (requirement.sourceExactQuote?.trim()) {
    const preferred = files.find((file) => file.id === requirement.sourceTenderFileId);
    const ordered = preferred
      ? [preferred, ...files.filter((file) => file.id !== preferred.id)]
      : files;
    for (const file of ordered) {
      if (!file.extractedText) continue;
      const offset = findExistingQuoteOffset(file.extractedText, requirement.sourceExactQuote);
      if (offset == null) continue;
      const page = detectPageNumber(file.extractedText, offset, file.totalPages);
      if (!page) continue;
      return {
        fileId: file.id,
        quote: file.extractedText.slice(offset, Math.min(offset + requirement.sourceExactQuote.length, file.extractedText.length)).trim(),
        confidence: 1,
        page,
        heading: detectSectionHeading(file.extractedText, offset),
      };
    }
  }

  const keyPhrases = extractSourceGroundingKeyPhrases(
    `${requirement.title} ${requirement.description}`,
  );
  for (const file of files) {
    if (!file.extractedText) continue;
    const match = findBestSourceGroundingQuote(keyPhrases, file.extractedText);
    if (!match || match.confidence < MIN_AUTOMATIC_GROUNDING_CONFIDENCE) continue;
    const page = detectPageNumber(file.extractedText, match.offset, file.totalPages);
    // Page provenance is part of the canonical release predicate. Do not save
    // an apparently useful quote that can never become trusted evidence.
    if (!page) continue;
    if (!file.extractedText.includes(match.quote)) continue;
    const candidate = {
      fileId: file.id,
      quote: match.quote,
      confidence: match.confidence,
      page,
      heading: detectSectionHeading(file.extractedText, match.offset),
    };
    if (!best || candidate.confidence > best.confidence) best = candidate;
  }
  return best;
}

export async function repairSourceGrounding(
  tenderId: string,
  options: RepairSourceGroundingOptions = {},
): Promise<RepairSourceGroundingResult> {
  const db = options.db ?? prisma;
  const warnings: string[] = [];

  if (options.userId) {
    const owned = await db.tender.findFirst({
      where: { id: tenderId, userId: options.userId },
      select: { id: true },
    });
    if (!owned) {
      return {
        checkedCount: 0,
        repairedCount: 0,
        remainingCount: 0,
        repairedRequirementIds: [],
        remainingRequirements: [],
        warnings: ["Tender ownership could not be verified; source repair was not run."],
      };
    }
  }

  const [requirements, tenderFiles] = await Promise.all([
    db.tenderRequirement.findMany({
      where: {
        tenderId,
        priority: { in: ["MANDATORY", "CRITICAL"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        sourceTenderFileId: true,
        sourcePageNumber: true,
        sourceExactQuote: true,
        sourceConfidence: true,
      },
    }),
    db.tenderFile.findMany({
      where: {
        tenderId,
        deletionStatus: "ACTIVE",
        extractedText: { not: null },
      },
      select: {
        id: true,
        extractedText: true,
        fileName: true,
        totalPages: true,
      },
    }),
  ]);

  const usableFiles: ActiveTenderFile[] = tenderFiles.filter(
    (file: ActiveTenderFile) => Boolean(file.extractedText && file.extractedText.trim().length >= 100),
  );
  const activeFiles = usableFiles.map((file) => ({
    id: file.id,
    extractedText: file.extractedText,
    totalPages: file.totalPages,
  }));
  const ungrounded: RequirementToRepair[] = requirements.filter(
    (requirement: RequirementToRepair) => !isGroundedEvidenceInActiveFiles(
      requirement.sourcePageNumber,
      requirement.sourceExactQuote,
      requirement.sourceTenderFileId,
      activeFiles,
    ),
  );

  const checkedCount = ungrounded.length;
  if (checkedCount === 0) {
    return {
      checkedCount: 0,
      repairedCount: 0,
      remainingCount: 0,
      repairedRequirementIds: [],
      remainingRequirements: [],
      warnings,
    };
  }

  if (usableFiles.length === 0) {
    warnings.push("No ACTIVE official tender file has usable extracted text. Automatic source grounding remains fail-closed until extraction succeeds.");
    return {
      checkedCount,
      repairedCount: 0,
      remainingCount: checkedCount,
      repairedRequirementIds: [],
      remainingRequirements: ungrounded.map((requirement) => ({ id: requirement.id, title: requirement.title })),
      warnings,
    };
  }

  const repairedRequirementIds: string[] = [];
  const remainingRequirements: Array<{ id: string; title: string }> = [];

  for (const requirement of ungrounded) {
    const repair = bestRepairForRequirement(requirement, usableFiles);
    if (!repair) {
      remainingRequirements.push({ id: requirement.id, title: requirement.title });
      continue;
    }

    const file = usableFiles.find((candidate) => candidate.id === repair.fileId);
    if (!file?.extractedText || !file.extractedText.includes(repair.quote)) {
      remainingRequirements.push({ id: requirement.id, title: requirement.title });
      warnings.push(`Requirement "${requirement.title}": source containment re-check failed; no update was written.`);
      continue;
    }

    await db.tenderRequirement.update({
      where: { id: requirement.id },
      data: {
        sourceTenderFileId: repair.fileId,
        sourceExactQuote: repair.quote.slice(0, 500),
        sourceConfidence: Math.round(repair.confidence * 100) / 100,
        sourcePageNumber: repair.page,
        sourceSectionHeading: repair.heading,
        sourceExtractionMethod: "automatic_repair",
        updatedAt: new Date(),
      },
    });
    repairedRequirementIds.push(requirement.id);
  }

  return {
    checkedCount,
    repairedCount: repairedRequirementIds.length,
    remainingCount: remainingRequirements.length,
    repairedRequirementIds,
    remainingRequirements,
    warnings,
  };
}
