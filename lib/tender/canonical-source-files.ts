export type CanonicalTenderFileInput = {
  id: string;
  fileName?: string | null;
  originalFileName?: string | null;
  deletionStatus?: string | null;
  contentSha256?: string | null;
  integrityStatus?: string | null;
  extractionScore?: number | null;
  extractionMethod?: string | null;
  totalPages?: number | null;
  extractedPages?: number | null;
  failedPages?: number | null;
  extractedText?: string | null;
  createdAt?: Date | string | null;
};

export type CanonicalTenderSourceReadiness<T extends CanonicalTenderFileInput> = {
  canonicalFiles: T[];
  duplicateFileCount: number;
  byteIntegrityValid: boolean;
  extractionComplete: boolean;
  extractionQualityValid: boolean;
  analysisReady: boolean;
  blockers: string[];
};

const MIN_ANALYSIS_SCORE = 70;

function normalizedLogicalStem(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/\s*\((?:copy|duplicate|\d+)\)\s*$/i, "")
    .replace(/\s*[-_]\s*(?:copy|duplicate)\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numericDate(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function coverage(file: CanonicalTenderFileInput): number {
  const total = file.totalPages ?? 0;
  const extracted = file.extractedPages ?? 0;
  const failed = file.failedPages ?? 0;
  if (total <= 0) return file.extractedText && file.extractedText.trim().length >= 100 ? 1 : 0;
  return Math.max(0, Math.min(1, (extracted - failed) / total));
}

function rank(file: CanonicalTenderFileInput): number[] {
  const score = Number.isFinite(file.extractionScore) ? Number(file.extractionScore) : -1;
  const textLength = file.extractedText?.trim().length ?? 0;
  return [
    file.deletionStatus === "ACTIVE" || !file.deletionStatus ? 1 : 0,
    file.integrityStatus === "VERIFIED" ? 1 : 0,
    file.extractionMethod && file.extractionMethod !== "failed" ? 1 : 0,
    score,
    coverage(file),
    Math.min(textLength, 100_000),
    numericDate(file.createdAt),
  ];
}

function compareRank<T extends CanonicalTenderFileInput>(left: T, right: T): number {
  const a = rank(left);
  const b = rank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return left.id.localeCompare(right.id);
}

/**
 * Select one authoritative representation for each logical source document.
 *
 * DIRECTIVE 6: Source identity is now byte-SHA-256 primary, filename-stem
 * advisory only. The rules are:
 *   1. Same SHA-256 bytes → exact duplicate; deduplicate (keep best representation).
 *   2. Same filename but different bytes → separate active logical sources
 *      (NOT collapsed — the user may have uploaded a revised version).
 *   3. PDF + DOCX with different bytes → separate sources (no implicit grouping).
 *   4. Addendum/amendment → independent active logical source.
 *   5. Filename similarity → advisory only, never authority.
 *   6. Ambiguous relationship → do not silently collapse.
 *
 * The previous implementation used normalizedLogicalStem as the primary
 * grouping key, which incorrectly collapsed different-byte files with the
 * same filename stem. The new implementation groups by contentSha256 first,
 * then by file ID as a unique fallback. Files without contentSha256 are
 * grouped by ID only (never by filename stem).
 */
export function selectCanonicalTenderFiles<T extends CanonicalTenderFileInput>(files: T[]): T[] {
  const active = files.filter((file) => !file.deletionStatus || file.deletionStatus === "ACTIVE");
  const grouped = new Map<string, T[]>();

  for (const file of active) {
    // DIRECTIVE 6: Primary identity is byte SHA-256. Files with the same
    // contentSha256 are exact duplicates and are deduplicated.
    // Files with different contentSha256 are separate logical sources,
    // even if they have the same filename.
    let key: string;
    if (file.contentSha256) {
      key = `sha256:${file.contentSha256.toLowerCase()}`;
    } else {
      // No contentSha256 — use file ID as unique identity (never filename).
      // This prevents collapsing two unverified files with the same name.
      key = `id:${file.id}`;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), file]);
  }

  return [...grouped.values()]
    .map((rows) => [...rows].sort(compareRank)[0])
    .sort((left, right) => numericDate(left.createdAt) - numericDate(right.createdAt) || left.id.localeCompare(right.id));
}

export function assessCanonicalTenderSourceReadiness<T extends CanonicalTenderFileInput>(
  files: T[],
): CanonicalTenderSourceReadiness<T> {
  const activeCount = files.filter((file) => !file.deletionStatus || file.deletionStatus === "ACTIVE").length;
  const canonicalFiles = selectCanonicalTenderFiles(files);
  const blockers: string[] = [];

  const byteIntegrityValid = canonicalFiles.length > 0
    && canonicalFiles.every((file) => file.integrityStatus === "VERIFIED" && Boolean(file.contentSha256));
  const extractionComplete = canonicalFiles.length > 0
    && canonicalFiles.every((file) => {
      const textLength = file.extractedText?.trim().length ?? 0;
      const hasSuccessfulMethod = Boolean(file.extractionMethod) && file.extractionMethod !== "failed";
      const hasPositiveScore = Number.isFinite(file.extractionScore) && Number(file.extractionScore) > 0;
      return hasSuccessfulMethod && hasPositiveScore && textLength >= 100 && coverage(file) >= 0.95;
    });
  const extractionQualityValid = canonicalFiles.length > 0
    && canonicalFiles.every((file) => Number(file.extractionScore ?? -1) >= MIN_ANALYSIS_SCORE);

  if (canonicalFiles.length === 0) blockers.push("No active canonical tender source exists.");
  if (!byteIntegrityValid) blockers.push("Canonical source byte integrity is not verified.");
  if (!extractionComplete) blockers.push("Canonical source extraction is incomplete.");
  if (!extractionQualityValid) blockers.push(`Canonical source extraction quality is below ${MIN_ANALYSIS_SCORE}/100.`);

  return {
    canonicalFiles,
    duplicateFileCount: Math.max(0, activeCount - canonicalFiles.length),
    byteIntegrityValid,
    extractionComplete,
    extractionQualityValid,
    analysisReady: byteIntegrityValid && extractionComplete && extractionQualityValid,
    blockers,
  };
}
