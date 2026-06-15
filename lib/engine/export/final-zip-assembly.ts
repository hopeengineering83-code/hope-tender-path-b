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

/**
 * Assemble the already-scoped final submission entries into a real ZIP.
 * Scope, order and names come exclusively from buildFinalZipEntries; this
 * helper refuses silent overwrites or missing document bytes.
 */
export async function assembleFinalSubmissionZip(
  entries: ZipEntry[],
  contents: FinalZipDocumentContent[],
): Promise<FinalZipAssemblyResult> {
  if (entries.length === 0) throw new Error("Final ZIP has no scoped entries.");

  const contentById = new Map(contents.map((item) => [item.generatedDocId, item.bytes]));
  const seen = new Set<string>();
  const zip = new JSZip();
  const fileList: string[] = [];

  for (const entry of entries) {
    const normalizedName = entry.name.trim().toLocaleLowerCase();
    if (!normalizedName) throw new Error("Final ZIP contains an empty filename.");
    if (seen.has(normalizedName)) throw new Error(`Duplicate filename in final ZIP: ${entry.name}`);
    seen.add(normalizedName);

    if (!entry.generatedDocId) throw new Error(`Final ZIP entry ${entry.name} has no generated document source.`);
    const bytes = contentById.get(entry.generatedDocId);
    if (!bytes || bytes.byteLength === 0) throw new Error(`Final ZIP entry ${entry.name} has no document bytes.`);

    zip.file(entry.name, bytes);
    fileList.push(entry.name);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Final ZIP generation did not produce valid PK archive bytes.");
  }

  return { buffer, fileList };
}
