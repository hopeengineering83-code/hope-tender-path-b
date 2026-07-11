import { readGeneratedDocumentContent } from "../generated-document-content";
import { validateFileSignature } from "./export-format-policy";
import type { ExportReadyDocument, ExportReadinessFailure } from "./export-readiness";

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function documentFileName(doc: ExportReadyDocument): string {
  return doc.exactFileName ?? generatedFileName(doc.name);
}

export async function checkExportFileByteReadiness(docs: ExportReadyDocument[]): Promise<ExportReadinessFailure[]> {
  const failures: ExportReadinessFailure[] = [];

  for (const doc of docs) {
    const fileName = documentFileName(doc);
    const reasons: string[] = [];

    if (!doc.fileContent && !doc.storagePath) {
      reasons.push("MISSING_FILE_BYTES: document has neither inline file content nor storage-backed bytes.");
    } else {
      try {
        const content = await readGeneratedDocumentContent(doc, { requireVerifiedIntegrity: true });
        if (!content.buffer || content.buffer.byteLength === 0) {
          reasons.push("EMPTY_FILE_BYTES: final export file is empty.");
        } else {
          const signature = validateFileSignature(content.filename, content.base64);
          if (!signature.ok) reasons.push(`FILE_SIGNATURE_MISMATCH: ${signature.reason}`);
        }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "STORAGE_BYTES_UNAVAILABLE";
        reasons.push(`FILE_BYTES_NOT_VERIFIED: ${code}`);
      }
    }

    if (reasons.length > 0) {
      failures.push({ documentId: doc.id, name: doc.name, fileName, reasons });
    }
  }

  return failures;
}
