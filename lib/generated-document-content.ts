import { prisma } from "./prisma";
import { getStorageAdapter } from "./storage";
import { inspectActualFileBytes, requireVerifiedPersistedFileBytes } from "./engine/persisted-byte-integrity";
import { markBufferCanonicallyVerified } from "./engine/file-byte-integrity";

export type GeneratedContentSource = "storage" | "legacy";

type GeneratedDocumentContentLike = {
  id: string;
  name: string;
  exactFileName?: string | null;
  storagePath?: string | null;
  fileContent?: string | null;
  contentSha256?: string | null;
  contentByteLength?: number | null;
  contentMimeType?: string | null;
  detectedFormat?: string | null;
  integrityStatus?: string | null;
};

function normalizeGeneratedFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${cleaned || "generated-document"}.docx`;
}

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

export async function readGeneratedDocumentContent(
  doc: GeneratedDocumentContentLike,
  options: { requireVerifiedIntegrity?: boolean } = {},
): Promise<{ buffer: Buffer; base64: string; filename: string; mimeType: string; source: GeneratedContentSource }> {
  const filename = doc.exactFileName ?? normalizeGeneratedFileName(doc.name);
  const mimeType = inferMimeType(filename);

  const verifyWhenRequired = (buffer: Buffer) => {
    if (!options.requireVerifiedIntegrity) return buffer;
    requireVerifiedPersistedFileBytes({
      bytes: buffer,
      filename,
      claimedMimeType: mimeType,
      persisted: {
        contentSha256: doc.contentSha256 ?? null,
        contentByteLength: doc.contentByteLength ?? null,
        contentMimeType: doc.contentMimeType ?? null,
        detectedFormat: doc.detectedFormat ?? null,
        integrityStatus: doc.integrityStatus ?? "UNKNOWN",
      },
    });
    return markBufferCanonicallyVerified(buffer);
  };

  if (doc.storagePath) {
    try {
      const adapter = getStorageAdapter();
      const buffer = await adapter.getFile({
        storagePath: doc.storagePath,
        fileContent: doc.fileContent ?? null,
        fileName: filename,
      });
      verifyWhenRequired(buffer);
      return { buffer, base64: buffer.toString("base64"), filename, mimeType, source: "storage" };
    } catch {
      // Storage read failed or storage bytes failed canonical integrity. Fall
      // through only when legacy inline bytes are available; those bytes are
      // independently verified below before they can be returned.
    }
  }

  if (doc.fileContent) {
    const buffer = Buffer.from(doc.fileContent, "base64");
    verifyWhenRequired(buffer);
    return { buffer, base64: doc.fileContent, filename, mimeType, source: "legacy" };
  }

  throw new Error(`Generated document ${doc.id} has neither storagePath nor fileContent`);
}

export function generatedDocumentHasContent(doc: {
  storagePath?: string | null;
  fileContent?: string | null;
}): boolean {
  return Boolean((doc.storagePath && doc.storagePath.trim().length > 0) || (doc.fileContent && doc.fileContent.trim().length > 0));
}

export async function writeGeneratedDocumentContent(docId: string, buffer: Buffer, filename: string, mimeType: string) {
  const integrity = inspectActualFileBytes({ bytes: buffer, filename, claimedMimeType: mimeType });
  if (integrity.integrityStatus !== "VERIFIED") {
    throw new Error(integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED");
  }
  const adapter = getStorageAdapter();
  const saved = await adapter.putFile(buffer, { fileName: filename, mimeType });
  await prisma.generatedDocument.update({
    where: { id: docId },
    data: {
      storagePath: saved.storagePath,
      fileContent: saved.fileContent ?? null,
      exactFileName: filename,
      contentSha256: integrity.contentSha256,
      contentByteLength: integrity.contentByteLength,
      contentMimeType: integrity.contentMimeType,
      detectedFormat: integrity.detectedFormat,
      integrityStatus: integrity.integrityStatus,
      integrityVerifiedAt: integrity.integrityVerifiedAt,
      integrityFailureCode: integrity.integrityFailureCode,
    },
  });
  return { ...saved, bytes: buffer.byteLength };
}
