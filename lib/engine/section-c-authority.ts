/**
 * The single authority for Section C sub-section identity, title and order.
 *
 * THE DEFECT THIS EXISTS TO CLOSE
 * -------------------------------
 * Eight independent producers each assigned their own `C.x` numbers, and the
 * numbers collided semantically. A delivered Technical Proposal's table of
 * contents read:
 *
 *     C.0, C.1, C.3, C.4, C.6, C.2, C.5a, C.6a, C.7
 *
 * "Work Plan" was C.3 in proposal-sections.ts and section-c-depth-amplifier.ts
 * but C.6 in generate-elite.ts. "Quality Assurance" was C.4 in those first two
 * and C.3 in benchmark-tables.ts. sector-vocabulary-enricher.ts also claimed
 * C.4. Where two producers landed on the same number,
 * duplicate-section-suppressor.ts disambiguated them with a letter suffix,
 * which is where C.5a and C.6a came from.
 *
 * Sorting those headings would NOT have fixed it: a sorted list of colliding
 * numbers is a tidier document that is still wrong, because the same number
 * still means two different things.
 *
 * HOW THIS WORKS
 * --------------
 * Each sub-section has a stable semantic identity. The identity owns the
 * client-facing title and the canonical reading order. Numbers are *derived* —
 * assigned sequentially over the sub-sections actually present, so an optional
 * sub-section that is absent leaves no gap and an optional one that is present
 * cannot push another sub-section onto a number that already means something
 * else.
 *
 * Producers keep emitting whatever heading they emit. `normalizeSectionC()`
 * runs once, after every producer and suppressor, and rewrites Section C into
 * canonical identity order with derived numbering. Because the table of
 * contents in section-orderer-and-toc.ts is built by reading the body's `##`
 * headings, normalising the body before that rebuild makes the contents page
 * and the body agree by construction rather than by coincidence.
 *
 * The canonical set is the one the document architecture already produces. No
 * sub-section is invented here, and tender-driven criterion responses stay
 * possible: anything this module does not recognise keeps its relative order
 * after the recognised sub-sections and is numbered in the same sequence.
 */

export type SectionCIdentity =
  | "TENDER_SPECIFICS"
  | "UNDERSTANDING"
  | "METHODOLOGY"
  | "WORK_PLAN"
  | "QUALITY_ASSURANCE"
  | "SECTOR_STANDARDS"
  | "RISK";

interface SectionCSpec {
  identity: SectionCIdentity;
  /** The one client-facing title, without a number. */
  title: string;
  /** Recognises this sub-section however a producer happened to word it. */
  match: RegExp;
}

/**
 * Canonical reading order. Each entry is a sub-section this codebase actually
 * produces today; the `match` patterns cover every wording those producers use.
 */
const CANONICAL_SECTION_C: readonly SectionCSpec[] = [
  {
    identity: "TENDER_SPECIFICS",
    title: "Tender Specifics Recognised by This Proposal",
    match: /tender\s+specifics?\s+recognised|tender\s+specifics?\s+recognized|tender[-\s]specific\s+recognition/i,
  },
  {
    identity: "UNDERSTANDING",
    title: "Understanding of the Assignment",
    match: /understanding\s+of\s+(?:the\s+)?assignment|assignment\s+understanding/i,
  },
  {
    identity: "METHODOLOGY",
    title: "Technical Methodology",
    match: /technical\s+methodology|^methodology\b|methodology\s+and\s+approach/i,
  },
  {
    identity: "WORK_PLAN",
    title: "Work Plan and Deliverables",
    match: /work\s+plan/i,
  },
  {
    identity: "QUALITY_ASSURANCE",
    title: "Quality Assurance",
    match: /quality\s+assurance|three[-\s]stage\s+(?:design\s+)?review/i,
  },
  {
    identity: "SECTOR_STANDARDS",
    title: "Sector-Specific Technical Standards Applied",
    match: /sector[-\s]specific\s+technical\s+standards|technical\s+standards\s+applied/i,
  },
  {
    identity: "RISK",
    title: "Risk Register and Mitigation Strategy",
    match: /risk\s+register|risks?\s+and\s+mitigations?|mitigation\s+strategy/i,
  },
] as const;

/** The canonical client-facing title for a Section C sub-section. */
export function sectionCTitle(identity: SectionCIdentity): string {
  const spec = CANONICAL_SECTION_C.find((entry) => entry.identity === identity);
  if (!spec) throw new Error(`Unknown Section C identity: ${identity}`);
  return spec.title;
}

/**
 * Which canonical sub-section a heading belongs to, or null when it is a
 * tender-driven criterion response or anything else this module does not own.
 */
