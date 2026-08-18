import { extractRequirementSources, truncateQuoteVerbatim, type RequirementSource } from "./requirement-source-extractor";

export type TenderSourceDocument = {
  id: string;
  name?: string | null;
  text: string;
};

export type SourceGroundedRequirement = {
  id: string;
  requirement: string;
  sourceTenderFileId: string | null;
  sourceTenderFileName: string | null;
  sourcePageNumber: number | null;
  sourceSectionHeading: string | null;
  sourceExactQuote: string | null;
  sourceConfidence: number;
  grounded: boolean;
  validationAction: string;
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFor(requirement: string): string {
  const cleaned = clean(requirement);
  const sentence = cleaned.split(/[.;:\n]/).map((part) => part.trim()).find(Boolean) ?? cleaned;
  return sentence.length > 120 ? sentence.slice(0, 120) : sentence;
}

function confidenceLabel(score: number): "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (score >= 0.55) return "HIGH";
  if (score >= 0.35) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

function validationAction(source: RequirementSource | null, mandatory: boolean): string {
  const confidence = source?.sourceConfidence ?? 0;
  const label = confidenceLabel(confidence);
  if (!source || confidence === 0) return mandatory ? "Block final export until this mandatory requirement is traced to the tender source or formally waived." : "Trace this requirement to the tender source before making a strong claim.";
  if (label === "LOW") return mandatory ? "Senior review required: low-confidence source match for mandatory requirement." : "Use cautiously: low-confidence source match should be confirmed.";
  if (label === "MEDIUM") return "Confirm source quote/page during senior review before final export.";
  return "Source-grounded: verify quote/page during final proofread.";
}

function isMandatoryRequirement(requirement: string): boolean {
  return /\bshall\b|\bmust\b|required|mandatory|compulsory|pass\/fail|failure\s+to|non[-\s]?responsive|disqualif|reject|will\s+be\s+rejected/i.test(requirement);
}

const STOP = new Set("the a an of and or for to in on at by with as is are was were be been have has had this that these those will may must shall should can could it its their our we you bidder bidders proposal proposer proposers tender tenderer consultant consultants provide submit valid include includes included last these those".split(/\s+/));

function tokens(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

function parseHeading(line: string): string | null {
  const heading = line.match(/^(?:section\s+)?(\d{1,2}(?:\.\d{1,3}){0,3})\s+(.{4,140})$/i)
    ?? line.match(/^(annex\s+[A-Z](?:\.\d{1,2})?)[\s:.\-]+(.{4,140})$/i)
    ?? line.match(/^(article\s+[ivxlcdm]+)[\s:.\-]+(.{4,140})$/i);
  return heading ? `${heading[1]} ${heading[2]}`.trim().slice(0, 140) : null;
}

function splitBlocks(text: string): Array<{ paragraph: string; pageNumber?: number; sectionHeading?: string }> {
  const out: Array<{ paragraph: string; pageNumber?: number; sectionHeading?: string }> = [];
  let currentPage: number | undefined;
  let currentHeading: string | undefined;

  for (const raw of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const pageOnly = line.match(/^\[\s*page\s*(\d{1,4})\s*\]$/i)
        ?? line.match(/^\(?\s*page\s+(\d{1,4})(?:\s+of\s+\d{1,4})?\s*\)?$/i);
      if (pageOnly) {
        currentPage = Number(pageOnly[1]);
        continue;
      }

      const inlinePage = line.match(/\[\s*page\s*(\d{1,4})\s*\]/i);
      let working = line;
      if (inlinePage) {
        currentPage = Number(inlinePage[1]);
        working = line.replace(inlinePage[0], "").trim();
        if (!working) continue;
      }

      const heading = parseHeading(working);
      if (heading && working.length < 180) {
        currentHeading = heading;
        continue;
      }

      paragraphLines.push(working);
    }

    const paragraph = paragraphLines.join(" ").trim();
    if (paragraph) out.push({ paragraph, pageNumber: currentPage, sectionHeading: currentHeading });
  }

  return out;
}

function lexicalFallback(input: {
  requirementId: string;
  requirement: string;
  source: TenderSourceDocument;
}): RequirementSource & { sourceTenderFileName?: string | null } | null {
  const reqTokens = tokens(input.requirement);
  if (reqTokens.length === 0) return null;
  let best: { paragraph: string; pageNumber?: number; sectionHeading?: string; score: number } | null = null;
  for (const block of splitBlocks(input.source.text)) {
    const lower = clean(block.paragraph).toLowerCase();
    const hits = reqTokens.filter((token) => lower.includes(token)).length;
    const score = hits / Math.max(reqTokens.length, 1);
    if (!best || score > best.score) best = { ...block, score };
  }
  if (!best || best.score < 0.45) return null;
  return {
    requirementId: input.requirementId,
    sourceTenderFileId: input.source.id,
    sourceTenderFileName: input.source.name ?? null,
    sourcePageNumber: best.pageNumber,
    sourceSectionHeading: best.sectionHeading,
    // Same verbatim-substring contract as requirement-source-extractor: the
    // stored quote is checked with `extractedText.includes(quote)`, so it must
    // never carry an ellipsis or lose leading whitespace.
    sourceExactQuote: truncateQuoteVerbatim(best.paragraph, 380),
    sourceConfidence: Math.min(0.85, Math.max(0.2, best.score)),
  };
}

export function buildSourceGroundedRequirementMap(input: {
  requirements: string[];
  tenderSources: TenderSourceDocument[];
  minConfidence?: number;
}): SourceGroundedRequirement[] {
  const requirements = input.requirements.map((requirement, index) => ({
    id: `SRC-REQ-${index + 1}`,
    title: titleFor(requirement),
    description: clean(requirement),
    original: clean(requirement),
  })).filter((item) => item.original.length > 0);

  if (requirements.length === 0) return [];
  const bestById = new Map<string, RequirementSource & { sourceTenderFileName?: string | null }>();

  for (const source of input.tenderSources) {
    const text = clean(source.text);
    if (text.length < 20) continue;
    const matches = extractRequirementSources({
      tenderFileId: source.id,
      tenderFileText: source.text,
      requirements: requirements.map((req) => ({ id: req.id, title: req.title, description: req.description })),
      options: { minConfidence: input.minConfidence ?? 0.2, maxQuoteChars: 380 },
    });
    for (const req of requirements) {
      const match = matches.find((candidate) => candidate.requirementId === req.id);
      const fallback = !match || match.sourceConfidence === 0 ? lexicalFallback({ requirementId: req.id, requirement: req.original, source }) : null;
      const candidate = match && match.sourceConfidence > 0 ? { ...match, sourceTenderFileName: source.name ?? null } : fallback;
      if (!candidate) continue;
      const previous = bestById.get(candidate.requirementId);
      if (!previous || candidate.sourceConfidence > previous.sourceConfidence) {
        bestById.set(candidate.requirementId, candidate);
      }
    }
  }

  return requirements.map((req) => {
    const best = bestById.get(req.id) ?? null;
    const mandatory = isMandatoryRequirement(req.original);
    const confidence = best?.sourceConfidence ?? 0;
    return {
      id: req.id,
      requirement: req.original,
      sourceTenderFileId: best?.sourceTenderFileId ?? null,
      sourceTenderFileName: best?.sourceTenderFileName ?? null,
      sourcePageNumber: best?.sourcePageNumber ?? null,
      sourceSectionHeading: best?.sourceSectionHeading ?? null,
      sourceExactQuote: best?.sourceExactQuote ?? null,
      sourceConfidence: confidence,
      grounded: confidence >= (input.minConfidence ?? 0.2) && Boolean(best?.sourceExactQuote),
      validationAction: validationAction(best, mandatory),
    } satisfies SourceGroundedRequirement;
  });
}

export function renderSourceGroundedRequirementMap(input: {
  sourceMap: SourceGroundedRequirement[];
}): string {
  const rows = [
    "| ID | Requirement | Source | Page | Confidence | Quote / validation action |",
    "|---|---|---|---:|---:|---|",
  ];
  for (const item of input.sourceMap) {
    const source = item.sourceTenderFileName ?? item.sourceTenderFileId ?? "UNTRACED";
    const quote = item.sourceExactQuote ? clean(item.sourceExactQuote).slice(0, 260) : "No source quote mapped.";
    rows.push(`| ${item.id} | ${clean(item.requirement).slice(0, 220)} | ${source} | ${item.sourcePageNumber ?? ""} | ${Math.round(item.sourceConfidence * 100)}% | ${quote}<br>${item.validationAction} |`);
  }
  const grounded = input.sourceMap.filter((item) => item.grounded).length;
  return [
    "## Source-Grounded Requirement Map",
    `Source grounding summary: ${grounded}/${input.sourceMap.length} requirement(s) are traced to a tender source quote. Untraced mandatory requirements must be resolved before final export.`,
    rows.join("\n"),
  ].join("\n\n");
}
