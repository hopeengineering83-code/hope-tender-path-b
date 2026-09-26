import { computeFileHash, toBuffer, validatePackageManifest, type ManifestValidationItem } from "./generated-file-integrity";

export type FinalPackageManifestItem = {
  documentId: string;
  filename: string;
  required: boolean;
  source: "generated" | "uploaded" | "asset" | "manual";
  mimeType: string;
  byteSize: number;
  sha256: string;
  order: number;
  signatureRequired?: boolean;
  stampRequired?: boolean;
  valid: boolean;
  /**
   * True when byteSize and sha256 were computed from bytes that were actually
   * loaded. False means those two fields are unknown rather than zero/empty,
   * and no byte-level claim is being made about this item.
   */
  contentVerified?: boolean;
  problem?: string;
};

export type ManifestSourceDocument = {
  id: string;
  exactFileName?: string | null;
  name?: string | null;
  documentType?: string | null;
  fileContent?: string | null;
  mimeType?: string | null;
  exactOrder?: number | null;
  required?: boolean | null;
  source?: FinalPackageManifestItem["source"] | null;
  stale?: boolean | null;
  generationStatus?: string | null;
};

export type BuildFinalPackageManifestOptions = {
  /**
   * Whether `fileContent` was actually selected for these rows.
   *
   * Absent bytes and empty bytes are not the same fact, and this builder
   * cannot tell them apart from `fileContent` alone. A caller that omits the
   * blob column — status polling routes do, deliberately, because the column
   * is multi-MB per document — used to get byteSize 0 and sha256 "" for every
   * row, which the strict validation then reported as
   *
   *   "<file>: required file invalid", "<file>: zero-byte file",
   *   "<file>: invalid sha256"
   *
   * for documents that were verified, non-empty and downloadable. Those
   * blockers reached the public readiness envelope, so a complete package
   * published BLOCKED on one route while every other surface and the ZIP
   * itself said it was fine.
   *
   * Pass `false` when the bytes were not loaded. Byte-derived facts are then
   * reported as unknown rather than as zero, and the byte assertions are not
   * made. Everything that does not need bytes — filenames, duplicates,
   * ordering, staleness, generation status — is still checked.
   *
   * Defaults to true, so every existing caller that does load the blob keeps
   * the full byte-level check unchanged.
   */
  contentLoaded?: boolean;
};

export function buildFinalPackageManifest(
  docs: ManifestSourceDocument[],
  opts: BuildFinalPackageManifestOptions = {},
): { items: FinalPackageManifestItem[]; blockers: string[]; warnings: string[]; ok: boolean } {
  const contentLoaded = opts.contentLoaded !== false;
  const items = docs.map((doc, index): FinalPackageManifestItem => {
    const filename = sanitizeFinalFilename(doc.exactFileName ?? doc.name ?? `document-${index + 1}.docx`);
    const bytes = doc.fileContent ? toBuffer(doc.fileContent) : Buffer.alloc(0);
    const stale = Boolean(doc.stale) || doc.generationStatus === "STALE";
    const valid = contentLoaded
      ? bytes.length > 0 && !stale
      : !stale && doc.generationStatus !== "FAILED";
    return {
      documentId: doc.id,
      filename,
      required: doc.required !== false,
      source: doc.source ?? "generated",
      mimeType: doc.mimeType ?? inferMime(filename),
      byteSize: bytes.length,
      sha256: bytes.length ? computeFileHash(bytes) : "",
      order: doc.exactOrder ?? index + 1,
      valid,
      contentVerified: contentLoaded,
      problem: contentLoaded && bytes.length === 0
        ? "missing or zero-byte content"
        : stale
          ? "stale document"
          : undefined,
    };
  }).sort((a, b) => a.order - b.order || a.filename.localeCompare(b.filename));
  const validation = contentLoaded
    ? validateStrictFinalPackageManifest(items)
    : validateFinalPackageManifestWithoutContent(items);
  return { items, blockers: validation.blockers, warnings: validation.warnings, ok: validation.ok };
}

/**
 * Validate everything about a manifest that does not require the bytes.
 *
 * Used when `contentLoaded` is false. The byte-level guarantees are not
 * weakened for anyone — they are simply not claimed here, and the download and
 * final-readiness paths still load the bytes and check them in full before a
 * package is served.
 */
export function validateFinalPackageManifestWithoutContent(items: FinalPackageManifestItem[]) {
  return validatePackageManifest(
    items.map((i): ManifestValidationItem => ({
      ...i,
      stale: i.problem === "stale document",
      // The byte facts are unknown, not zero. Presenting them as satisfied
      // here would be its own lie; the checks that read them are skipped
      // instead, via skipContentChecks below.
    })),
    { requireAllRequired: true, skipContentChecks: true },
  );
}

export function validateStrictFinalPackageManifest(items: FinalPackageManifestItem[]) {
  return validatePackageManifest(items.map((i): ManifestValidationItem => ({ ...i, stale: i.problem === "stale document" })), { requireAllRequired: true });
}

export function manifestFingerprint(items: FinalPackageManifestItem[]): string {
  return computeFileHash(JSON.stringify(items.map((i) => ({ documentId: i.documentId, filename: i.filename, required: i.required, source: i.source, mimeType: i.mimeType, byteSize: i.byteSize, sha256: i.sha256, order: i.order }))));
}

function sanitizeFinalFilename(filename: string): string {
  const cleaned = filename.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "document.docx";
}

function inferMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
