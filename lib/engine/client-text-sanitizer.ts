// Centralised exportable-text sanitiser (Gap 8).
//
// Strips AI provider names, internal tooling references, and other traces
// that must never appear in client-facing proposal text.
//
// The `preserveTenderQuotes` option (default false) prevents the replacer
// from touching text inside double-quoted spans — tender clauses are often
// reproduced verbatim and may legitimately contain these words.

type SanitizeOptions = {
  preserveTenderQuotes?: boolean;
};

/**
 * Combined patterns for performance.
 * We use two main regexes to reduce the number of .replace() calls.
 */

const PROVIDER_STRINGS = [
  "Anthropic",
  "Claude\\s+(AI|Opus|Sonnet|Haiku|claude-[\\w.-]+)?",
  "Claude",
  "OpenAI",
  "ChatGPT",
  "GPT-[34][\\w.-]*",
  "Gemini\\s*(Pro|Ultra|Flash|[\\d.]+)?",
  "Gemini",
  "Google\\s+AI",
  "co-?pilot",
  "LLM",
  "large\\s+language\\s+model"
];

const AI_PHRASING_STRINGS = [
  "as\\s+an\\s+ai",
  "i\\s+am\\s+an\\s+ai",
  "language\\s+model",
  "generated\\s+by",
  "deterministic\\s+fallback",
  "submission\\s+note:",
  "prompt:",
  "certainly[,!]?\\s",
  "of\\s+course[,!]?\\s",
  "absolutely[,!]?\\s",
  "placeholder",
  "sample\\s+text",
  "example\\s+text",
  "\\[TBD\\]",
  "\\[NAME\\]",
  "\\[DATE\\]"
];

const INTERNAL_STRINGS = [
  "INTERNAL[\\s:]+[^\\n]*",
  "INTERNAL_REVIEW_ONLY",
  "\\[INTERNAL[^\\]]*\\]",
  "DO\\s+NOT\\s+EXPORT"
];

// Helper to build a regex that respects word boundaries only where appropriate.
function buildCombinedRegex(patterns: string[], flags: string): RegExp {
  const union = patterns.map(p => {
    // If it starts/ends with a word character, wrap in \b.
    // This is a simplification but works for our current set.
    const start = /^\w/.test(p) ? "\\b" : "";
    const end = /\w$/.test(p) ? "\\b" : "";
    return `${start}${p}${end}`;
  }).join("|");
  return new RegExp(`(${union})`, flags);
}

const CASE_INSENSITIVE_SCRUB = buildCombinedRegex([...PROVIDER_STRINGS, ...AI_PHRASING_STRINGS, ...INTERNAL_STRINGS], "gi");

const CASE_SENSITIVE_STRINGS = [
  "TODO",
  "FIXME",
  "PLACEHOLDER",
  "TBD",
  "XXX",
  "\\{.*?\\}"
];

const CASE_SENSITIVE_SCRUB = buildCombinedRegex(CASE_SENSITIVE_STRINGS, "g");

const LEGACY_AI_PATTERNS = [
  /^\s*note to (writer|editor|reviewer):.*$/gim,
  /^\s*\[.*?\]\s*$/gim,
];

// Em-dash normalization (was previously inlined in humanize.ts).
function normalizeEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, " \u2014 ");
}

/**
 * Separators a PDF font cannot map back, normalised to the ASCII character the
 * writer meant.
 *
 * THE DELIVERED DEFECT
 * --------------------
 * Hosted run 34121462378 shipped a proposal whose extracted text reads
 * "Dr\u0000 Abdul\u0000 Seid", "medical\u0000centre", "healthcare\u0000specific",
 * "infection\u0000prevention", "clinical\u0000zone" and "well\u0000placed" — sixteen
 * occurrences. The two runs before it had none.
 *
 * The model wrote a typographic separator rather than an ASCII one — a
 * non-breaking hyphen, a soft hyphen, a figure dash, a narrow no-break space.
 * The embedded font subset carries no ToUnicode entry for it, so the character
 * survives into the PDF and comes back out of text extraction as U+0000. An
 * evaluator's copy-paste, search and screen-reader all break on it, and any
 * downstream text check sees a NUL where a word boundary should be.
 *
 * This is not about one model or one sector: any writer may emit these, and
 * every tender's client-facing text passes through here, so the normalisation
 * belongs at this shared boundary rather than in a per-sector pass. Each
 * character maps to the plain ASCII equivalent a reader expects, so no word is
 * joined or split that was not already joined or split.
 */
const UNMAPPABLE_SEPARATORS: ReadonlyArray<readonly [RegExp, string]> = [
  // Hyphen-like: non-breaking hyphen, hyphen, figure dash, soft hyphen.
  [/[\u2010\u2011\u2012]/g, "-"],
  // Soft hyphen is an invisible line-break hint; it is never wanted in output.
  [/\u00ad/g, ""],
  // Space-like: no-break, narrow no-break, thin, figure, and hair spaces.
  [/[\u00a0\u202f\u2009\u2007\u200a]/g, " "],
  // Zero-width characters that survive into the glyph stream as nothing.
  [/[\u200b\u200c\u200d\ufeff]/g, ""],
];

function normalizeUnmappableSeparators(text: string): string {
  let out = text;
  for (const [pattern, replacement] of UNMAPPABLE_SEPARATORS) {
    out = out.replace(pattern, replacement);
  }
  // A NUL that already reached the text is a word boundary that was lost; a
  // space is the only safe reading, and it never merges two words together.
  return out.replace(/\u0000/g, " ");
}

function sanitizeSegment(segment: string): string {
  let out = segment.replace(CASE_INSENSITIVE_SCRUB, "");
  out = out.replace(CASE_SENSITIVE_SCRUB, "");

  for (const pattern of LEGACY_AI_PATTERNS) {
    out = out.replace(pattern, "");
  }

  out = normalizeUnmappableSeparators(out);
  out = normalizeEmDashes(out);
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+$/gm, "");
  return out;
}

export function sanitizeClientFacingText(text: string, options: SanitizeOptions = {}): string {
  if (!text) return text;
  const { preserveTenderQuotes = false } = options;

  if (!preserveTenderQuotes) {
    return sanitizeSegment(text);
  }

  const segments = text.split(/(["“”][^"“”\n]{3,2000}["“”])/g);
  const processed = segments.map((seg, i) => {
    if (i % 2 === 1) return seg;
    return sanitizeSegment(seg);
  });
  return processed.join("");
}

export function findClientFacingViolations(input: string): string[] {
  if (!input) return [];
  const violations: string[] = [];

  const ciMatch = input.match(CASE_INSENSITIVE_SCRUB);
  if (ciMatch) {
    for (const m of ciMatch) {
        violations.push(`AI trace or internal marker detected (case-insensitive): ${m}`);
    }
  }
  const csMatch = input.match(CASE_SENSITIVE_SCRUB);
  if (csMatch) {
    for (const m of csMatch) {
        violations.push(`Placeholder or internal marker detected (case-sensitive): ${m}`);
    }
  }
  for (const pattern of LEGACY_AI_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      violations.push(`Legacy AI pattern detected: ${match[0]}`);
    }
  }

  // Dedupe violations
  return [...new Set(violations)];
}
