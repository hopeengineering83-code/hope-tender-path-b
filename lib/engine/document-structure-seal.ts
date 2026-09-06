/**
 * The last word on the delivered document's heading structure.
 *
 * THE DELIVERED DEFECTS
 * ---------------------
 * Hosted run 34035620990 regenerated the Pharo Technical Proposal on a head
 * that already carried the Section C authority. The authority did its job —
 * it logged "20 sub-section(s) as C.1 … C.20" — and the delivered PDF still
 * shipped a contents page reading:
 *
 *     C.1 … C.6, C.8, C.9, … C.20            (C.7 absent)
 *     D.1, D.2, D.3, D.5                     (D.4 absent)
 *     A.4, A.4a, A.4.1, A.5                  (a letter suffix as a number)
 *
 * and four headings that promised content the reader never got: C.13 Relevant
 * project experience, C.14 Team qualifications, C.15 Company capacity and
 * D.3 Professional Certifications, each immediately followed by the next
 * heading.
 *
 * The numbering was right when it was derived and wrong when it was rendered,
 * because a dozen sanitising passes run between the two — placeholder
 * stripping, table de-duplication, internal-review sweeps, price separation,
 * quality-repair addenda — and any of them may delete a heading or empty a
 * body. Numbering derived before those passes describes a document that no
 * longer exists by the time it is rendered.
 *
 * THE RULE
 * --------
 * Numbering is derived from the sub-sections that survive, once, immediately
 * before the render. Nothing downstream of this seal may add or remove a
 * heading. A heading with nothing under it is not a section and is dropped
 * rather than renumbered, so a stripped body cannot leave the contents page
 * advertising an empty promise.
 *
 * This seal does not decide what Section C contains or in what order — that
 * stays with section-c-authority.ts, which it calls. It decides only that the
 * numbers on the page describe the page.
 */

import { normalizeSectionC } from "./section-c-authority";

