// Attribute an extracted metadata field to the ACTUAL tender file it came from,
// by locating the supporting quote inside a file's extracted text.
//
// This replaces any "attribute to the earliest/primary file" heuristic: a
// metadata field is only bound to a file when that file's extracted content
// actually contains the supporting quote. When there is no quote, or no active
// file contains it, the field is left UNGROUNDED (null) — never guessed.

/** Minimum normalized quote length worth attributing (mirrors grounding floor). */
const MIN_ATTRIBUTION_QUOTE_CHARS = 6;

function normalizeText(value: string): string {
  // Lowercase + collapse all whitespace so quotes match across line wraps and
  // spacing differences between the extraction snippet and the file text.
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export type AttributionFile = {
  id: string;
  extractedText?: string | null;
  deletionStatus?: string | null;
};

/**
 * Return the id of the ACTIVE tender file whose extracted text contains the
 * given quote, or null when the quote is missing/too short or no active file
 * contains it. Files are considered in a stable id order so the result is
 * deterministic when (rarely) the same quote appears in more than one file.
 */
export function attributeMetadataSourceFileId(
  quote: string | null | undefined,
  files: AttributionFile[],
): string | null {
  if (!quote) return null;
  const needle = normalizeText(quote);
  if (needle.length < MIN_ATTRIBUTION_QUOTE_CHARS) return null;

  const active = files
    .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const f of active) {
    if (!f.extractedText) continue;
    if (normalizeText(f.extractedText).includes(needle)) return f.id;
  }
  return null;
}
