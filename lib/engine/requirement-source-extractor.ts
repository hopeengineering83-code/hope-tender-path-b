// Requirement source-coordinate extractor (G9 follow-up)
//
// THE PROBLEM
// ───────────
// PR XX added the schema columns sourceTenderFileId, sourcePageNumber,
// sourceSectionHeading, sourceExactQuote, sourceConfidence on
// TenderRequirement. PR XX did NOT populate them. Result: the audit-grade
// "where in the tender does this come from?" UI works for nothing yet.
//
// THE FIX
// ───────
// A pure-regex extractor that takes:
//   • the raw extractedText of a TenderFile
//   • a list of requirements (title + description)
// and tries to find for each requirement:
//   • the page number  (extractedText carries "[page N]" markers when
//     the PDF extractor inserts them; we also detect "Page N of M"
//     headers and bare "Page N" strings).
//   • the section heading just above the matching paragraph (numbered
//     like "5.2", "Section 4.3", "ARTICLE V", "Annex B").
//   • the exact verbatim quote (the matched paragraph or a 240-char
//     window centred on the requirement title).
//   • a 0..1 confidence score based on how strongly the title overlaps
//     with the matched window.
//
// No AI call, no network, no LLM cost. The output is a best-effort
// match — bad matches surface as low confidence (< 0.4) which the UI
// can show as "Bid-Team to confirm source" rather than displaying a
// false citation.

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
  // Minimum confidence to record a coord. Anything below is
  // returned with sourceConfidence=0 and empty coord fields.
  minConfidence?: number;
  // Maximum quote length to store (DB column has no fixed limit but
  // we keep it small for UI rendering).
  maxQuoteChars?: number;
}

const DEFAULT_OPTS: Required<ExtractorOptions> = {
  minConfidence: 0.25,
  maxQuoteChars: 320,
};

/**
 * Splits the file text into a list of paragraphs, each tagged with the
 * detected page number (when "[page N]" markers exist) and the most
 * recent section heading seen above it.
 */
function splitIntoParagraphs(text: string): Array<{ paragraph: string; pageNumber?: number; sectionHeading?: string; offset: number }> {
  if (!text) return [];
  const out: Array<{ paragraph: string; pageNumber?: number; sectionHeading?: string; offset: number }> = [];

  let currentPage: number | undefined;
  let currentHeading: string | undefined;

  // Normalise line endings; split on blank lines.
  const normalised = text.replace(/\r\n?/g, "\n");
  const blocks = normalised.split(/\n{2,}/);

  let runningOffset = 0;
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) {
      runningOffset += rawBlock.length + 2;
      continue;
    }

    // Page marker: [page 5], (Page 5 of 12), Page 5
    const pageM = block.match(/\[\s*page\s*(\d{1,4})\s*\]/i)
      ?? block.match(/^\(?\s*page\s+(\d{1,4})(?:\s+of\s+\d{1,4})?\s*\)?\s*$/i)
      ?? block.match(/^\s*page\s+(\d{1,4})\s*$/i);
    if (pageM) {
      currentPage = Number(pageM[1]);
      runningOffset += rawBlock.length + 2;
      continue;
    }

    // Section heading: numbered (5.2 ...), or "Section 4.3", or
    // "Annex B", or "ARTICLE V" (Roman), or all-caps short line.
    const headingM = block.match(/^(?:section\s+)?(\d{1,2}(?:\.\d{1,3}){0,3})\s+(.{4,140})$/i)
      ?? block.match(/^(annex\s+[A-Z](?:\.\d{1,2})?)[\s:.\-]+(.{4,140})$/i)
      ?? block.match(/^(article\s+[ivxlcdm]+)[\s:.\-]+(.{4,140})$/i);
    if (headingM) {
      currentHeading = `${headingM[1]} ${headingM[2]}`.trim().slice(0, 140);
      runningOffset += rawBlock.length + 2;
      continue;
    }
    // All-caps short heading line (3-12 words, mostly letters).
    if (block.length < 80 && block === block.toUpperCase() && /^[A-Z][A-Z0-9 ,/&\-:]{4,79}$/.test(block) && block.split(/\s+/).length <= 12) {
      currentHeading = block.slice(0, 140);
      runningOffset += rawBlock.length + 2;
      continue;
    }

    out.push({ paragraph: block, pageNumber: currentPage, sectionHeading: currentHeading, offset: runningOffset });
    runningOffset += rawBlock.length + 2;
  }
  return out;
}

