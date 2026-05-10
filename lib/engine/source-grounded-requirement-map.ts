import { extractRequirementSources, type RequirementSource } from "./requirement-source-extractor";

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
    for (const match of matches) {
      const previous = bestById.get(match.requirementId);
      if (!previous || match.sourceConfidence > previous.sourceConfidence) {
        bestById.set(match.requirementId, { ...match, sourceTenderFileName: source.name ?? null });
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
