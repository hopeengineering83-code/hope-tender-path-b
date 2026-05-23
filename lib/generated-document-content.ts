import { prisma } from "./prisma";
import { getStorageAdapter } from "./storage";

export type GeneratedContentSource = "storage" | "legacy";

type GeneratedDocumentContentLike = {
  id: string;
  name: string;
  exactFileName?: string | null;
  storagePath?: string | null;
  fileContent?: string | null;
};

function normalizeGeneratedFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${cleaned || "generated-document"}.docx`;
}

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

export async function readGeneratedDocumentContent(
  doc: GeneratedDocumentContentLike,
): Promise<{ buffer: Buffer; base64: string; filename: string; mimeType: string; source: GeneratedContentSource }> {
  const filename = doc.exactFileName ?? normalizeGeneratedFileName(doc.name);
  const mimeType = inferMimeType(filename);

  if (doc.storagePath) {
    try {
      const adapter = getStorageAdapter();
      const buffer = await adapter.getFile({
        storagePath: doc.storagePath,
        fileContent: doc.fileContent ?? null,
        fileName: filename,
      });
      return { buffer, base64: buffer.toString("base64"), filename, mimeType, source: "storage" };
    } catch {
      // Storage read failed — fall through to legacy fileContent if available
    }
  }

  if (doc.fileContent) {
    const buffer = Buffer.from(doc.fileContent, "base64");
    return { buffer, base64: doc.fileContent, filename, mimeType, source: "legacy" };
  }

  throw new Error(`Generated document ${doc.id} has neither storagePath nor fileContent`);
}

export function generatedDocumentHasContent(doc: {
  storagePath?: string | null;
  fileContent?: string | null;
}): boolean {
  return Boolean((doc.storagePath && doc.storagePath.length > 0) || (doc.fileContent && doc.fileContent.length > 0));
}

export async function writeGeneratedDocumentContent(docId: string, buffer: Buffer, filename: string, mimeType: string) {
  const adapter = getStorageAdapter();
  const saved = await adapter.putFile(buffer, { fileName: filename, mimeType });
  await prisma.generatedDocument.update({
    where: { id: docId },
    data: {
      storagePath: saved.storagePath,
      fileContent: saved.fileContent ?? null,
      exactFileName: filename,
    },
  });
  return { ...saved, bytes: buffer.byteLength };
}
