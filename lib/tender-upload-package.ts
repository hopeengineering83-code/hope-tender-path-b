export const MAX_TENDER_UPLOAD_REQUEST_FILES = 10;
export const MAX_TENDER_UPLOAD_REQUEST_BYTES = 30 * 1024 * 1024;
export const MAX_TENDER_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TENDER_PACKAGE_FILES = 50;
export const MAX_TENDER_PACKAGE_BYTES = 150 * 1024 * 1024;

const ALLOWED_TENDER_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "txt", "csv"]);

export type TenderPackageFileLike = {
  name: string;
  size: number;
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function validateTenderPackageSelection(selected: readonly TenderPackageFileLike[]): string | null {
  if (selected.length === 0) return null;
  if (selected.length > MAX_TENDER_PACKAGE_FILES) {
    return `Select no more than ${MAX_TENDER_PACKAGE_FILES} files for one intake package. Create the tender with the first package, then add any remaining documents in Tender source files.`;
  }

  const unsupported = selected.filter((file) => !ALLOWED_TENDER_EXTENSIONS.has(fileExtension(file.name)));
  if (unsupported.length > 0) {
    return `${unsupported.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, TXT, or CSV. Convert legacy DOC/XLS files first.`;
  }

  const oversized = selected.filter((file) => file.size > MAX_TENDER_UPLOAD_FILE_BYTES);
  if (oversized.length > 0) {
    return `${oversized.map((file) => file.name).join(", ")}: each file must be 10 MB or smaller.`;
  }

  const totalBytes = selected.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TENDER_PACKAGE_BYTES) {
    return "The selected package exceeds 150 MB. Create the tender with a smaller package, then add the remaining documents from Tender source files.";
  }
  return null;
}

/**
 * Split one user-selected package into request-safe batches without weakening
 * the server's existing 10-file / 30-MB request boundary. File order is
 * preserved because the first batch is the metadata authority used to create
 * the tender, and every later file is appended to that same tender.
 */
export function partitionTenderUploadPackage<T extends { size: number }>(selected: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const file of selected) {
    const requestWouldOverflow =
      current.length >= MAX_TENDER_UPLOAD_REQUEST_FILES ||
      (current.length > 0 && currentBytes + file.size > MAX_TENDER_UPLOAD_REQUEST_BYTES);

    if (requestWouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += file.size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
