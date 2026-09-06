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
  /^##?\s+Proposal\s+Evaluator\s+Loop\b/i,
  /^##?\s+(?:SECTION\s+H:\s*)?Proposal\s+Self[-\s]Score\b/i,
  /^##?\s+Compliance\s+and\s+Bid\s+Review\s+Strategy\b/i,
  /^##?\s+Tender\s+Proposal\s+AI[-\s]Ready\s+Summary\b/i,
  /^##?\s+Annex\s+(?:&|and)\s+Appendix\s+Readiness\s+Register\b/i,
  /^##?\s+Appendix\s+Register\b/i,
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

// ─── Internal diagnostic CONTENT (not whole sections) ────────────────────
//
// stripInternalReviewSections above removes an internal section when it has a
// recognisable heading. That is not enough on its own, because the engine's
// internal reasoning also arrives INSIDE legitimate client-facing sections —
// as a table row, a bullet, or a sentence in a paragraph that is otherwise
// fine. A real submitted proposal carried these on pages 34–35, under two
// perfectly reasonable headings:
//
//   | Energy / power tender detected but no energy-specific reviewed project
//     is selected. Use the closest electromechanical or infrastructure
//     project and flag the sector gap as a senior bid-review action. | ...
//   | Tender hot-button: ... | ... | Bid-Team Action: confirm quantified
//     discriminator for this theme | ...
//
// Those strings were produced by the gap detector and the win-themes builder,
// and both channels are now cut at their source. This pass is the second
// line of defence, and it matters because the model writer can produce the
// same shapes on its own — it was, until this change, explicitly prompted to
// think in "win themes" and "discriminators".
//
// The patterns describe SHAPES of internal writing, not specific sentences:
//
//   1. an instruction addressed to the bidder's own staff
//      ("Bid-Team Action: ...", "flag ... as a senior bid-review action",
//       "... before final submission", "note the gap for the bid team");
//   2. an engine detection report
//      ("<anything> tender detected but no <anything> is selected");
//   3. an instruction to substitute or find evidence
//      ("Use the closest ...", "confirm evidence anchor ...");
//   4. bid-desk strategy labels used as content
//      ("Tender hot-button:", "Additional discriminators", "Win theme:").
//
// A phrase list would have caught the five sentences the owner found and
// nothing else. These shapes catch the next five as well.
const INTERNAL_DIAGNOSTIC_SHAPES: RegExp[] = [
  // 1. Instructions the bid team writes to itself.
  /\bbid[-\s]?team\s+action\b/i,
  /\bflag\b[^.]{0,80}\bas\s+a\s+(?:senior\s+)?bid[-\s]?review\s+action\b/i,
  /\b(?:note|flag|raise)\s+(?:this\s+)?(?:the\s+)?gap\s+for\s+(?:the\s+)?(?:bid|senior|review)\b/i,
  /\bbefore\s+(?:the\s+)?final\s+submission\b/i,
  /\bbefore\s+export\b/i,
  /\bsenior\s+bid[-\s]?review\b/i,
  // 2. Engine detection reports about the tender or the evidence vault.
  /\btender\s+detected\s+but\s+no\b/i,
  /\bno\s+[a-z-]+[-\s]specific\s+reviewed\s+project\s+is\s+selected\b/i,
  /\bis\s+currently\s+selected\b.*\bproposal\s+must\s+include\b/i,
  // 3. Instructions to substitute or go and find evidence.
  /\buse\s+the\s+closest\b/i,
  /\bconfirm\s+(?:the\s+)?evidence\s+anchor\b/i,
  /\bconfirm\s+(?:a\s+|the\s+)?(?:specific|quantified)\s+discriminator\b/i,
  // 4. Bid-desk strategy vocabulary used as client-facing content.
  /\btender\s+hot[-\s]?button\b/i,
  /\bhot[-\s]?buttons?\b/i,
  /\badditional\s+discriminators\b/i,
  /\bwin\s+theme\s*:/i,
];

function isInternalDiagnosticText(text: string): boolean {
  return INTERNAL_DIAGNOSTIC_SHAPES.some((p) => p.test(text));
}

/** A markdown table row that is not the |---|---| separator. */
function isTableRow(line: string): boolean {
  if (!/^\s*\|.*\|\s*$/.test(line)) return false;
  if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return false; // separator
  return true;
}

export interface InternalDiagnosticStripResult {
  markdown: string;
  removedLines: string[];
}

/**
 * Remove internal-diagnostic CONTENT that survives inside client-facing
 * sections: table body rows, list items and standalone paragraph lines whose
 * text is written to the bid team rather than to the client.
 *
 * Deliberately conservative:
 *   - table header rows and separators are never removed, so a table cannot
 *     be structurally broken by this pass;
 *   - headings are never removed here (that is the section stripper's job);
 *   - a paragraph line is removed only when the whole line matches, so a
 *     legitimate sentence that merely contains a matching word inside a
 *     longer passage is not silently truncated mid-thought.
 */
export function stripInternalDiagnosticContent(markdown: string): InternalDiagnosticStripResult {
  const lines = markdown.split("\n");
  const removedLines: string[] = [];
  const out: string[] = [];

  // Identify header rows up front: the row directly above a |---|---| line.
  const headerRowIndexes = new Set<number>();
  for (let i = 1; i < lines.length; i += 1) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]) && /^\s*\|.*\|\s*$/.test(lines[i - 1])) {
      headerRowIndexes.add(i - 1);
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\s*#{1,6}\s/.test(line)) {
      out.push(line);
      continue;
    }

    // Any table row is handled here and here only. Falling through to the
    // standalone-line check below would delete a protected header row whose
    // column label happens to match a shape, and that breaks the table.
    if (isTableRow(line)) {
      if (!headerRowIndexes.has(i) && isInternalDiagnosticText(line)) {
        removedLines.push(line.trim());
        continue;
      }
      out.push(line);
      continue;
    }

    // Bullets and standalone lines.
    if (isInternalDiagnosticText(line) && line.trim().length > 0) {
      removedLines.push(line.trim());
      continue;
    }

    out.push(line);
  }

  return {
    markdown: out.join("\n").replace(/\n{3,}/g, "\n\n"),
    removedLines,
  };
}
