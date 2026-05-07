/**
 * Section Orderer + Auto-TOC (PR Y).
 *
 * THE PROBLEM
 * The user's real output showed sections appearing in chaotic order —
 * "Why HOPE… for Pharo Ventures" appeared near the end of the document
 * while "Section H Self-Score" came BEFORE the Appendix Register.
 * Multiple deterministic post-passes append content to the markdown
 * in the order they run, not in the order an evaluator wants to read.
 *
 * Plus the proposal has no actual TOC — the AI generates a TOC at the
 * top but it doesn't reflect the actual final headings (which are
 * mutated by 14 deterministic post-passes after the AI runs).
 *
 * THE FIX
 * Two passes that run together as the LAST coordinating step before
 * placeholder-stripper:
 *
 *   1. Section orderer:
 *      Walk all level-1 headings (`# X`) and reorder them according
 *      to the canonical proposal flow:
 *        Cover Letter → Executive Summary → Section A → Section B
 *        → Section C → Section D → Section E → Section F → Section G
 *        → Section H → Appendix Register → Declaration → Submission
 *        Readiness Checklist
 *      Sections not matching any canonical heading keep their relative
 *      order at the end (insertion-order preserved). Each level-1
 *      block carries its level-2 sub-sections with it as a unit.
 *
 *   2. Auto-TOC:
 *      Scan all level-1 and level-2 headings AFTER reordering and emit
 *      a fresh `# Table of Contents` at the very top. Replaces any
 *      existing TOC the AI emitted. Indented with 2 spaces per level.
 *
 * NEVER FABRICATES — only reorders and re-derives the TOC. Doesn't
 * delete content or change any heading text.
 */

interface Section {
  level: number;
  heading: string;
  body: string[];
  startLine: number;
}

const CANONICAL_ORDER: RegExp[] = [
  /^#\s+Cover\s+Letter\b/i,
  /^#\s+Executive\s+Summary\b/i,
  /^#\s+Section\s+A\b/i,
  /^#\s+Section\s+B\b/i,
  /^#\s+Section\s+C\b/i,
  /^#\s+Section\s+D\b/i,
  /^#\s+Section\s+E\b/i,
  /^#\s+Section\s+F\b/i,
  /^#\s+Section\s+G\b/i,
  /^#\s+Section\s+H\b/i,
  /^#\s+Appendix\s+Register\b/i,
  /^#\s+Declaration\b/i,
  /^#\s+Submission\s+Readiness\s+Checklist\b/i,
];

function findCanonicalIndex(heading: string): number {
  for (let i = 0; i < CANONICAL_ORDER.length; i += 1) {
    if (CANONICAL_ORDER[i].test(heading)) return i;
  }
  return -1;
}

// Parse a markdown document into level-1 sections (each carries any
// level-2/3 subsections + body).
function parseSections(markdown: string): { preamble: string[]; sections: Section[] } {
  const lines = markdown.split("\n");
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^(#+)\s+(.*)$/);
    if (m && m[1].length === 1) {
      if (current) sections.push(current);
      current = { level: 1, heading: line, body: [], startLine: i };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

function reorder(sections: Section[]): Section[] {
  const canonical: Array<{ section: Section; canonicalIdx: number; insertOrder: number }> = [];
  const others: Array<{ section: Section; insertOrder: number }> = [];

  sections.forEach((s, i) => {
    const idx = findCanonicalIndex(s.heading);
    if (idx >= 0) canonical.push({ section: s, canonicalIdx: idx, insertOrder: i });
    else others.push({ section: s, insertOrder: i });
  });

  canonical.sort((a, b) => {
    if (a.canonicalIdx !== b.canonicalIdx) return a.canonicalIdx - b.canonicalIdx;
    return a.insertOrder - b.insertOrder;
  });

  // Canonical first (in canonical order), then others (in insert order).
  return [...canonical.map((c) => c.section), ...others.sort((a, b) => a.insertOrder - b.insertOrder).map((o) => o.section)];
}

function buildTOC(sections: Section[]): string {
  const tocLines: string[] = ["# Table of Contents", ""];
  for (const s of sections) {
    // Level-1 entry
    const heading = s.heading.replace(/^#+\s*/, "").trim();
    if (!heading) continue;
    if (/^Table of Contents/i.test(heading)) continue;
    tocLines.push(heading);
    // Pull level-2 sub-headings from body
    for (const line of s.body) {
      const m = line.match(/^##\s+(.*)$/);
      if (m) tocLines.push(`  ${m[1].trim()}`);
    }
  }
  tocLines.push("");
  return tocLines.join("\n");
}

export interface OrdererTocResult {
  markdown: string;
  reorderedSectionCount: number;
  tocEntries: number;
}

export function reorderSectionsAndRebuildToc(markdown: string): OrdererTocResult {
  const { preamble, sections } = parseSections(markdown);

  // Drop existing TOC sections (AI-emitted) — we'll rebuild
  const cleaned = sections.filter((s) => !/^#\s+Table\s+of\s+Contents\b/i.test(s.heading));
  const tocCount = sections.length - cleaned.length;

  // Reorder
  const reordered = reorder(cleaned);

  // Detect if reordering actually changed anything
  let reorderedSectionCount = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== reordered[i]) reorderedSectionCount += 1;
  }

  // Build new TOC
  const toc = buildTOC(reordered);

  // Reassemble: preamble (without empty-trailing) + TOC + sections
  const trimmedPreamble = preamble.join("\n").replace(/\s+$/, "");
  const sectionMarkdown = reordered
    .map((s) => `${s.heading}\n${s.body.join("\n").replace(/\s+$/, "")}`)
    .join("\n\n");

  const finalMarkdown = [trimmedPreamble, toc, sectionMarkdown]
    .filter((s) => s.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");

  return {
    markdown: finalMarkdown,
    reorderedSectionCount: reorderedSectionCount + tocCount,
    tocEntries: toc.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length,
  };
}
