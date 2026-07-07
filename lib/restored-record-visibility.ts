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
 */
export function hasRestoredInlineFileContent(record: RestoredFileRecordLike): boolean {
  return record.hasInlineFileContent === true || hasText(record.fileContent);
}

export function hasVisibleStoredFile(record: RestoredFileRecordLike): boolean {
  return hasText(record.storagePath) || hasRestoredInlineFileContent(record);
}

