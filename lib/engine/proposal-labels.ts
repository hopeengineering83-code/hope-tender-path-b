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
    .replace(/\s+/g, " ")
    .trim();
}

function isSuspiciousLabel(value: string): boolean {
  const text = value.toLowerCase();
  return value.length > 140
    || /\b(headquarters|full name|relationship|ref only|references where available|photos or drawings|proposed design methodology|technical approach understanding|not specified in texts)\b/i.test(value)
    || (text.includes("pharo ventures") && text.includes("relationship"));
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
export function formatRequirementLine(req: { title?: string | null; description?: string | null }, maxDescriptionChars = 380): string {
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
  return title ? `${title} — ${shortDesc}` : shortDesc;
}

export function safeFileBaseName(value?: string | null, fallback = "submission-package"): string {
  const cleaned = cleanTenderTitle(value, { fallback })
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}
