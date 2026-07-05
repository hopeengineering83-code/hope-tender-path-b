/**
 * Duplicate Section Suppressor (PR Q).
 *
 * THE PROBLEM
 * The benchmark gap analysis on a real app output revealed the
 * Table of Contents contained DUPLICATE numbered sub-sections:
 *
 *   B.1 Portfolio Overview
 *   B.1 Client References          ← duplicate B.1!
 *   B.2 Featured Project 1
 *   B.2 Project Portfolio          ← duplicate B.2!
 *   B.2.0 Portfolio Reading Guide
 *   ...
 *   C.3 Work Plan and Deliverables
 *   C.3 Quality Assurance: ...     ← duplicate C.3!
 *   C.4 Quality Assurance
 *   C.4 Sector-Specific ...        ← duplicate C.4!
 *   D.1 Value to the Client
 *   D.1 Value Framework — ...      ← duplicate D.1!
 *   D.2 In-House Capabilities ...
 *   D.2 Value-Added Services       ← duplicate D.2!
 *
 * Cause: multiple deterministic post-passes (benchmark-tables,
 * proposal-strengthening-sections, methodology-tables, beyond-spec-tables,
 * AI output) all emit their own "B.1", "C.3", "D.1" headings. Without a
 * coordinated post-pass to detect and suppress, the final markdown
 * carries multiple sections sharing the same numbered code.
 *
 * Evaluators see this and immediately mark the proposal as low-quality
 * — duplicate numbering looks like a rendering bug.
 *
 * THE FIX
 * Final-pass scanner that:
 *
 *   1. Walks every level-2 heading (^## X.Y Title$)
 *   2. Groups by the numeric prefix (X.Y)
 *   3. When two headings share the same prefix, keeps the FIRST
 *      and renumbers the others. Renumber rule: append a, b, c
 *      suffix (so "B.1 Client References" becomes "B.1a Client
 *      References" if "B.1 Portfolio Overview" came first).
 *   4. NEVER deletes content — duplicate-prefix sections are
 *      renumbered, never dropped, because the content is real.
 *
 * Idempotent: running twice produces the same output.
 *
 * SCOPE
 * Runs LATE in the post-pass chain — after all heading-emitting
 * builders (PRs E-N) have run, before the placeholder stripper
 * (PR J final pass).
 */

interface HeadingMatch {
  lineIndex: number;
  prefix: string;     // e.g., "B.1", "C.3", "D.1"
  fullHeading: string;
  level: number;      // 1 for #, 2 for ##, etc.
  rest: string;       // text after the numeric prefix
}

const HEADING_RE = /^(#{1,3})\s+([A-H])(\.\d+(?:\.\d+)?)\s+(.+?)\s*$/;

function parseHeading(line: string, lineIndex: number): HeadingMatch | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  return {
    lineIndex,
    level: m[1].length,
    prefix: `${m[2]}${m[3]}`,
    fullHeading: line,
    rest: m[4],
  };
}

export interface DedupeResult {
  markdown: string;
  renumbered: number;
}

export function suppressDuplicateSectionHeadings(markdown: string): DedupeResult {
  const lines = markdown.split("\n");
  const headings: HeadingMatch[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const h = parseHeading(lines[i], i);
    if (h && h.level === 2) headings.push(h);
  }

  if (headings.length === 0) return { markdown, renumbered: 0 };

  // Group by prefix
  const groups = new Map<string, HeadingMatch[]>();
  for (const h of headings) {
    if (!groups.has(h.prefix)) groups.set(h.prefix, []);
    groups.get(h.prefix)!.push(h);
  }

  let renumbered = 0;
  // For any prefix with > 1 occurrence, renumber the 2nd, 3rd, ... with
  // a, b, c suffixes. Keeps original line count + content.
  for (const [, instances] of groups) {
    if (instances.length <= 1) continue;
    const suffixes = ["a", "b", "c", "d", "e", "f", "g"];
    for (let i = 1; i < instances.length; i += 1) {
      const inst = instances[i];
      const suffix = suffixes[(i - 1) % suffixes.length];
      const newPrefix = `${inst.prefix}${suffix}`;
      const newHeading = `## ${newPrefix} ${inst.rest}`;
      lines[inst.lineIndex] = newHeading;
      renumbered += 1;
    }
  }

  return { markdown: lines.join("\n"), renumbered };
}
