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
  return text.replace(/\s*—\s*/g, " — ");
}

function sanitizeSegment(segment: string): string {
  let out = segment.replace(CASE_INSENSITIVE_SCRUB, "");
  out = out.replace(CASE_SENSITIVE_SCRUB, "");

  for (const pattern of LEGACY_AI_PATTERNS) {
    out = out.replace(pattern, "");
  }

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
