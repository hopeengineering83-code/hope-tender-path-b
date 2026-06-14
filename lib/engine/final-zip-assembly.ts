import JSZip from "jszip";
import type { ZipEntry } from "./final-zip-scope";

export type FinalZipDocumentContent = {
  generatedDocId: string;
  bytes: Buffer | Uint8Array;
};

export type FinalZipAssemblyResult = {
  buffer: Buffer;
  fileList: string[];
};

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
  const zip = new JSZip();
  const fileList: string[] = [];

  for (const entry of entries) {
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

    const bytes = contentById.get(entry.generatedDocId);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`Final ZIP entry ${safeName} has no document bytes.`);
    }

    zip.file(safeName, bytes, { binary: true, createFolders: false });
    fileList.push(safeName);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Final ZIP generation did not produce valid PK archive bytes.");
  }

  let reopened: JSZip;
  try {
    reopened = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
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
    const reopenedBytes = await reopenedEntry.async("uint8array");
    if (reopenedBytes.byteLength === 0) {
      throw new Error(`Final ZIP contains an empty entry: ${expectedName}`);
    }
  }

  return { buffer, fileList };
}
