const CLIENT_ENTITY_SUFFIXES = [
  "Ventures",
  "Foundation",
  "Ministry",
  "Authority",
  "Bureau",
  "Agency",
  "Council",
  "Trust",
  "PLC",
  "Ltd",
  "Limited",
  "Bank",
  "Hospital",
  "University",
  "Institute",
  "International",
  "Ethiopia",
  "Africa",
];

function normalizeLabel(value?: string | null): string {
  return (value ?? "")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/\bPARSED TEXT FOR PAGE\b[^\n]*/gi, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    // Strip internal metadata placeholders ("Bid-Team to confirm",
    // "TBC", "TBD", "placeholder") so they cannot leak into proposal-
    // facing labels like the cover-letter subject. Defense in depth on
    // top of sanitize-stored-metadata.ts.
    .replace(/\bbid[-_\s]?team\s+to\s+confirm\b/gi, " ")
    .replace(/\bto\s+be\s+confirmed\b/gi, " ")
    .replace(/\bplaceholder\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSuspiciousLabel(value: string): boolean {
  const text = value.toLowerCase();
  return value.length > 140
    || /\b(headquarters|full name|relationship|ref only|references where available|photos or drawings|proposed design methodology|technical approach understanding|not specified in texts)\b/i.test(value)
    // A label that reads like a project-relationship description (a named entity
    // followed by "relationship") is the firm's prior client, not the current
    // procuring entity — flag it as suspicious regardless of which firm it names.
    || (/\b[A-Z][A-Za-z0-9&.'’()\-/]+(?:\s+[A-Z][A-Za-z0-9&.'’()\-/]+)*\b/.test(value) && text.includes("relationship"));
}

export function extractLikelyClientName(...values: Array<string | null | undefined>): string | null {
  const source = normalizeLabel(values.filter(Boolean).join(" "));
  if (!source) return null;

  const explicit = source.match(/(?:client|to|for|submitted to|management)\s*[:\-]?\s*([A-Z][A-Za-z0-9&.,'’()\-/ ]{2,80})/);
  if (explicit?.[1]) return cleanClientName(explicit[1]);

  const suffixPattern = CLIENT_ENTITY_SUFFIXES.join("|");
  const entity = source.match(new RegExp(`\\b([A-Z][A-Za-z0-9&.'’()\\-/ ]{1,70} (?:${suffixPattern}))\\b`));
  if (entity?.[1]) return cleanClientName(entity[1]);

  return null;
}

export function cleanClientName(value?: string | null, fallback?: string | null): string {
  const normalized = normalizeLabel(value);
  const fallbackName = normalizeLabel(fallback);
  const candidate = normalized || fallbackName;
  if (!candidate) return "Client";

  const cleaned = candidate
    .replace(/\b(?:procuring\s+entity\s*\/\s*client\s+name|legal\s+client\s+name|project\s+name)\s*:.*$/i, "")
    .replace(/\b(full name|relationship|headquarters|not specified in texts)\b.*$/i, "")
    .replace(/\s*\([^)]{0,80}$/g, "")
    .replace(/[.,;:\-–—\s]+$/g, "")
    .trim();

  if (!cleaned || cleaned.length > 90 || isSuspiciousLabel(cleaned)) {
    return extractLikelyClientName(candidate) ?? "Client";
  }
  return cleaned;
}

export function cleanTenderTitle(value?: string | null, context?: { clientName?: string | null; description?: string | null; fallback?: string | null }): string {
  const normalized = normalizeLabel(value);
  const fallback = normalizeLabel(context?.fallback);
  const client = cleanClientName(context?.clientName ?? extractLikelyClientName(normalized, context?.description, fallback));
  const candidate = normalized || fallback;

  if (!candidate) return client === "Client" ? "Tender Submission" : `${client} Tender`;

  const stripped = candidate
    .replace(/\b(headquarters|full name|relationship|ref only|references where available|photos or drawings|technical approach understanding|proposed design methodology)\b.*$/i, "")
    .replace(/[.,;:\-–—\s]+$/g, "")
    .trim();

  if (!stripped || isSuspiciousLabel(candidate) || stripped.length < 8) {
    return client === "Client" ? "Tender Submission" : `${client} Tender`;
  }

  return stripped.length > 120 ? `${stripped.slice(0, 119).trim()}…` : stripped;
}

/**
 * Format a TenderRequirement title + description into a single user-facing
 * line, with two cleanups that real-world output exposed as bugs:
 *
 * 1. If the description repeats the same phrase 3+ times separated by " — "
 *    or " | " or ". " (a common artifact of the AI analysis step echoing
 *    a requirement back into its own description), reduce to one copy.
 *
 * 2. If the description starts with the title verbatim, strip the duplicate
 *    leading title.
 *
 * 3. If the description is empty, the same as the title, or contains only
 *    the title, return just the title with no separator.
 *
 * Intended call sites:
 *   const requirements = tender.requirements.map(formatRequirementLine)
 */
export function formatRequirementLine(req: { title?: string | null; description?: string | null; sourcePageNumber?: number | null; sourceSectionHeading?: string | null; sourceExactQuote?: string | null }, maxDescriptionChars = 380): string {
  const title = normalizeLabel(req.title);
  let desc = normalizeLabel(req.description);

  // Dedupe internal repetition of "X — X — X — X" or "X | X | X" patterns.
  // Common when the AI analysis stage echoes the requirement title back
  // into its own description multiple times.
  const repeatSeparators = [" — ", " | ", ". "];
  for (const sep of repeatSeparators) {
    const parts = desc.split(sep).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const unique = Array.from(new Set(parts));
      if (unique.length === 1) {
        desc = unique[0];
        break;
      }
      if (unique.length < Math.max(2, parts.length / 2)) {
        desc = unique.join(sep);
      }
    }
  }

  // Strip leading title duplication: when desc starts with the title.
  if (title && desc.toLowerCase().startsWith(title.toLowerCase())) {
    const stripped = desc.slice(title.length).replace(/^[\s—–.,:;|—]+/, "").trim();
    if (stripped) desc = stripped;
    else desc = ""; // entire description was just the title
  }

  // No useful description → return just the title.
  if (!desc || desc === title) return title;

  // Truncate long descriptions.
  const shortDesc = desc.length > maxDescriptionChars ? `${desc.slice(0, maxDescriptionChars - 1).trim()}…` : desc;
  const base = title ? `${title} — ${shortDesc}` : shortDesc;
  // Append source coordinates when available — helps AI and fallback prose write
  // "as specified on page N of Section X" and aids compliance reviewers tracing
  // each requirement back to the source tender document.
  const pageTag = req.sourcePageNumber != null ? ` [p.${req.sourcePageNumber}]` : "";
  const sectionTag = req.sourceSectionHeading ? ` (§ ${req.sourceSectionHeading.slice(0, 80).trim()})` : "";
  // Append the exact source quote when available — anchors every AI-generated
  // claim to the actual tender text, improving evidence grounding.
  const quoteTag = req.sourceExactQuote && req.sourceExactQuote.trim().length > 0
    ? ` (quote: "${req.sourceExactQuote.trim().slice(0, 200)}")`
    : "";
  return `${base}${pageTag}${sectionTag}${quoteTag}`;
}

/**
 * Truncate a display line WITHOUT landing inside — or half-closing — a
 * provenance tag this module appended.
 *
 * WHY THIS FUNCTION EXISTS
 * ------------------------
 * formatRequirementLine() above always returns a complete, closed line: the
 * quote/section/page tags are appended AFTER their values are already sliced,
 * so `[p.7] (§ SECTION) (quote: "…")` is never malformed at the point this
 * module builds it. But three DOWNSTREAM deterministic renderers
 * (lib/engine/tender-response-blueprint.ts, proposal-evaluator-matrix.ts,
 * proposal-quality-repair.ts) each carried their own copy-pasted `take()`
 * helper that RE-TRUNCATES an already-complete line with a raw
 * `line.slice(0, maxLen - 1) + "…"` — with no idea the line ends in
 * structural syntax.
 *
 * On the real Pharo tender (deterministic fallback path — every AI call was
 * rate-limited, so `formatRequirementLine`'s 506-character, well-formed line
 * for "Specialized Healthcare Design Experience" was the whole input),
 * tender-response-blueprint.ts's `take(input.requirements, 16, 320)` cut it
 * at character 320 — inside the section-heading VALUE, before the tag's own
 * closing paren — and that fragment flowed, unchanged, into the client-facing
 * "Section E: Compliance Matrix" of the submitted DOCX and PDF:
 *
 *   … Include reviewed healthcare project references. [p.7]
 *   (§ QUALIFICATIONS AND APP EXTR…
 *
 * This is not a model-generation artifact — it is 100% deterministic,
 * reproducible on stored data with zero AI calls (see
 * tests/requirement-line-truncates-without-breaking-its-own-tags.test.ts).
 *
 * THE FIX
 * -------
 * This function is the ONE place that decides how to shorten a line built by
 * formatRequirementLine(). It never partially prints a tag:
 *   1. If the line ends in a `(quote: "…")`, `(§ …)` or `[p.N]` tag (in any
 *      combination formatRequirementLine produces), the tag suffix is
 *      identified and set aside.
 *   2. If the core text plus the FULL tag suffix already fits in `maxLen`,
 *      the line is returned completely unchanged — nothing is touched.
 *   3. If the core text alone fits but the tags push it over, the tags are
 *      dropped WHOLESALE (never partially) and the core is returned
 *      untruncated — the tags are grounding metadata for a writer, not a
 *      fact the client-facing line loses meaning without.
 *   4. Only if the core text itself exceeds `maxLen` is it truncated, and
 *      always at the last word boundary before the limit, with a trailing
 *      "…" — the same rule truncateAtWordBoundary applies elsewhere in the
 *      generator (see proposal-intelligence.ts), so a display line never
 *      stops mid-word regardless of which renderer shortened it.
 *
 * Operates on ONE caller-supplied line at a time and never touches `\n`:
 * every value that reaches formatRequirementLine's output is already
 * single-line by construction (normalizeLabel collapses all whitespace,
 * control characters included), so there is no assembled markdown, table
 * row, or section boundary here for a fix to damage.
 */
const TRAILING_QUOTE_TAG = /\s*\(quote:\s*"[^"]*"?\)?\s*$/i;
const TRAILING_SECTION_TAG = /\s*\(§[^)]*\)?\s*$/;
const TRAILING_PAGE_TAG = /\s*\[p\.\s*\d+\]\s*$/i;

export function truncateDisplayLine(value: string, maxLen: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line;

  // Peel known trailing tags off, in the order formatRequirementLine appends
  // them (quote is always last, then section, then page), so a line with
  // only some of the three tags is handled the same as one with all three.
  let core = line;
  let removedAnyTag = false;
  for (const tagPattern of [TRAILING_QUOTE_TAG, TRAILING_SECTION_TAG, TRAILING_PAGE_TAG]) {
    const withoutTag = core.replace(tagPattern, "");
    if (withoutTag !== core) {
      core = withoutTag;
      removedAnyTag = true;
    }
  }

  if (removedAnyTag && core.length <= maxLen) {
    // The core statement — the actual requirement text — fits once the
    // provenance tags are set aside. Return it whole: no half-open
    // parenthesis, no ellipsis needed, no fact lost.
    return core;
  }

  // Either there were no tags to remove, or even the bare core is too long.
  // Cut the core at the last word boundary before the limit.
  const budget = Math.max(1, maxLen - 1);
  const window = core.slice(0, budget);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > Math.floor(budget * 0.5) ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}

export function safeFileBaseName(value?: string | null, fallback = "submission-package"): string {
  const cleaned = cleanTenderTitle(value, { fallback })
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}
