/**
 * Placeholder stripper (PR J).
 *
 * THE PROBLEM
 * Multiple deterministic builders emit "Bid-Team Action: confirm X
 * before submission" notes when their input data is missing. PRs
 * #257-259 + E + F + G + H added this protective behaviour so the
 * engine never fabricates. But the side effect is that a proposal
 * generated from an under-populated vault leaks 25+ "Bid-Team Action"
 * lines into the final DOCX. Evaluators see these and the proposal
 * looks like an internal draft.
 *
 * THE FIX
 * Run a final-pass stripper just before DOCX rendering that:
 *
 *   1. Removes "Bid-Team Action" lines that occupy a whole line on
 *      their own (italicised "_Source-evidence action: ..._" notes
 *      and bullet "- Bid-Team Action: ..." items). These are the
 *      ones that visually scream "draft".
 *
 *   2. Replaces inline "Bid-Team Action: confirm X" cell content in
 *      tables with a tasteful em-dash "—" so the table layout
 *      stays intact but the placeholder text doesn't bleed through.
 *
 *   3. Removes whole italicised PARAGRAPHS that consist only of
 *      "_Source-evidence action: ..._" — the Section A.4 / B.2 /
 *      A.5 fallback paragraphs.
 *
 *   4. Returns a count of stripped instances for observability.
 *
 * NEVER FABRICATES — never replaces a placeholder with invented data.
 * Either vault data flows in earlier, or the placeholder is silently
 * removed.
 *
 * SCOPE
 * Runs LAST in the post-pass chain, after methodology-tables,
 * beyond-spec-tables, win-themes, mobilization-and-checklist, and
 * ensureRubricHeadings. So the markdown reaching DOCX render is
 * placeholder-free.
 */

const LINE_PATTERNS: RegExp[] = [
  // Bullet variants
  /^\s*[-*•]\s*Bid-Team Action[^\n]*$/gim,
  /^\s*[-*•]\s*Source-evidence action[^\n]*$/gim,
  // Italic block-level
  /^_Source-evidence action[^\n]*_\s*$/gim,
  /^_Bid-Team Action[^\n]*_\s*$/gim,
  // Plain block-level lines (not bullets)
  /^Bid-Team Action:[^\n]*$/gim,
  /^Source-evidence action:[^\n]*$/gim,
];

// Cell-level replacement — when a markdown table cell contains ONLY
// "Bid-Team Action: confirm X", replace with em-dash.
const CELL_PLACEHOLDER_RE = /\|\s*(?:Bid-Team Action|Source-evidence action)[^|\n]*?\|/gi;

// Whole-paragraph italic placeholders (multi-word italic blocks that
// are only Bid-Team-Action / source-evidence text).
const ITALIC_PARA_RE = /(?:^|\n)\s*_(?:Source-evidence action|Bid-Team Action)[^_]*?_\s*(?=\n|$)/gim;

export interface StripResult {
  markdown: string;
  removedLines: number;
  blankedCells: number;
  removedParagraphs: number;
}

export function stripPlaceholders(markdown: string): StripResult {
  let result = markdown;
  let removedLines = 0;
  let blankedCells = 0;
  let removedParagraphs = 0;

  // 1. Remove italic paragraph placeholders
  const beforeParaCount = result.length;
  result = result.replace(ITALIC_PARA_RE, "");
  if (result.length < beforeParaCount) {
    removedParagraphs += 1;
  }

  // 2. Remove whole-line placeholder content
  for (const re of LINE_PATTERNS) {
    const matches = result.match(re);
    if (matches) removedLines += matches.length;
    result = result.replace(re, "");
  }

  // 3. Replace placeholder content in table cells with em-dash
  result = result.replace(CELL_PLACEHOLDER_RE, () => {
    blankedCells += 1;
    return "| — |";
  });

  // 4. Collapse 3+ blank lines to 2 so removed sections don't leave
  // visible holes in the document.
  result = result.replace(/\n{3,}/g, "\n\n");

  // 5. Trim trailing whitespace from each line.
  result = result
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  return { markdown: result, removedLines, blankedCells, removedParagraphs };
}
