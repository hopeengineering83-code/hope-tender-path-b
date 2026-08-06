// Deterministic requirement source-coordinate extractor.
//
// This module never invents evidence. It segments extracted text by explicit
// page markers and paragraph/sentence boundaries, then records only verbatim
// quotes that structurally support the requirement.

export interface RequirementInput {
  id: string;
  title: string;
  description: string;
}

export interface RequirementSource {
  requirementId: string;
  sourceTenderFileId?: string;
  sourcePageNumber?: number;
  sourceSectionHeading?: string;
  sourceExactQuote?: string;
  sourceConfidence: number;
}

export interface ExtractorOptions {
  minConfidence?: number;
  maxQuoteChars?: number;
}

const DEFAULT_OPTS: Required<ExtractorOptions> = {
  minConfidence: 0.18,
  maxQuoteChars: 420,
};

type Paragraph = {
  paragraph: string;
  pageNumber?: number;
  sectionHeading?: string;
  offset: number;
};

const PAGE_MARKER = /\[\s*page\s*(\d{1,4})\s*\]|^\s*page\s+(\d{1,4})(?:\s+of\s+\d{1,4})?\s*$/gim;
const HEADING = /^(?:(?:section|article|annex|appendix)\s+)?(?:[A-Z]|[IVXLCDM]+|\d{1,3}(?:\.\d{1,3}){0,4})[\s:.)\-]+.{3,150}$/i;
const REQUIREMENT_VERBS = /\b(must|shall|required|submit|provide|include|minimum|at least|not less than|mandatory|eligible|qualification|experience|deadline|before|no later than)\b/i;

function normalizedSegments(text: string): Array<{ text: string; pageNumber?: number; offset: number }> {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n\n")
    .replace(/(\[\s*page\s*\d{1,4}\s*\])/gi, "\n\n$1\n\n");

  const markers = [...normalized.matchAll(PAGE_MARKER)];
  if (markers.length === 0) return [{ text: normalized, offset: 0 }];

  const segments: Array<{ text: string; pageNumber?: number; offset: number }> = [];
  if ((markers[0].index ?? 0) > 0) {
    segments.push({ text: normalized.slice(0, markers[0].index), offset: 0 });
  }
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index ?? normalized.length : normalized.length;
    const pageNumber = Number(marker[1] ?? marker[2]);
    segments.push({
      text: normalized.slice(start, end),
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined,
      offset: start,
    });
  }
  return segments;
}

function splitLongBlock(block: string): string[] {
  if (block.length <= 900) return [block];
  const sentences = block.split(/(?<=[.!?;:])\s+(?=[A-Z0-9(])/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 700) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [block.slice(0, 900)];
}

/** Exported for regression tests. */
export function splitIntoParagraphs(text: string): Paragraph[] {
  if (!text.trim()) return [];
  const out: Paragraph[] = [];
  let currentHeading: string | undefined;

  for (const segment of normalizedSegments(text)) {
    const rawBlocks = segment.text
      .split(/\n{2,}|(?<=\.)\s*\n(?=[A-Z0-9(])/)
      .map((value) => value.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean);

    let localOffset = 0;
    for (const rawBlock of rawBlocks) {
      const lines = rawBlock.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.length <= 180 && (HEADING.test(line) || (line === line.toUpperCase() && /^[A-Z][A-Z0-9 ,/&\-:().]{4,179}$/.test(line)))) {
          currentHeading = line.slice(0, 160);
          localOffset += line.length + 1;
          continue;
        }

        for (const paragraph of splitLongBlock(line)) {
          if (paragraph.length < 20) continue;
          out.push({
            paragraph,
            pageNumber: segment.pageNumber,
            sectionHeading: currentHeading,
            offset: segment.offset + localOffset,
          });
          localOffset += paragraph.length + 1;
        }
      }
    }
  }
  return out;
}

const STOP = new Set(
  "the a an of and or for to in on at by with as is are was were be been have has had this that these those will may can could it its their our we you bidder bidders proposal proposer proposers tender tenderer document documents section information details including applicable relevant".split(/\s+/),
);

