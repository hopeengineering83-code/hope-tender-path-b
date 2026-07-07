export type RestoredFileRecordLike = {
  storagePath?: string | null;
  fileContent?: string | null;
  hasInlineFileContent?: boolean | null;
};

function hasText(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Restored database rows may legitimately carry bytes in fileContent with an
 * empty storagePath. UI/query logic must treat those rows as visible files.
 *
 * NOTE: This checks the hasInlineFileContent hint OR the fileContent value
 * directly. For list/readiness paths, prefer the hint (set by a lightweight
 * query) to avoid loading large blobs. For export paths, load and validate
 * the actual bytes via hasRetrievableFileBytes().
 */
export function hasRestoredInlineFileContent(record: RestoredFileRecordLike): boolean {
  return record.hasInlineFileContent === true || hasText(record.fileContent);
}

export function hasVisibleStoredFile(record: RestoredFileRecordLike): boolean {
  return hasText(record.storagePath) || hasRestoredInlineFileContent(record);
}

/**
 * For export/ZIP paths: the actual bytes MUST be present and non-empty.
 * A visibility hint (hasInlineFileContent) is NOT sufficient — the export
 * must load and validate the real fileContent bytes. This function returns
 * true only when actual bytes are available.
 *
 * Use this instead of hasVisibleStoredFile() when deciding whether a file
 * is export-ready. The visibility helper is for UI/list display only.
 */
export function hasRetrievableFileBytes(record: RestoredFileRecordLike): boolean {
  // Actual bytes in fileContent (not just a hint) OR a storage path that
  // the storage adapter can retrieve from.
  return hasText(record.fileContent) || hasText(record.storagePath);
}

/**
 * Lightweight presence check for list/readiness queries. Instead of
 * char_length(fileContent) (which scans the full blob), use a boolean
 * NULL check. This is O(1) vs O(n) for large blobs.
 *
 * The SQL pattern is:
 *   SELECT id, ("fileContent" IS NOT NULL) AS "hasInlineFileContent"
 * instead of:
 *   SELECT id, char_length("fileContent") > 0 AS "hasInlineFileContent"
 *
 * This avoids loading/scanning the blob in list responses.
 */
export const INLINE_CONTENT_PRESENCE_SQL = `("fileContent" IS NOT NULL) AS "hasInlineFileContent"`;


