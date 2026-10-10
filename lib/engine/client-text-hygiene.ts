// Final-artifact text hygiene for client-facing prose.
//
// WHY THIS EXISTS
// ---------------
// A delivered technical proposal carried three machine-writing failures that
// no existing check saw, because each one is produced at a different layer:
//
//   1. "#### Site and Context Analysis" (ten of them). A producer wrote its
//      subsections at Markdown heading level 4; the DOCX renderer understood
//      only levels 1-3, so the reader saw the literal hashes. Fixed at the
//      renderer, which now handles all six levels.
//
//   2. "The methodology the following provides tailored to the following
//      identified service streams". A blind /\bbelow is\b/ rewrite, meant to
//      remove the AI tell "Below is a ...", also caught "below" used as an
//      ordinary adverb. Fixed by narrowing the rewrite to the shape its own
//      detector flags.
//
//   3. "All deliverables will undergo" — a sentence whose tail was removed
//      during an AI refinement pass (the dropped clause claimed an ISO 9001
//      certification the vault does not hold). There is no deterministic rule
//      to fix: the producer is a language model, and a model can truncate any
//      sentence at any time.
//
// The first two have producer-side fixes. The third can only be caught after
// the fact, which is what this module is for: it detects machine-writing
// failures in the text a client will actually read, and repairs the ones that
// can be repaired without inventing content.
//
// DESIGN RULE: never invent words. The repairer only REMOVES an unfinished
// fragment; it never completes one, because completing it would put a sentence
// in front of an evaluator that no source supports.
//
// This is sector-neutral by construction — it reads grammar, not vocabulary —
// so it applies equally to a road, water, geotechnical, planning, supervision
// or building proposal.

/** A line that still carries raw Markdown heading syntax. */
const RAW_MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/;

/** Raw emphasis markers that survived into rendered prose. */
const RAW_EMPHASIS = /\*\*[^*\n]+\*\*|__[^_\n]+__/;

/** Builder/template syntax that must never reach a reader. */
const TEMPLATE_SYNTAX = /\{\{[^}]*\}\}|<%[^%]*%>|\$\{[^}]*\}/;

/**
 * Finite-verb markers. A clause containing one of these is a sentence, so it
 * must end with sentence punctuation. A caption, a table cell, a bullet label
 * ("Site analysis report", "QA checklist", "Weeks 3-6 Architect") contains no
 * finite verb, which is what keeps this from firing on them.
 */
const FINITE_VERB =
  /\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|will|shall|would|should|may|might|must|can|could|includes?|provides?|ensures?|covers?)\b/i;

/**
 * Words that cannot end an English sentence. Ending on one is a truncation
 * regardless of punctuation, so this list catches "… coordinated with" even
 * when a full stop was appended after the cut.
 */
const DANGLING_TAIL =
  /\b(?:and|or|but|with|without|using|including|for|to|of|in|on|at|by|from|the|a|an|that|which|while|whereas|per|as|into|onto|upon|via|between|among|during|through|under|over|after|before|because|so|if|when|where|than|then|both|either|neither)\s*[.,;:]?\s*$/i;

/** Sentence-final punctuation, allowing a trailing quote or bracket. */
const TERMINATED = /[.!?:;][)"'”’\]]?\s*$/;

export interface ClientTextHygieneFinding {
  /** Machine-readable kind, stable enough to assert on in tests. */
  readonly kind:
    | "RAW_MARKDOWN_HEADING"
    | "RAW_EMPHASIS_MARKERS"
    | "TEMPLATE_SYNTAX"
    | "UNFINISHED_SENTENCE"
    | "DANGLING_CONNECTOR";
  /** 1-based line number within the text supplied. */
  readonly line: number;
  /** The offending line, trimmed and capped so a finding stays readable. */
  readonly excerpt: string;
}

function excerptOf(line: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

/**
 * A line is prose worth grammar-checking only when it is a real clause: long
 * enough to be a sentence, not a table row, not a bare list label.
 */
function isProseClause(line: string): boolean {
  const t = line.trim();
  if (t.length < 12) return false;
  if (t.startsWith("|")) return false;              // table row
  if (RAW_MARKDOWN_HEADING.test(t)) return false;   // reported separately
  if (/^[A-Za-z0-9.\s]{0,12}:\s*$/.test(t)) return false; // "Deliverables:" label
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  return FINITE_VERB.test(t);
}

/**
 * Line-shaped failures: syntax that is wrong on any surface, in any language.
 *
 * These three rules are the only ones safe to run against text extracted from
 * a finished PDF or DOCX. Extraction hard-wraps prose, so a single sentence
 * arrives as several lines and every grammar rule below would misread the wrap
 * as a truncation — measured on a real 36-page proposal, the grammar rules
 * produced 137 findings against 3 genuine defects. Syntax survives wrapping;
 * grammar does not.
 */
function findLineShapedFailures(lines: readonly string[]): ClientTextHygieneFinding[] {
  const findings: ClientTextHygieneFinding[] = [];
  lines.forEach((raw, index) => {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) return;
    const at = index + 1;
    if (RAW_MARKDOWN_HEADING.test(line)) {
      findings.push({ kind: "RAW_MARKDOWN_HEADING", line: at, excerpt: excerptOf(line) });
    } else if (TEMPLATE_SYNTAX.test(trimmed)) {
      findings.push({ kind: "TEMPLATE_SYNTAX", line: at, excerpt: excerptOf(line) });
    } else if (RAW_EMPHASIS.test(trimmed)) {
      findings.push({ kind: "RAW_EMPHASIS_MARKERS", line: at, excerpt: excerptOf(line) });
    }
  });
  return findings;
}