function normalizeToken(value: string): string {
  return value
    .replace(/ies$/, "y")
    .replace(/sses$/, "ss")
    .replace(/s$/, "")
    .replace(/ing$/, "")
    .replace(/ed$/, "");
}

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map(normalizeToken)
      .filter((word) => word.length >= 3 && !STOP.has(word)),
  );
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function scoreOverlap(requirementTokens: Set<string>, paragraphTokens: Set<string>): number {
  if (requirementTokens.size === 0 || paragraphTokens.size === 0) return 0;
  const intersection = intersectionSize(requirementTokens, paragraphTokens);
  const requirementCoverage = intersection / requirementTokens.size;
  const focusedCoverage = intersection / Math.min(requirementTokens.size, Math.max(6, paragraphTokens.size));
  return requirementCoverage * 0.72 + focusedCoverage * 0.28;
}

/** Reject structurally unrelated boilerplate even when generic words overlap. */
export function quoteStructurallyProvesRequirement(requirement: RequirementInput, quote: string): boolean {
  const requirementText = `${requirement.title} ${requirement.description}`.toLowerCase();
  const quoteText = quote.toLowerCase();
  const expert = /\b(expert|personnel|staff|curriculum vitae|\bcv\b|specialist|team leader)\b/.test(requirementText);
  const project = /\b(project reference|past performance|similar project|relevant experience|contract experience)\b/.test(requirementText);
  const financial = /\b(financial|price|fee|cost|currency|bid bond|turnover)\b/.test(requirementText);
  const submission = /\b(submission|submit|deadline|email|envelope|copy|copies|file name|format)\b/.test(requirementText);

  if (expert && !/\b(expert|personnel|staff|curriculum vitae|\bcv\b|specialist|team leader|qualification|years? experience)\b/.test(quoteText)) return false;
  if (project && !/\b(project|contract|client|assignment|reference|past performance|experience)\b/.test(quoteText)) return false;
  if (financial && !/\b(financial|price|fee|cost|currency|bond|turnover|amount)\b/.test(quoteText)) return false;
  if (submission && !/\b(submit|submission|deadline|email|envelope|copy|copies|file|format|before|later than)\b/.test(quoteText)) return false;
  if ((expert || project) && /\bevaluation criteria\b/.test(quoteText) && !REQUIREMENT_VERBS.test(quoteText)) return false;
  return true;
}

function phraseBonus(requirement: RequirementInput, paragraph: string): number {
  const paragraphLower = paragraph.toLowerCase();
  const title = requirement.title.trim().toLowerCase();
  let bonus = title.length >= 8 && paragraphLower.includes(title) ? 0.28 : 0;

  const quantities = `${requirement.title} ${requirement.description}`.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  if (quantities.some((quantity) => new RegExp(`\\b${quantity.replace(".", "\\.")}\\b`).test(paragraphLower))) bonus += 0.08;
  if (REQUIREMENT_VERBS.test(requirement.description) && REQUIREMENT_VERBS.test(paragraph)) bonus += 0.06;
  return bonus;
}

export function extractRequirementSources(opts: {
  tenderFileId: string;
  tenderFileText: string;
  requirements: RequirementInput[];
  options?: ExtractorOptions;
}): RequirementSource[] {
  const options: Required<ExtractorOptions> = { ...DEFAULT_OPTS, ...(opts.options ?? {}) };
  const paragraphs = splitIntoParagraphs(opts.tenderFileText);
  if (paragraphs.length === 0) {
    return opts.requirements.map((requirement) => ({ requirementId: requirement.id, sourceConfidence: 0 }));
  }

  const paragraphTokens = paragraphs.map((paragraph) => tokens(paragraph.paragraph));

  return opts.requirements.map((requirement) => {
    const requirementTokens = tokens(`${requirement.title} ${requirement.description}`);
    if (requirementTokens.size === 0) return { requirementId: requirement.id, sourceConfidence: 0 };

    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index].paragraph;
      if (!quoteStructurallyProvesRequirement(requirement, paragraph)) continue;
      const score = scoreOverlap(requirementTokens, paragraphTokens[index]) + phraseBonus(requirement, paragraph);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0 || bestScore < options.minConfidence) {
      return { requirementId: requirement.id, sourceConfidence: 0 };
    }

    const best = paragraphs[bestIndex];
    const exactQuote = best.paragraph.length > options.maxQuoteChars
      ? `${best.paragraph.slice(0, options.maxQuoteChars - 1).trim()}…`
      : best.paragraph;

    return {
      requirementId: requirement.id,
      sourceTenderFileId: opts.tenderFileId,
      sourcePageNumber: best.pageNumber,
      sourceSectionHeading: best.sectionHeading,
      sourceExactQuote: exactQuote,
      sourceConfidence: Math.min(1, bestScore),
    };
  });
}
