// Deterministic, source-grounded evaluation-methodology extractor.
//
// Complements the existing AI-based deep-comprehension extractor
// (lib/engine/evaluation-criteria-extractor.ts). That module asks Claude for
// the full semantic decoding and is the preferred path. This one is a
// regex-only fallback that runs against already-extracted tender file text
// to repair `tender.evaluationMethodology` when:
//
//   • AI Analyze used the regex fallback (provider rate-limited),
//   • or the AI Analyze run did not capture this field for any reason.
//
// Critical safety properties:
//   • never invents content,
//   • returns `found:false` (with a reason) when no plausible section
//     header matches,
//   • when it finds a section, captures the verbatim quote so the audit
//     log and the readiness panel can show "extracted from <file>" and the
//     user can verify before approving the repair.

export type EvaluationCriteriaItem = {
  label: string;
  weight: number | null;
  weightUnit: "PERCENT" | "MARKS" | "POINTS" | null;
  isPassFail: boolean;
  fromQuote: string;
};

export type EvaluationCriteriaExtractionFound = {
  found: true;
  methodologyText: string;
  sourceQuote: string;
  sourceFile: string | null;
  items: EvaluationCriteriaItem[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type EvaluationCriteriaExtractionMissing = {
  found: false;
  reason: string;
};

export type EvaluationCriteriaExtraction =
  | EvaluationCriteriaExtractionFound
  | EvaluationCriteriaExtractionMissing;

const MAX_METHODOLOGY_CHARS = 3000;
const MAX_QUOTE_CHARS = 400;
const SECTION_WINDOW = 1800;

// Section-header anchors. Ordered most-specific → most-general so a confident
// "Evaluation Methodology" wins over a bare "Evaluation Stage".
const SECTION_HEADER_PATTERNS: Array<{ rx: RegExp; baseConfidence: "HIGH" | "MEDIUM" | "LOW" }> = [
  { rx: /\bEvaluation\s+(?:Methodology|Method|Procedure|Approach|Framework)\b/i, baseConfidence: "HIGH" },
  { rx: /\bEvaluation\s+(?:Criteria|Criterion)\b/i, baseConfidence: "HIGH" },
  { rx: /\bSelection\s+(?:Criteria|Factors|Framework)\b/i, baseConfidence: "HIGH" },
  { rx: /\bAward\s+(?:Criteria|Factors)\b/i, baseConfidence: "HIGH" },
  { rx: /\bTechnical\s+and\s+Financial\s+Evaluation\b/i, baseConfidence: "HIGH" },
  { rx: /\bScoring\s+(?:Criteria|Methodology|Approach|System)\b/i, baseConfidence: "MEDIUM" },
  { rx: /\bAssessment\s+(?:Criteria|Methodology|Framework)\b/i, baseConfidence: "MEDIUM" },
  { rx: /\bEvaluation\s+(?:Stage|Process|Steps?)\b/i, baseConfidence: "MEDIUM" },
  { rx: /\bQualification\s+(?:Criteria|Stage)\b/i, baseConfidence: "MEDIUM" },
  { rx: /\bResponsiveness\s+Check\b/i, baseConfidence: "LOW" },
];

// Criterion labels often found inside an evaluation section. Used both to
// spot items when no explicit table is present, and to validate the matched
// section really IS about evaluation (not e.g. a budget section).
const CRITERION_LABEL_PATTERNS: Array<{ rx: RegExp; label: string }> = [
  { rx: /\bTechnical\s+(?:Proposal|Score|Evaluation|Criteria|Approach)\b/i, label: "Technical Proposal" },
  { rx: /\bFinancial\s+(?:Proposal|Score|Evaluation|Criteria|Envelope)\b/i, label: "Financial Proposal" },
  { rx: /\bMethodology\s+(?:and\s+Approach|and\s+Work\s+Plan)?\b/i, label: "Methodology" },
  { rx: /\bWork\s+Plan\b/i, label: "Work Plan" },
  { rx: /\bKey\s+(?:Personnel|Staff|Experts)\b/i, label: "Key Personnel" },
  { rx: /\bPast\s+Performance\b/i, label: "Past Performance" },
  { rx: /\bSimilar\s+(?:Projects|Experience|Assignments)\b/i, label: "Similar Experience" },
  { rx: /\bComparable\s+(?:Projects?|Experience|Assignments?)\b/i, label: "Comparable Experience" },
  { rx: /\bQuality\s+(?:of\s+)?(?:the\s+)?(?:Proposed\s+)?Methodology\b/i, label: "Methodology Quality" },
  { rx: /\bCompany\s+(?:Profile|Experience|Background)\b/i, label: "Company Experience" },
  { rx: /\bQualifications?(?:\s+of\s+the\s+(?:Firm|Bidder))?\b/i, label: "Qualifications" },
  { rx: /\bUnderstanding\s+of\s+(?:the\s+)?(?:Assignment|Scope|ToR)\b/i, label: "Understanding of Assignment" },
  { rx: /\bPresentation\b/i, label: "Presentation" },
  { rx: /\bInterview\b/i, label: "Interview" },
];

// Weight patterns. Order matters — "X marks" beats a bare percent when both
// appear in the same window.
const WEIGHT_PATTERNS: Array<{ rx: RegExp; unit: "PERCENT" | "MARKS" | "POINTS" }> = [
  { rx: /(\d{1,3})\s*(?:marks|mark)\b/i, unit: "MARKS" },
  { rx: /(\d{1,3})\s*(?:points|pts)\b/i, unit: "POINTS" },
  { rx: /(?:weight(?:age)?|score)\s*[:=]?\s*(\d{1,3})\s*%/i, unit: "PERCENT" },
  { rx: /\b(\d{1,3})\s*%/, unit: "PERCENT" },
];

const PASS_FAIL_PATTERN = /\bpass[\s/-]?(?:or\s+)?fail\b/i;

function cleanSection(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Capture a window of source after a header match, stopping at the next
// likely unrelated section break.
function captureSectionAfter(text: string, headerStart: number, headerEnd: number): string {
  const end = Math.min(text.length, headerEnd + SECTION_WINDOW);
  let snippet = text.slice(headerStart, end);
  const STOP = /\n\s*(?:\d+\.?\s+[A-Z][A-Z\s]{6,}|Annex(?:ure)?\b|Appendix\b|Submission\s+Instructions|Bid\s+Bond|Bid\s+Security|Schedule\s+\d|Form\s+[A-Z]\d?)/;
  const stopMatch = STOP.exec(snippet);
  if (stopMatch && stopMatch.index > 200) snippet = snippet.slice(0, stopMatch.index);
  return cleanSection(snippet).slice(0, MAX_METHODOLOGY_CHARS);
}

function extractItems(section: string): EvaluationCriteriaItem[] {
  const items: EvaluationCriteriaItem[] = [];
  const seen = new Set<string>();
  for (const { rx, label } of CRITERION_LABEL_PATTERNS) {
    const m = rx.exec(section);
    if (!m || seen.has(label)) continue;
    seen.add(label);
    // Forward-only window: a weight bound to a label nearly always appears
    // AFTER the label ("Financial Proposal: 30%" / "Financial Proposal — 20 marks").
    // Scanning a few chars before the label cross-pollinates with the
    // previous line's value and binds the wrong weight to this item.
    const windowStart = m.index;
    const windowEnd = Math.min(section.length, m.index + 180);
    const around = section.slice(windowStart, windowEnd);
    let weight: number | null = null;
    let weightUnit: EvaluationCriteriaItem["weightUnit"] = null;
    for (const wp of WEIGHT_PATTERNS) {
      const wm = wp.rx.exec(around);
      if (wm) {
        const n = Number(wm[1]);
        if (Number.isFinite(n) && n >= 0 && n <= 100) { weight = n; weightUnit = wp.unit; break; }
      }
    }
    items.push({
      label,
      weight,
      weightUnit,
      isPassFail: PASS_FAIL_PATTERN.test(around),
      fromQuote: around.replace(/\s+/g, " ").trim().slice(0, 200),
    });
  }
  return items;
}

function computeConfidence(opts: { baseConfidence: "HIGH" | "MEDIUM" | "LOW"; items: EvaluationCriteriaItem[] }): "HIGH" | "MEDIUM" | "LOW" {
  const weighted = opts.items.filter((i) => typeof i.weight === "number");
  const totalPercent = weighted
    .filter((i) => i.weightUnit === "PERCENT")
    .reduce((acc, i) => acc + (i.weight ?? 0), 0);
  const hasTfSplit =
    opts.items.some((i) => i.label === "Technical Proposal") &&
    opts.items.some((i) => i.label === "Financial Proposal");
  if (opts.baseConfidence === "HIGH" && weighted.length >= 2 && (totalPercent >= 90 && totalPercent <= 110 || hasTfSplit)) return "HIGH";
  if (weighted.length >= 1 && opts.items.length >= 2) return "MEDIUM";
  if (opts.items.length >= 1) return "MEDIUM";
  return "LOW";
}

export type EvaluationMethodologyExtractorInput = {
  files: Array<{ fileName?: string | null; extractedText?: string | null }>;
};

/**
 * Extracts the evaluation methodology section from already-extracted tender
 * file text. Returns the best (highest-confidence) match across all files,
 * or `{ found: false }` when no plausible section is detected.
 */
export function extractEvaluationMethodologyFromSource(input: EvaluationMethodologyExtractorInput): EvaluationCriteriaExtraction {
  const candidates: EvaluationCriteriaExtractionFound[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (!text || text.length < 80) continue;
    for (const header of SECTION_HEADER_PATTERNS) {
      const m = header.rx.exec(text);
      if (!m) continue;
      const section = captureSectionAfter(text, m.index, m.index + m[0].length);
      const items = extractItems(section);
      // Require at least one criterion-label hit unless the header itself is
      // HIGH confidence (so we never persist a bare "Evaluation Stage" line
      // with no content).
      if (items.length === 0 && header.baseConfidence !== "HIGH") continue;
      const sourceQuote = section.slice(0, MAX_QUOTE_CHARS).trim();
      candidates.push({
        found: true,
        methodologyText: section,
        sourceQuote,
        sourceFile: file?.fileName ?? null,
        items,
        confidence: computeConfidence({ baseConfidence: header.baseConfidence, items }),
      });
      break; // first header per file is enough
    }
  }
  if (candidates.length === 0) {
    return { found: false, reason: "No evaluation methodology / criteria / scoring section detected in any uploaded tender file." };
  }
  const order = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  candidates.sort((a, b) => order[b.confidence] - order[a.confidence] || b.items.length - a.items.length);
  return candidates[0];
}

/**
 * Formats the extraction for the audit log. Bounded to ~600 chars; safe to
 * stringify into a single audit description.
 */
export function formatExtractionForAudit(extraction: EvaluationCriteriaExtractionFound): string {
  const itemSummary = extraction.items.length === 0
    ? "no individually-weighted items detected"
    : extraction.items.slice(0, 5).map((i) =>
        `${i.label}${i.weight !== null ? ` ${i.weight}${i.weightUnit === "PERCENT" ? "%" : i.weightUnit === "MARKS" ? " marks" : " pts"}` : ""}${i.isPassFail ? " (pass/fail)" : ""}`,
      ).join("; ");
  return `Extracted from ${extraction.sourceFile ?? "tender source"} (${extraction.confidence} confidence): ${itemSummary}`.slice(0, 600);
}