/**
 * The final byte-level gate. Runs against the visible text of the artifact the
 * client receives, so it must assume hard-wrapped prose and check only what
 * wrapping cannot fake.
 */
export function findRenderedArtifactHygieneFailures(text: string | null | undefined): ClientTextHygieneFinding[] {
  if (!text) return [];
  return findLineShapedFailures(text.replace(/\r/g, "").split("\n"));
}

/**
 * Producer-side check, for Markdown, where one paragraph is one line. Adds the
 * grammar rules that only hold on unwrapped prose: a clause carrying a finite
 * verb has to end like a sentence, and no sentence ends on a connector.
 */
export function findMarkdownProseHygieneFailures(markdown: string | null | undefined): ClientTextHygieneFinding[] {
  if (!markdown) return [];
  const lines = markdown.replace(/\r/g, "").split("\n");
  // Only TEMPLATE_SYNTAX from the line-shaped set: a "#" heading and a
  // "**bold**" run are CORRECT Markdown here and become a defect only if the
  // renderer fails to consume them, which is what the rendered-artifact gate
  // is for. Flagging them on this side would condemn every valid document.
  const findings: ClientTextHygieneFinding[] = [];
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed && TEMPLATE_SYNTAX.test(trimmed)) {
      findings.push({ kind: "TEMPLATE_SYNTAX", line: index + 1, excerpt: excerptOf(raw) });
    }
  });
  const reported = new Set(findings.map((f) => f.line));

  lines.forEach((raw, index) => {
    const at = index + 1;
    if (reported.has(at)) return;
    const trimmed = raw.trim();
    if (!trimmed || !isProseClause(trimmed)) return;
    // Strip a leading list marker so "- The report will be issued with" is
    // judged on its clause, not on its bullet.
    const clause = trimmed.replace(/^[-*\u2022]\s+/, "");
    if (DANGLING_TAIL.test(clause)) {
      findings.push({ kind: "DANGLING_CONNECTOR", line: at, excerpt: excerptOf(raw) });
    } else if (!TERMINATED.test(clause)) {
      findings.push({ kind: "UNFINISHED_SENTENCE", line: at, excerpt: excerptOf(raw) });
    }
  });

  return findings.sort((a, b) => a.line - b.line);
}

export interface ClientTextRepairResult {
  readonly text: string;
  readonly removedLines: number;
  readonly repairedHeadings: number;
}

/**
 * Producer-side repair, applied to Markdown before rendering.
 *
 * Unfinished sentences and dangling connectors are REMOVED, never completed.
 * Raw emphasis and template syntax are left alone here: the renderer converts
 * emphasis legitimately, and template syntax means a builder is broken, which
 * must reach the gate rather than be quietly tidied away.
 */
export function repairClientTextHygiene(markdown: string): ClientTextRepairResult {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  let removedLines = 0;
  let repairedHeadings = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (RAW_MARKDOWN_HEADING.test(raw)) {
      // A heading is legitimate Markdown at this stage; the renderer handles
      // every level. Counted so a caller can log that headings were present.
      repairedHeadings += 1;
      kept.push(raw);
      continue;
    }
    if (!trimmed || !isProseClause(trimmed)) {
      kept.push(raw);
      continue;
    }
    const clause = trimmed.replace(/^[-*•]\s+/, "");
    if (DANGLING_TAIL.test(clause) || !TERMINATED.test(clause)) {
      removedLines += 1;
      continue;
    }
    kept.push(raw);
  }

  return {
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n"),
    removedLines,
    repairedHeadings,
  };
}

// ─── List integrity after every removal pass ─────────────────────────────────
//
// Later passes remove sentences and list items (pricing, unsupported claims,
// placeholders) after a list was written, and never renumber what is left. A
// delivered proposal read "Five reasons grounded in reviewed evidence:" over
// items 2, 4 and 5, and "Key differentiators that make us well-placed to serve
// this assignment:" over nothing but the closing sentence (2026-10-05).

