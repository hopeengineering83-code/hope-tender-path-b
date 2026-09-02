/**
 * Internal Review Section Stripper (PR X).
 *
 * THE PROBLEM
 * The user's real proposal output had a TOC carrying ~30 entries —
 * but ~12 of those were INTERNAL bid-review / evidence-control sections
 * that should never appear in a client-facing technical proposal:
 *
 *   - Evaluator Response Matrix
 *   - Claim-to-Evidence Proof Map
 *   - Unsupported Claim Control
 *   - Delivery Methodology Work Plan
 *   - Evidence-Based Appendix Register
 *   - Final Submission Control Checklist
 *   - Benchmark Opening Proof Strategy
 *   - Evaluator Decision Narrative
 *   - Evaluator-Facing Team-to-Assignment Mapping
 *   - Sector-Specific Methodology Depth (this is bid-team metadata)
 *   - Client-Ready Appendix Register
 *   - Final Claim and Evidence Control
 *
 * These were originally designed as bid-team review aids to be
 * consumed BEFORE submission, not delivered to the client. Two
 * builders (proposal-evaluator-matrix.ts and
 * proposal-strengthening-sections.ts) merge them straight into the
 * proposal markdown alongside Section A/B/C/D content. Evaluators
 * see "Unsupported Claim Control" with bullets like "Do not invent
 * projects" and immediately mark the proposal down — that's an
 * internal note, never a client-facing artefact.
 *
 * THE FIX
 * Strip these sections from the proposal markdown right before DOCX
 * render. The sections are identified by their canonical heading
 * patterns. Removed content is logged for audit but never appears
 * in the final DOCX.
 *
 * NEVER FABRICATES — strips only. Doesn't replace, doesn't reword.
 */

const INTERNAL_REVIEW_HEADINGS: RegExp[] = [
  /^##?\s+Evaluator\s+Response\s+Matrix\b/i,
  /^##?\s+Claim-to-Evidence\s+Proof\s+Map\b/i,
  /^##?\s+Unsupported\s+Claim\s+Control\b/i,
  /^##?\s+Delivery\s+Methodology\s+Work\s+Plan\b/i,
  /^##?\s+Evidence-Based\s+Appendix\s+Register\b/i,
  /^##?\s+Final\s+Submission\s+Control\s+Checklist\b/i,
  /^##?\s+Benchmark\s+Opening\s+Proof\s+Strategy\b/i,
  /^##?\s+Evaluator\s+Decision\s+Narrative\b/i,
  /^##?\s+Evaluator-Facing\s+Team-to-Assignment\s+Mapping\b/i,
  /^##?\s+Sector-Specific\s+Methodology\s+Depth\b/i,
  /^##?\s+Client-Ready\s+Appendix\s+Register\b/i,
  /^##?\s+Final\s+Claim\s+(?:and|&)\s+Evidence\s+Control\b/i,
  // Generic bid-team metadata bleeds:
  /^##?\s+Senior\s+Bid\s+Review\s+(?:Notes|Memo)\b/i,
  // A real client-facing proposal shipped "# Compliance and Bid Review Notes"
  // carrying the engine's own support-level records, its vault file names, a
  // serialized automatic-requirement-evidence payload and a named employee's
  // date of birth and phone number, followed by "## Senior Bid-Review Items
  // (gaps to address before submission)" listing the bid team's instructions
  // to itself. The builder no longer emits either heading; these patterns stop
  // any other path from shipping them. "Bid Review Notes" and "Bid-Review
  // Items" are matched whichever way the hyphen falls.
  /^##?\s+Compliance\s+and\s+Bid[-\s]Review\s+Notes\b/i,
  /^##?\s+Senior\s+Bid[-\s]Review\s+Items\b/i,
  /^##?\s+Internal\s+(?:Bid|Review)\s+Notes\b/i,
  // PR DD additions: additional internal sections seen in real AI output
  /^##?\s+Bid-Team\s+(?:Action|Notes?|Review)\b/i,
  /^##?\s+Proposal\s+(?:Checklist|Review\s+Notes?|Quality\s+Control)\b/i,
  /^##?\s+Evidence\s+Gap\s+(?:Register|Analysis)\b/i,
  /^##?\s+Submission\s+Control\s+(?:Sheet|Checklist|Register)\b/i,
  /^##?\s+Competitive\s+(?:Intelligence|Positioning)\s+(?:Notes?|Analysis)\b/i,
  /^##?\s+Pre-Submission\s+(?:Review|Checklist|Notes?)\b/i,
  /^##?\s+Technical\s+Review\s+(?:Panel|Notes?|Memo)\b/i,
  /^##?\s+Bid\s+Review\s+(?:Panel|Notes?|Memo|Control)\b/i,
  /^##?\s+Quality\s+(?:Gate|Control)\s+(?:Notes?|Review|Checklist)\b/i,
  /^##?\s+Benchmark\s+(?:Analysis|Scoring|Notes?)\b/i,
  /^##?\s+How\s+(?:This\s+)?(?:Proposal|Bid)\s+(?:Was\s+Built|Scores?)\b/i,
  /^##?\s+Proposal\s+Build\s+(?:Notes?|Log|Strategy)\b/i,
];

function isInternalReviewHeading(line: string): boolean {
  return INTERNAL_REVIEW_HEADINGS.some((p) => p.test(line));
}

// Detect the END of an internal-review section. End = next heading at
// the SAME OR LOWER level (#, ##, etc.).
function findSectionEnd(lines: string[], startLine: number): number {
  const startMatch = lines[startLine].match(/^(#+)\s/);
  if (!startMatch) return startLine + 1;
  const startLevel = startMatch[1].length;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= startLevel) return i;
  }
  return lines.length;
}

export interface InternalReviewStripResult {
  markdown: string;
  removedSections: string[];
}

export function stripInternalReviewSections(markdown: string): InternalReviewStripResult {
  const lines = markdown.split("\n");
  const removedSections: string[] = [];
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    if (isInternalReviewHeading(lines[i])) {
      const end = findSectionEnd(lines, i);
      removedSections.push(lines[i].replace(/^#+\s*/, "").trim());
      i = end;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }

  // Collapse 3+ blank lines created by removal
  let result = out.join("\n").replace(/\n{3,}/g, "\n\n");

  return { markdown: result, removedSections };
}