export function identifySectionCHeading(headingText: string): SectionCIdentity | null {
  // Strip any leading "C.3", "C.5a", "C.2.1" style number the producer applied,
  // so identification is by meaning rather than by the number under dispute.
  const bare = headingText.replace(/^\s*C\.\d+[a-z]?(?:\.\d+)?\s*[:.\-–—]?\s*/i, "").trim();
  if (!bare) return null;
  for (const spec of CANONICAL_SECTION_C) {
    if (spec.match.test(bare)) return spec.identity;
  }
  return null;
}

const SECTION_C_HEADING_RX = /^#\s+Section\s+C\b/i;
const ANY_LEVEL_1_RX = /^#\s+\S/;

interface SubBlock {
  identity: SectionCIdentity | null;
  /** Canonical order index; unrecognised blocks sort after all recognised ones. */
  order: number;
  originalIndex: number;
  headingLine: string;
  /** Heading text with any producer-assigned number removed. */
  bareTitle: string;
  body: string[];
}

export interface SectionCNormalizationResult {
  markdown: string;
  /** Ordered canonical numbers actually emitted, e.g. ["C.1", "C.2", …]. */
  numbers: string[];
  /** Ordered titles actually emitted, parallel to `numbers`. */
  titles: string[];
  reordered: boolean;
  renumbered: number;
}

/**
 * Rewrite Section C into canonical identity order with derived numbering.
 *
 * Runs after every producer and after duplicate suppression, so it sees the
 * final set of sub-sections. Only `##` headings inside the Section C block are
 * touched; `###` sub-sub-headings (the C.2.x methodology steps) are carried
 * with their parent untouched, and nothing outside Section C is read or moved.
 */
export function normalizeSectionC(markdown: string): SectionCNormalizationResult {
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex((line) => SECTION_C_HEADING_RX.test(line));
  if (startIdx === -1) {
    return { markdown, numbers: [], titles: [], reordered: false, renumbered: 0 };
  }

  // Section C ends at the next level-1 heading.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (ANY_LEVEL_1_RX.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  // Split the block into a preamble (anything before the first ## heading) and
  // one SubBlock per ## heading.
  const preamble: string[] = [];
  const blocks: SubBlock[] = [];
  let current: SubBlock | null = null;

  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const line = lines[i];
    const headingMatch = line.match(/^##\s+(.*)$/);
    if (headingMatch) {
      const rawTitle = headingMatch[1].trim();
      const identity = identifySectionCHeading(rawTitle);
      const bareTitle = identity
        ? sectionCTitle(identity)
        : rawTitle.replace(/^\s*[A-Z]\.\d+[a-z]?(?:\.\d+)?\s*[:.\-–—]?\s*/i, "").trim();
      const order = identity
        ? CANONICAL_SECTION_C.findIndex((entry) => entry.identity === identity)
        : Number.MAX_SAFE_INTEGER;
      current = {
        identity,
        order,
        originalIndex: blocks.length,
        headingLine: line,
        bareTitle,
        body: [],
      };
      blocks.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (blocks.length === 0) {
    return { markdown, numbers: [], titles: [], reordered: false, renumbered: 0 };
  }

  // Two producers can both emit the same canonical sub-section (for example
  // "C.3 Quality Assurance: Three-Stage Review" and "C.4 Quality Assurance").
  // Keep the first and fold the second's body into it rather than emitting the
  // same client-facing title twice under two different numbers.
  const merged: SubBlock[] = [];
  const seen = new Map<SectionCIdentity, SubBlock>();
  for (const block of blocks) {
    if (block.identity && seen.has(block.identity)) {
      const target = seen.get(block.identity)!;
      const addition = block.body.join("\n").trim();
      if (addition) target.body.push("", addition);
      continue;
    }
    if (block.identity) seen.set(block.identity, block);
    merged.push(block);
  }

  const ordered = [...merged].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.originalIndex - b.originalIndex;
  });

  const reordered = ordered.some((block, idx) => block.originalIndex !== merged[idx]?.originalIndex);

  const numbers: string[] = [];
  const titles: string[] = [];
  let renumbered = 0;
  const rebuilt: string[] = [];

  ordered.forEach((block, idx) => {
    const number = `C.${idx + 1}`;
    const heading = `## ${number} ${block.bareTitle}`;
    if (heading !== block.headingLine) renumbered += 1;
    numbers.push(number);
    titles.push(block.bareTitle);
    rebuilt.push(heading, ...block.body);
    if (rebuilt[rebuilt.length - 1]?.trim() !== "") rebuilt.push("");
  });

  const out = [
    ...lines.slice(0, startIdx + 1),
    ...preamble,
    ...rebuilt,
    ...lines.slice(endIdx),
  ];

  return {
    markdown: out.join("\n").replace(/\n{4,}/g, "\n\n\n"),
    numbers,
    titles,
    reordered,
    renumbered,
  };
}