const ORDERED_ITEM = /^(\s*)(\d{1,2})\.\s+(\S.*)$/;
const HEADING = /^\s*#{1,6}\s/;
const FENCE = /^\s*```/;
const LIST_OR_TABLE = /^\s*(?:[-*•+]\s|\d{1,2}[.)]\s|\(?[a-z]\)\s|\||>)/i;
const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const COUNTED_LEAD = /^(\s*(?:\*\*)?)(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d{1,2})(\s+(?:key\s+)?(?:reasons|differentiators|points|commitments|advantages|strengths)\b.*:\s*(?:\*\*)?\s*)$/i;

export interface ListIntegrityResult {
  readonly text: string;
  readonly renumberedLists: number;
  readonly droppedLeadIns: number;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A finished prose sentence: what a dangling lead-in is left sitting on. */
function isProseSentence(line: string): boolean {
  const t = line.trim();
  if (!t || LIST_OR_TABLE.test(line) || HEADING.test(line) || /^(?:\*\*|__|["“'])/.test(t)) return false;
  return /^[A-Z]/.test(t) && /[.!?]["”)]?$/.test(t) && t.split(/\s+/).length >= 8;
}

/**
 * Renumber ordered lists whose items were removed, restate a counted lead-in
 * ("Five reasons …:") as the list's real length, and drop a lead-in sentence
 * left introducing nothing. Removes no list item and adds no claim.
 */
export function repairListIntegrity(markdown: string): ListIntegrityResult {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let renumberedLists = 0;
  let droppedLeadIns = 0;
  let inFence = false;
  // Last number of the previous top-level list in this section, so a list
  // deliberately continued after a paragraph ("1. … 2. … <para> 3. …") keeps
  // continuing instead of restarting at 1.
  let previousLast: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (HEADING.test(line)) { previousLast = null; continue; }
    const first = line.match(ORDERED_ITEM);
    if (!first) continue;

    const indent = first[1]!.length;
    const run: number[] = [];
    let j = i;
    while (j < lines.length) {
      const current = lines[j]!;
      const item = current.match(ORDERED_ITEM);
      if (item && item[1]!.length === indent) { run.push(j); j++; continue; }
      if (current.trim() && indentOf(current) > indent) { j++; continue; }
      if (!current.trim()) {
        let k = j + 1;
        while (k < lines.length && !lines[k]!.trim()) k++;
        const next = lines[k] ?? "";
        const nextItem = next.match(ORDERED_ITEM);
        if ((nextItem && nextItem[1]!.length === indent) || (next.trim() && indentOf(next) > indent)) { j = k; continue; }
      }
      break;
    }

    const numbers = run.map((index) => Number(lines[index]!.match(ORDERED_ITEM)![2]));
    const start: number = numbers[0] === 1
      ? 1
      : previousLast !== null && numbers[0]! > previousLast ? previousLast + 1 : 1;
    let changed = false;
    run.forEach((index, n) => {
      const m = lines[index]!.match(ORDERED_ITEM)!;
      if (numbers[n] !== start + n) {
        changed = true;
        lines[index] = `${m[1]}${start + n}. ${m[3]}`;
      }
    });
    if (changed) renumberedLists += 1;
    previousLast = start + run.length - 1;

    // A counted lead-in directly above a list states that list's length.
    if (start === 1) {
      let k = i - 1;
      while (k >= 0 && !lines[k]!.trim()) k--;
      const lead = k >= 0 ? lines[k]!.match(COUNTED_LEAD) : null;
      if (lead) {
        const word = /^\d+$/.test(lead[2]!) ? String(run.length) : (COUNT_WORDS[run.length] ?? String(run.length));
        const restated = `${lead[1]}${word}${lead[3]}`;
        if (restated !== lines[k]) lines[k] = restated;
      }
    }
    i = j - 1;
  }

  // A lead-in sentence ending in ":" left with nothing under it — the next
  // line is a heading, the end, or an unrelated finished sentence. Form-field
  // labels ("Name of authorised signatory:") are followed by other labels or
  // blanks, never a finished sentence, so they stay.
  const out: string[] = [];
  inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) inFence = !inFence;
    const trimmed = line.trim().replace(/(?:\*\*|__)$/, "").trim();
    const isLeadIn = !inFence
      && /:$/.test(trimmed)
      && !HEADING.test(line)
      && !LIST_OR_TABLE.test(line)
      && !/_{2,}|\[|\]/.test(trimmed)
      && trimmed.split(/\s+/).length >= 5;
    if (isLeadIn) {
      let k = i + 1;
      while (k < lines.length && !lines[k]!.trim()) k++;
      const next = lines[k];
      if (next === undefined || HEADING.test(next) || isProseSentence(next)) {
        droppedLeadIns += 1;
        continue;
      }
    }
    out.push(line);
  }
  return { text: out.join("\n"), renumberedLists, droppedLeadIns };
}
