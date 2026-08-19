import JSZip from "jszip";
import { createHash } from "node:crypto";
import type { ZipEntry } from "./final-zip-scope";
import type { SubmissionEnvelope, SubmissionPlanFormat } from "./submission-plan";

export type FinalZipDocumentContent = {
  generatedDocId: string;
  bytes: Buffer | Uint8Array;
};

export type FinalZipManifestEntry = {
  generatedDocId: string;
  filename: string;
  order: number;
  envelope: SubmissionEnvelope;
  format: SubmissionPlanFormat;
  byteLength: number;
  sha256: string;
};

export type FinalZipAssemblyResult = {
  buffer: Buffer;
  fileList: string[];
  manifest: FinalZipManifestEntry[];
  packageSha256: string;
};

/**
 * PERF-003: hard cap on the total uncompressed input bytes that may be fed
 * into {@link assembleFinalSubmissionZip}. The download route streams the
 * resulting ZIP back to the client, but JSZip still materializes the full
 * archive buffer (plus the uncompressed inputs) in memory before the first
 * byte is sent. Without this cap a single oversized package can OOM the
 * Vercel function. Callers that need to ship larger packages must split the
 * tender into multiple envelopes or sub-packages.
 */
export const FINAL_ZIP_MAX_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeEntryName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, "/");
  if (!trimmed) throw new Error("Final ZIP contains an empty filename.");
  if (trimmed.startsWith("/") || /^[a-zA-Z]:\//.test(trimmed)) {
    throw new Error(`Final ZIP contains an absolute path: ${name}`);
  }
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new Error(`Final ZIP contains an unsafe path: ${name}`);
  }
  return trimmed;
}

/**
 * Assemble already-scoped final submission entries into a verified ZIP.
 * Scope, order and names come exclusively from buildFinalZipEntries. The
 * helper refuses unsafe paths, silent overwrites, missing bytes, corrupt
 * archives and discrepancies between the manifest and reopened ZIP contents.
 */
export async function assembleFinalSubmissionZip(
  entries: ZipEntry[],
  contents: FinalZipDocumentContent[],
): Promise<FinalZipAssemblyResult> {
  if (entries.length === 0) throw new Error("Final ZIP has no scoped entries.");

  const contentById = new Map(contents.map((item) => [item.generatedDocId, item.bytes]));
  const seenNames = new Set<string>();
  const seenDocumentIds = new Set<string>();
  const seenOrders = new Set<number>();
  const zip = new JSZip();
  const fileList: string[] = [];
  const manifest: FinalZipManifestEntry[] = [];
  let totalInputBytes = 0;

  const orderedEntries = [...entries].sort(
    (left, right) => left.order - right.order || left.name.localeCompare(right.name),
  );

  for (const entry of orderedEntries) {
    const safeName = assertSafeEntryName(entry.name);
    const normalizedName = safeName.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(`Duplicate filename in final ZIP: ${safeName}`);
    }
    seenNames.add(normalizedName);

    if (!entry.generatedDocId) {
      throw new Error(`Final ZIP entry ${safeName} has no generated document source.`);
    }
    if (seenDocumentIds.has(entry.generatedDocId)) {
      throw new Error(`Generated document ${entry.generatedDocId} is included more than once in the final ZIP.`);
    }
    seenDocumentIds.add(entry.generatedDocId);

    if (!Number.isInteger(entry.order) || entry.order <= 0) {
      throw new Error(`Final ZIP entry ${safeName} has an invalid plan order.`);
    }
    if (seenOrders.has(entry.order)) {
      throw new Error(`Final ZIP contains a duplicate plan order: ${entry.order}.`);
    }
    seenOrders.add(entry.order);
    if (!["TECHNICAL", "FINANCIAL", "ADMIN"].includes(entry.envelope)) {
      throw new Error(`Final ZIP entry ${safeName} has an invalid submission envelope.`);
    }
    if (!["DOCX", "PDF", "ZIP", "XLSX", "OTHER"].includes(entry.format)) {
      throw new Error(`Final ZIP entry ${safeName} has an invalid submission format.`);
    }

    const bytes = contentById.get(entry.generatedDocId);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`Final ZIP entry ${safeName} has no document bytes.`);
    }

    // PERF-003: cap the total uncompressed input size before building the
    // archive. The cap is checked incrementally so we reject oversized
    // packages as soon as we cross the threshold rather than waiting until
    // the full ZIP buffer is generated.
    totalInputBytes += bytes.byteLength;
    if (totalInputBytes > FINAL_ZIP_MAX_INPUT_BYTES) {
      const limitMb = Math.floor(FINAL_ZIP_MAX_INPUT_BYTES / (1024 * 1024));
      throw new Error(
        `Final ZIP exceeds the ${limitMb}MB safety cap (PERF-003). Reduce the package size by splitting envelopes or removing non-final documents.`,
      );
    }

    const exactBytes = Buffer.from(bytes);
    zip.file(safeName, exactBytes, { binary: true, createFolders: false });
    fileList.push(safeName);
    manifest.push({
      generatedDocId: entry.generatedDocId,
      filename: safeName,
      order: entry.order,
      envelope: entry.envelope,
      format: entry.format,
      byteLength: exactBytes.length,
      sha256: sha256(exactBytes),
    });
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Final ZIP generation did not produce valid PK archive bytes.");
  }

  // PERF-003: Previously we reopened the generated buffer with
  // `JSZip.loadAsync(buffer, { checkCRC32: true })` and then called
  // `reopenedEntry.async("uint8array")` on every entry. Each pass
  // decompressed every file, producing a ~3x memory multiplier on large
  // packages (input bytes + ZIP buffer + decompressed bytes) and causing
  // OOM risk on Vercel. We now perform a single central-directory-only
  // reopen to verify entry names and order — that reads only the ZIP
  // metadata, never decompressing the file bodies. The non-empty bytes
  // guarantee above already ensures every entry has content.
  let reopened: JSZip;
  try {
    reopened = await JSZip.loadAsync(buffer, { createFolders: false });
  } catch {
    throw new Error("Final ZIP could not be reopened after generation.");
  }

  const reopenedNames = Object.values(reopened.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name);
  if (reopenedNames.length !== fileList.length) {
    throw new Error("Final ZIP entry count does not match the final package manifest.");
  }

  for (let index = 0; index < fileList.length; index += 1) {
    const expectedName = fileList[index];
    if (reopenedNames[index] !== expectedName) {
      throw new Error(`Final ZIP order mismatch at position ${index + 1}: expected ${expectedName}.`);
    }
    const reopenedEntry = reopened.file(expectedName);
    if (!reopenedEntry) throw new Error(`Final ZIP is missing manifest entry ${expectedName}.`);
    // Verify one entry at a time so exact-byte parity is proven without
    // materializing every decompressed entry simultaneously.
    const reopenedBytes = await reopenedEntry.async("nodebuffer");
    const expected = manifest[index];
    if (
      reopenedBytes.length !== expected.byteLength ||
      sha256(reopenedBytes) !== expected.sha256
    ) {
      throw new Error(`Final ZIP exact-byte mismatch for ${expectedName}.`);
    }
  }

  return { buffer, fileList, manifest, packageSha256: sha256(buffer) };
}
