// Shared source-grounded metadata validators.
//
// These are the SINGLE validation rules used by both the repair-metadata and
// re-extract-metadata routes, so the two endpoints can never disagree about
// what counts as a valid reference / deadline / title / client name, and
// both verify claimed source quotes against the active tender file text.
import { containsMetadataPlaceholder } from "./metadata-validators";
import { detectMetadataContamination } from "./tender-metadata-completeness";

export interface ActiveTenderFile { id: string; fileName: string; extractedText: string | null; totalPages?: number | null; }

const REFERENCE_STOP_WORDS = /^(not|n\/?a|tbd|tbc|to\s+be\s+determined|to\s+be\s+confirmed|unknown|none|null|placeholder|n\.a\.|nil)$/i;
const FIELD_LABEL_PATTERNS = /^(reference\s*(number|no\.?)?|ref\.?\s*(number|no\.?)?|tender\s*(number|no\.?)?|bid\s*(number|no\.?)?|deadline|date|title|client\s*name|procuring\s*entity)$/i;

export function isValidReferenceCandidate(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  const trimmed = value.trim();
  if (REFERENCE_STOP_WORDS.test(trimmed)) return false;
  if (FIELD_LABEL_PATTERNS.test(trimmed)) return false;
  if (containsMetadataPlaceholder(trimmed)) return false;
  if (detectMetadataContamination(trimmed).contaminated) return false;
  if (!/\d/.test(trimmed)) return false;
  return true;
}

export function isValidDeadlineCandidate(value: unknown): boolean {
  if (!value) return false;
  let date: Date;
  if (value instanceof Date) { date = value; }
  else if (typeof value === "string") {
    if (containsMetadataPlaceholder(value)) return false;
    if (FIELD_LABEL_PATTERNS.test(value)) return false;
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return false;
    date = parsed;
  } else { return false; }
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (date < thirtyDaysAgo) return false;
  return true;
}

export function isValidTitleOrClientCandidate(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  const trimmed = value.trim();
  if (containsMetadataPlaceholder(trimmed)) return false;
  if (detectMetadataContamination(trimmed).contaminated) return false;
  if (trimmed.length < 5) return false;
  if (FIELD_LABEL_PATTERNS.test(trimmed)) return false;
  return true;
}

export function verifySourceQuote(quote: string | null | undefined, files: ActiveTenderFile[]): { verified: boolean; sourceFileId: string | null } {
  if (!quote || quote.trim().length < 5) return { verified: false, sourceFileId: null };
  const normalizedQuote = quote.toLowerCase().replace(/\s+/g, " ").trim();
  for (const file of files) {
    if (!file.extractedText) continue;
    const fileText = file.extractedText.toLowerCase().replace(/\s+/g, " ").trim();
    if (fileText.includes(normalizedQuote)) return { verified: true, sourceFileId: file.id };
  }
  return { verified: false, sourceFileId: null };
}
