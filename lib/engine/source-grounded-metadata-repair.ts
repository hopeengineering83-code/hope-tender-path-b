// Shared source-grounded metadata repair service.
import { containsMetadataPlaceholder } from "./metadata-validators";
import { detectMetadataContamination } from "./tender-metadata-completeness";

export type RepairableField = "reference" | "deadline" | "clientName" | "title" | "submissionMethod" | "submissionEmails" | "submissionAddress" | "evaluationMethodology" | "pageLimit" | "validityDays" | "bidBondAmount" | "numberOfCopiesRequired" | "mandatorySiteVisit";
export type RepairResultStatus = "REPAIRED" | "NOT_FOUND" | "SKIPPED" | "REJECTED" | "UNRESOLVED";

export interface SourceGroundedRepairResult {
  field: RepairableField;
  status: RepairResultStatus;
  reason?: string;
  value?: unknown;
  sourceFile?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  confidence?: string | null;
}

export interface ActiveTenderFile { id: string; fileName: string; extractedText: string | null; totalPages?: number | null; }
export interface MetadataRepairInput { field: RepairableField; currentValue: unknown; extractedValue: unknown; extractionSource?: string | null; extractionSourceFile?: string | null; extractionSourcePage?: number | null; extractionSourceQuote?: string | null; extractionConfidence?: string | null; isManualOverride: boolean; activeFiles: ActiveTenderFile[]; }

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

export function processMetadataRepair(input: MetadataRepairInput): SourceGroundedRepairResult {
  const { field, currentValue, extractedValue, isManualOverride, activeFiles } = input;
  if (isManualOverride) {
    const currentStr = currentValue != null ? String(currentValue).trim() : "";
    if (currentStr.length > 0) {
      if (field === "reference" && !isValidReferenceCandidate(currentStr)) return { field, status: "UNRESOLVED", reason: `Manual value "${currentStr}" is not a valid reference. Correct it manually.` };
      if (field === "deadline" && !isValidDeadlineCandidate(currentValue)) return { field, status: "UNRESOLVED", reason: "Manual deadline value is invalid or too far in the past. Correct it manually." };
      if ((field === "title" || field === "clientName") && !isValidTitleOrClientCandidate(currentStr)) return { field, status: "UNRESOLVED", reason: `Manual ${field} value is invalid. Correct it manually.` };
      return { field, status: "SKIPPED", reason: `${field} has a valid manual value — preserved.` };
    }
  }
  if (extractedValue == null || (typeof extractedValue === "string" && !extractedValue.trim())) return { field, status: "NOT_FOUND", reason: `No ${field} candidate found in tender source text.` };
  if (field === "reference" && !isValidReferenceCandidate(extractedValue as string)) return { field, status: "REJECTED", reason: `Extracted reference is invalid.`, value: extractedValue };
  if (field === "deadline" && !isValidDeadlineCandidate(extractedValue)) return { field, status: "REJECTED", reason: "Extracted deadline is invalid or too far in the past.", value: extractedValue };
  if ((field === "title" || field === "clientName") && !isValidTitleOrClientCandidate(extractedValue as string)) return { field, status: "REJECTED", reason: `Extracted ${field} is invalid.`, value: extractedValue };
  if (typeof extractedValue === "string" && containsMetadataPlaceholder(extractedValue)) return { field, status: "REJECTED", reason: `Extracted ${field} contains a placeholder pattern.`, value: extractedValue };
  if (input.extractionSourceQuote) {
    const verification = verifySourceQuote(input.extractionSourceQuote, activeFiles);
    if (!verification.verified) return { field, status: "UNRESOLVED", reason: `Source quote for ${field} is not contained in any active tender file. Re-grounding required.` };
  }
  return { field, status: "REPAIRED", value: extractedValue, sourceFile: input.extractionSourceFile ?? null, sourcePage: input.extractionSourcePage ?? null, sourceQuote: input.extractionSourceQuote ?? null, confidence: input.extractionConfidence ?? "medium" };
}

export function isSourceEvidenceStale(sourceFileId: string | null | undefined, activeFiles: ActiveTenderFile[]): boolean {
  if (!sourceFileId) return true;
  return !activeFiles.some((f) => f.id === sourceFileId);
}
