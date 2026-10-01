export type OfficeContainerInspection =
  | { kind: "not_applicable" | "valid" }
  | { kind: "json"; text: string }
  | { kind: "invalid"; reason: string };

const ZIPPED_OFFICE_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "ods", "odp"]);

function extensionOf(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && (
    (buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[2] === 0x07 && buffer[3] === 0x08)
  );
}

function parseJsonBytes(buffer: Buffer): string | null {
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!raw || (raw[0] !== "{" && raw[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return null;
  }
}

export function inspectOfficeContainerBytes(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): OfficeContainerInspection {
  const ext = extensionOf(fileName);
  if (!ZIPPED_OFFICE_EXTENSIONS.has(ext)) return { kind: "not_applicable" };
  if (hasZipSignature(buffer)) return { kind: "valid" };

  const json = parseJsonBytes(buffer);
  if (json) return { kind: "json", text: json };

  return {
    kind: "invalid",
    reason: `File bytes do not match the .${ext} Office container format (stored MIME: ${mimeType || "unknown"}).`,
  };
}