/**
 * Tokenises a string into lowercased word tokens (stopwords removed)
 * for cheap overlap scoring. Stopwords are the obvious English filler
 * + procurement boilerplate that appears in every tender.
 */
const STOP = new Set("the a an of and or for to in on at by with as is are was were be been have has had this that these those will may must shall should can could it its their our we you bidder bidders proposal proposer proposers tender tenderer".split(/\s+/));
function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Reject structurally unrelated boilerplate even when generic words overlap. */
export function quoteStructurallyProvesRequirement(requirement: RequirementInput, quote: string): boolean {
  const requirementText = `${requirement.title} ${requirement.description}`.toLowerCase();
  const quoteText = quote.toLowerCase();
  const expert = /\b(expert|personnel|staff|curriculum vitae|\bcv\b|specialist|team leader)\b/.test(requirementText);
  const project = /\b(project reference|past performance|similar project|relevant experience|contract experience)\b/.test(requirementText);
  if (expert && !/\b(expert|personnel|staff|curriculum vitae|\bcv\b|specialist|team leader|qualification|years? experience)\b/.test(quoteText)) return false;
  if (project && !/\b(project|contract|client|assignment|reference|past performance|experience)\b/.test(quoteText)) return false;
  if ((expert || project) && /\bevaluation criteria\b/.test(quoteText)
    && !/\b(submit|provide|required|minimum|shall|must)\b/.test(quoteText)) return false;
  return true;
}

/**
 * For each requirement, find the best-matching paragraph in the file.
 * The "best match" is the highest Jaccard overlap between the
 * requirement's title-token set and each paragraph's title-token set,
 * with a small bonus when the requirement's title appears verbatim.
 */
export function extractRequirementSources(opts: {
  tenderFileId: string;
  tenderFileText: string;
  requirements: RequirementInput[];
  options?: ExtractorOptions;
}): RequirementSource[] {
  const o: Required<ExtractorOptions> = { ...DEFAULT_OPTS, ...(opts.options ?? {}) };
  const paragraphs = splitIntoParagraphs(opts.tenderFileText);
  if (paragraphs.length === 0) {
    return opts.requirements.map((r) => ({ requirementId: r.id, sourceConfidence: 0 }));
  }

  // Pre-compute paragraph token sets once.
  const paraTokens = paragraphs.map((p) => tokens(p.paragraph));

  return opts.requirements.map((req) => {
    const reqTokens = tokens(`${req.title} ${req.description}`);
    if (reqTokens.size === 0) return { requirementId: req.id, sourceConfidence: 0 };

    let bestIdx = -1;
    let bestScore = 0;
    const titleLc = req.title.toLowerCase();
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (!quoteStructurallyProvesRequirement(req, paragraphs[i].paragraph)) continue;
      const j = jaccard(reqTokens, paraTokens[i]);
      // Verbatim title bonus.
      const verbatim = titleLc.length > 8 && paragraphs[i].paragraph.toLowerCase().includes(titleLc) ? 0.15 : 0;
      const score = j + verbatim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestScore < o.minConfidence) {
      return { requirementId: req.id, sourceConfidence: 0 };
    }

    const para = paragraphs[bestIdx];
    return {
      requirementId: req.id,
      sourceTenderFileId: opts.tenderFileId,
      sourcePageNumber: para.pageNumber,
      sourceSectionHeading: para.sectionHeading,
      sourceExactQuote: para.paragraph.length > o.maxQuoteChars
        ? `${para.paragraph.slice(0, o.maxQuoteChars - 1).trim()}…`
        : para.paragraph,
      sourceConfidence: Math.min(1, bestScore),
    };
  });
}