/** "# Section C: Technical Approach" / "# SECTION C: TECHNICAL APPROACH". */
const TOP_LEVEL_SECTION_RX = /^#\s+Section\s+([A-Z])\b/i;
const ANY_TOP_LEVEL_RX = /^#\s+\S/;
const SUB_HEADING_RX = /^(#{2,6})\s+(.*)$/;

/**
 * A sub-heading that opens with its own number: "C.7 Risk Register",
 * "A.4a Proposed Project Team", "B.2.0 Portfolio Reading Guide". The letter
 * suffix is captured so it can be dropped — a suffix is what a producer
 * appends when two of them claim the same number, and it is never a number
 * the reader should see.
 */
const NUMBERED_PREFIX_RX = /^([A-Z])\.(\d+)([a-z]?)(?:\.(\d+))?\s*[:.\-–—]?\s+(.*)$/;

interface HeadingNode {
  /** Index into the working line array. */
  lineIndex: number;
  level: number;
  text: string;
  /** Letter of the top-level section this heading sits under, if any. */
  sectionLetter: string | null;
  /** Non-blank body lines belonging to this heading alone (excludes descendants). */
  ownContentLines: number;
  /** Indexes of the direct descendants, in document order. */
  descendants: number[];
}

export interface StructureSealResult {
  markdown: string;
  /** Headings dropped because nothing was left under them. */
  droppedEmpty: string[];
  /** Sub-headings whose number changed. */
  renumbered: number;
  /** The Section C sub-headings the reader will actually see. */
  sectionCHeadings: string[];
  /** Cross-references repointed at the number their named section really has. */
  resolvedCrossReferences: number;
}

/** The `##`-level headings inside Section C, exactly as a reader would read them. */
export function sectionCHeadingsOf(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#\s+Section\s+C\b/i.test(line));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_TOP_LEVEL_RX.test(lines[i])) break;
    const match = lines[i].match(/^##\s+(.*)$/);
    if (match) out.push(match[1].trim());
  }
  return out;
}

/** Build the heading tree for one pass over the document. */
function readHeadings(lines: string[]): HeadingNode[] {
  const nodes: HeadingNode[] = [];
  let sectionLetter: string | null = null;
  const stack: number[] = [];

  lines.forEach((line, lineIndex) => {
    const top = line.match(TOP_LEVEL_SECTION_RX);
    if (ANY_TOP_LEVEL_RX.test(line)) {
      sectionLetter = top ? top[1].toUpperCase() : null;
      stack.length = 0;
      return;
    }
    const sub = line.match(SUB_HEADING_RX);
    if (!sub) {
      if (line.trim() && stack.length > 0) nodes[stack[stack.length - 1]].ownContentLines += 1;
      return;
    }
    const level = sub[1].length;
    while (stack.length > 0 && nodes[stack[stack.length - 1]].level >= level) stack.pop();
    const index = nodes.length;
    if (stack.length > 0) nodes[stack[stack.length - 1]].descendants.push(index);
    nodes.push({
      lineIndex,
      level,
      text: sub[2].trim(),
      sectionLetter,
      ownContentLines: 0,
      descendants: [],
    });
    stack.push(index);
  });

  return nodes;
}

/** A heading carries nothing if neither it nor anything beneath it has content. */
function carriesContent(nodes: HeadingNode[], index: number): boolean {
  if (nodes[index].ownContentLines > 0) return true;
  return nodes[index].descendants.some((child) => carriesContent(nodes, child));
}

/**
 * Seal the document's heading structure.
 *
 * Runs once, immediately before the render, after every pass that can add or
 * remove a heading.
 */
export function sealDocumentStructure(markdown: string): StructureSealResult {
  // Section C order and identity first — the seal derives numbers over
  // whatever it is handed, so the canonical order has to be in place already.
  const sectionC = normalizeSectionC(markdown);
  let lines = sectionC.markdown.split("\n");

  // ── 1. Drop headings that no longer carry anything ──────────────────────
  const nodes = readHeadings(lines);
  const droppedEmpty: string[] = [];
  const dropLines = new Set<number>();
  nodes.forEach((node, index) => {
    if (carriesContent(nodes, index)) return;
    droppedEmpty.push(node.text);
    dropLines.add(node.lineIndex);
  });
  if (dropLines.size > 0) {
    lines = lines.filter((_, index) => !dropLines.has(index));
  }

  // ── 2. Derive the numbering over what survived ──────────────────────────
  //
  // Parent counters restart per top-level section and begin at the first
  // number that section actually used, so a deliberate "A.0 Portfolio at a
  // Glance" stays zero-based while a conventional section stays one-based.
  let renumbered = 0;
  let letter: string | null = null;
  let parentSeq = 0;
  let parentStart: number | null = null;
  let parentNumber: number | null = null;
  let childSeq = 0;
  let childStart: number | null = null;
  const titleToNumber = new Map<string, string>();

  lines = lines.map((line) => {
    const top = line.match(TOP_LEVEL_SECTION_RX);
    if (ANY_TOP_LEVEL_RX.test(line)) {
      letter = top ? top[1].toUpperCase() : null;
      parentSeq = 0;
      parentStart = null;
      parentNumber = null;
      childSeq = 0;
      childStart = null;
      return line;
    }
    const sub = line.match(SUB_HEADING_RX);
    if (!sub || !letter) return line;

    const numbered = sub[2].trim().match(NUMBERED_PREFIX_RX);
    // An unnumbered heading ("Submission Checklist") keeps its place without
    // consuming a number — inventing one for it would assert a structure the
    // producer never claimed.
    if (!numbered || numbered[1].toUpperCase() !== letter) return line;

    const [, , rawParent, , rawChild, title] = numbered;
    let derived: string;
    if (rawChild === undefined) {
      if (parentStart === null) parentStart = Number(rawParent);
      parentNumber = parentStart + parentSeq;
      parentSeq += 1;
      childSeq = 0;
      childStart = null;
      derived = `${letter}.${parentNumber}`;
    } else {
      if (parentNumber === null) {
        // A child heading with no parent above it: keep the parent it names.
        parentNumber = Number(rawParent);
      }
      if (childStart === null) childStart = Number(rawChild);
      derived = `${letter}.${parentNumber}.${childStart + childSeq}`;
      childSeq += 1;
    }

    const rebuilt = `${sub[1]} ${derived} ${title}`.trimEnd();
    if (rebuilt !== line.trimEnd()) renumbered += 1;
    titleToNumber.set(normalizeTitle(title), derived);
    return rebuilt;
  });

  // ── 3. Point cross-references at the number their named section really has ──
  let resolvedCrossReferences = 0;
  const sealed = lines.join("\n").replace(
    /\bSection\s+([A-Z])\.(\d+(?:\.\d+)?)\s*\(([^)\n]{3,80})\)/g,
    (whole, refLetter: string, refNumber: string, refTitle: string) => {
      const actual = titleToNumber.get(normalizeTitle(refTitle));
      if (!actual || actual === `${refLetter}.${refNumber}`) return whole;
      resolvedCrossReferences += 1;
      return `Section ${actual} (${refTitle})`;
    },
  );

  return {
    markdown: sealed,
    droppedEmpty,
    renumbered,
    sectionCHeadings: sectionCHeadingsOf(sealed),
    resolvedCrossReferences,
  };
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
