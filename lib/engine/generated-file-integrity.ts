import { createHash } from "node:crypto";

export type GeneratedFileIntegrityInput = {
  tenantId: string;
  tenderId: string;
  documentId?: string | null;
  filename: string;
  mimeType: string;
  bytes?: Buffer | Uint8Array | string | null;
  expectedMimeType?: string | null;
  expectedExtension?: string | null;
  storedSha256?: string | null;
  ownerTenantId?: string | null;
  minBytes?: number;
};

export type GeneratedFileIntegrityResult = {
  ok: boolean;
  sha256?: string;
  byteSize?: number;
  problem?: "TENANT_MISMATCH" | "MISSING_BYTES" | "ZERO_BYTE_FILE" | "FILE_TOO_SMALL" | "MIME_MISMATCH" | "EXTENSION_MISMATCH" | "HASH_MISMATCH" | "UNREADABLE_BYTES";
};

const EXTENSION_MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export function computeFileHash(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(toBuffer(bytes)).digest("hex");
}

export function toBuffer(bytes: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === "string") {
    const trimmed = bytes.trim();
    if (!trimmed) return Buffer.alloc(0);
    return Buffer.from(trimmed, isStrictBase64(trimmed) ? "base64" : "utf8");
  }
  return Buffer.alloc(0);
}

export function validateGeneratedFileBytes(input: GeneratedFileIntegrityInput): GeneratedFileIntegrityResult {
  if (input.ownerTenantId && input.ownerTenantId !== input.tenantId) return { ok: false, problem: "TENANT_MISMATCH" };
  if (input.bytes == null) return { ok: false, problem: "MISSING_BYTES" };
  let buffer: Buffer;
  try {
    buffer = toBuffer(input.bytes);
  } catch {
    return { ok: false, problem: "UNREADABLE_BYTES" };
  }
  if (buffer.length === 0) return { ok: false, problem: "ZERO_BYTE_FILE", byteSize: 0 };
  const minBytes = input.minBytes ?? 32;
  if (buffer.length < minBytes) return { ok: false, problem: "FILE_TOO_SMALL", byteSize: buffer.length };

  const normalizedExt = normalizeExtension(input.expectedExtension ?? extensionFromName(input.filename));
  if (normalizedExt && !input.filename.toLowerCase().endsWith(normalizedExt)) return { ok: false, problem: "EXTENSION_MISMATCH", byteSize: buffer.length };
  const expectedMime = input.expectedMimeType ?? (normalizedExt ? EXTENSION_MIME[normalizedExt] : null);
  if (expectedMime && input.mimeType !== expectedMime) return { ok: false, problem: "MIME_MISMATCH", byteSize: buffer.length };

  const sha256 = computeFileHash(buffer);
  if (input.storedSha256 && input.storedSha256 !== sha256) return { ok: false, problem: "HASH_MISMATCH", byteSize: buffer.length, sha256 };
  return { ok: true, byteSize: buffer.length, sha256 };
}

export function assertTenantOwnsFile(file: { companyId?: string | null; tender?: { companyId?: string | null } | null; tenderId?: string | null }, tenantId: string): void {
  const owner = file.companyId ?? file.tender?.companyId ?? null;
  if (owner && owner !== tenantId) throw new Error("TENANT_MISMATCH");
}

export type ManifestValidationItem = {
  documentId: string;
  filename: string;
  required: boolean;
  source: "generated" | "uploaded" | "asset" | "manual";
  mimeType: string;
  byteSize: number;
  sha256: string;
  order: number;
  valid: boolean;
  problem?: string;
  stale?: boolean;
};

export function validatePackageManifest(
  items: ManifestValidationItem[],
  opts: {
    requireAllRequired?: boolean;
    /**
     * Skip the two assertions that read bytes, for a caller that did not load
     * them. byteSize 0 and sha256 "" then mean "not measured", not "measured
     * and empty" — reporting them as zero-byte and bad-hash produced hard
     * blockers for verified, downloadable documents.
     *
     * Only these two checks are skipped. Filenames, duplicates, ordering,
     * staleness and the required/valid rule still run, and the byte-level
     * guarantee is unchanged everywhere the bytes are actually loaded.
     */
    skipContentChecks?: boolean;
  } = {},
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const normalized = item.filename.trim().toLowerCase();
    if (!normalized) blockers.push(`${item.documentId}: missing filename`);
    if (seen.has(normalized)) blockers.push(`${item.filename}: duplicate filename`);
    seen.add(normalized);
    if (item.required && opts.requireAllRequired !== false && !item.valid) blockers.push(`${item.filename}: required file invalid`);
    if (!opts.skipContentChecks && item.byteSize <= 0) blockers.push(`${item.filename}: zero-byte file`);
    if (!opts.skipContentChecks && !/^[a-f0-9]{64}$/i.test(item.sha256)) blockers.push(`${item.filename}: invalid sha256`);
    if (item.stale) blockers.push(`${item.filename}: stale document`);
    if (!item.valid && !item.required) warnings.push(`${item.filename}: optional file invalid${item.problem ? ` (${item.problem})` : ""}`);
    if (item.problem && item.valid) warnings.push(`${item.filename}: ${item.problem}`);
  }
  return { ok: blockers.length === 0, blockers, warnings, itemCount: items.length };
}

export function isStrictBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return false;
  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 0) return false;
    return decoded.toString("base64") === normalized;
  } catch {
    return false;
  }
}

function extensionFromName(filename: string): string | null {
  const m = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return m?.[0] ?? null;
}

function normalizeExtension(ext: string | null): string | null {
  if (!ext) return null;
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}
