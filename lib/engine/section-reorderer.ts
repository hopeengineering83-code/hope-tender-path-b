/**
 * Canonical-order section reorderer.
 *
 * The deterministic enrichers in benchmark-tables, narrative-throughline,
 * sector-vocabulary, portfolio-metrics, principal-qualifications,
 * risks-mitigations, why-us-summary, work-plan-timeline,
 * bid-compliance-mapping, and understanding-and-value-added each append
 * to the end of the markdown. Without reordering, an AI proposal that
 * already covers Cover Letter / ES / A / B / C / D would end up with
 * the appended sections (A.0, A.7, D.2, etc.) AFTER everything,
 * breaking canonical numeric/letter order.
 *
 * This module re-stitches the markdown into the canonical order
 * (cover/Why Us/A.x/B.x/C.x/D.x/E.x/Submission Control Sheet),
 * preserving all original content, headings, and tables. Sections that
 * don't match the canonical order list are kept in their original
 * position relative to neighbours of the same group.
 */

type Section = {
  startLine: number; // index in original lines array
  endLine: number; // exclusive
  level: number; // # = 1, ## = 2, ### = 3
  heading: string; // raw heading text (without #)
  content: string[]; // including the heading line
};

const TOP_LEVEL_ORDER: { match: RegExp; rank: number }[] = [
  { match: /^cover letter\b/i, rank: 100 },
  { match: /^technical proposal\b|^title page$/i, rank: 110 }, // Cover page
  { match: /^table of contents$/i, rank: 120 },
  { match: /^executive summary\b/i, rank: 130 },
  { match: /^why\s+\S+\s+for\b|^why us\b|^why\s+\S+$/i, rank: 140 },
  { match: /^section a\b|^a\.|^company profile$/i, rank: 200 },
  { match: /^section b\b|^b\.|^relevant experience$|^project portfolio$/i, rank: 300 },
  { match: /^section c\b|^c\.|^technical approach$|^methodology$/i, rank: 400 },
  { match: /^section d\b|^d\.|^additional information$|^value/i, rank: 500 },
  { match: /^section e\b|^e\.|^bid compliance|^compliance and bid review|^compliance matrix/i, rank: 600 },
  // Sections F/G/H are evaluator-facing tables introduced by PR #228.
  // They must always land BEFORE Appendices (rank 700) and AFTER the
  // Compliance Matrix (rank 600). Each gets its own rank slot so the
  // canonical sequence is E → F → G → H → Appendices regardless of
  // whether they were produced by the AI, by the deterministic
  // backstops (PR #231), or appended by some downstream enricher.
  { match: /^section f\b|^f\.|^evaluation\s+criteria\s+response\s+mirror|^evaluation\s+(?:criteria\s+)?response|^evaluator(?:'s)?\s+mirror|^evaluation\s+mirror/i, rank: 650 },
  { match: /^section g\b|^g\.|^win\s+themes?|^themes?\s+(?:and|&)\s+discriminators?/i, rank: 660 },
  { match: /^section h\b|^h\.|^(?:proposal\s+)?self.score/i, rank: 670 },
  { match: /^appendi[cx]/i, rank: 700 },
  { match: /^declaration\b|^declaration of/i, rank: 800 }, // covered by D.4 within section D
  { match: /^submission control sheet|^submission/i, rank: 900 },
];

// Sub-rank within each section — alphanumerical sub-ID heading prefixes (A.0, A.4, A.4.1, B.2.0, etc.)
function extractSubId(heading: string): number {
  // Parent-section heading like "SECTION E: COMPLIANCE MATRIX" or
  // "F. Evaluation Mirror" must sort BEFORE its sub-IDs (e.g., "E.1 Bid
  // Compliance Mapping" with sub-ID 100). Returning 0 places the
  // un-numbered parent section at the start of its group.
  if (/^section\s+[A-H]\b/i.test(heading)) return 0;
  if (/^[A-H]\.\s*[A-Z][a-z]/.test(heading)) return 0;
  // e.g. "A.4.1 Principal Qualifications" → 410
  // e.g. "A.4 Proposed Team" → 400
  // e.g. "B.2 Project Portfolio" → 200
  const match = heading.match(/^([A-H])\.(\d+)(?:\.(\d+))?/i);
  if (!match) return 9999;
  const major = parseInt(match[2], 10);
  const minor = match[3] ? parseInt(match[3], 10) : 0;
  return major * 100 + minor;
}

function topLevelRank(heading: string): number {
  for (const entry of TOP_LEVEL_ORDER) {
    if (entry.match.test(heading)) return entry.rank;
  }
  return 999_999; // unknown — preserved at original position
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  lines.forEach((line, idx) => {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (current) {
        current.endLine = idx;
        sections.push(current);
      }
      current = {
        startLine: idx,
        endLine: lines.length, // updated on next heading or at end
        level: headingMatch[1].length,
        heading: headingMatch[2].replace(/\s+/g, " ").trim(),
        content: [line],
      };
    } else if (current) {
      current.content.push(line);
    }
  });
  if (current) sections.push(current);

  return sections;
}

/**
 * Reorder top-level (## or #) sections into canonical order. Subsections
 * (### nested inside a top-level) are kept attached to their parent.
 */
export function reorderToCanonicalSequence(markdown: string): string {
  const sections = parseSections(markdown);
  if (sections.length === 0) return markdown;

  // Group sections by top-level boundaries. A new "top group" starts at every
  // # or ## section that has a recognised top-level rank.
  type TopGroup = { rank: number; subRank: number; originalIndex: number; sections: Section[] };
  const groups: TopGroup[] = [];
  let currentGroup: TopGroup | null = null;

  sections.forEach((section, idx) => {
    const isTop = section.level <= 2;
    const rank = topLevelRank(section.heading);
    const subRank = extractSubId(section.heading);

    if (isTop) {
      currentGroup = { rank, subRank, originalIndex: idx, sections: [section] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.sections.push(section);
    } else {
      // Subsection without a parent (rare). Treat as its own group.
      currentGroup = { rank: 999_999, subRank: 9999, originalIndex: idx, sections: [section] };
      groups.push(currentGroup);
    }
  });

  // Sort: by rank, then by subRank, then by original index (stable).
  // Unknown groups (rank 999_999) keep their relative order via originalIndex.
  groups.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.subRank !== b.subRank) return a.subRank - b.subRank;
    return a.originalIndex - b.originalIndex;
  });

  // Re-emit lines.
  const out: string[] = [];
  for (const group of groups) {
    for (const section of group.sections) {
      out.push(...section.content);
      // Ensure trailing blank line between sections.
      if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    }
  }

  return out.join("\n").replace(/\n{4,}/g, "\n\n\n");
}
