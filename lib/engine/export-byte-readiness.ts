import { readGeneratedDocumentContent } from "../generated-document-content";
import { validateFileSignature } from "./export-format-policy";
import { resolveArtifactIdentity } from "./artifact-identity";
import type { ExportReadyDocument, ExportReadinessFailure } from "./export-readiness";

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function documentFileName(doc: ExportReadyDocument): string {
  return doc.exactFileName ?? generatedFileName(doc.name);
}

/**
 * @param requireBytes When true a document with no bytes at all is a failure.
 *   When false such a document is simply not byte-checked — but a document
 *   that DOES carry bytes is still checked, which is the whole point:
 *   checkFullExportReadiness used to skip this entire function unless the
 *   caller passed requireFileContent, and auto-finalize's runCanonicalValidation
 *   SELECTS fileContent yet passes false. So the one pass that decides
 *   VALIDATED never looked at the bytes it had loaded, and a .pdf holding DOCX
 *   bytes was marked VALIDATED and became export-ready.
 */
export async function checkExportFileByteReadiness(
  docs: ExportReadyDocument[],
  requireBytes = true,
): Promise<ExportReadinessFailure[]> {
  const failures: ExportReadinessFailure[] = [];

  for (const doc of docs) {
    const fileName = documentFileName(doc);
    const reasons: string[] = [];

    if (!doc.fileContent && !doc.storagePath) {
      // Metadata-only selections legitimately carry no bytes. Reporting
      // MISSING_FILE_BYTES for them refused packages on evidence that was
      // never fetched; the label checks below still run on what IS present.
      if (requireBytes) {
        reasons.push("MISSING_FILE_BYTES: document has neither inline file content nor storage-backed bytes.");
      } else {
        const labels = resolveArtifactIdentity({
          fileName,
          format: doc.format,
          detectedFormat: (doc as { detectedFormat?: string | null }).detectedFormat ?? null,
          integrityStatus: (doc as { integrityStatus?: string | null }).integrityStatus ?? null,
          contentMimeType: (doc as { contentMimeType?: string | null }).contentMimeType ?? null,
        });
        if (!labels.agrees) reasons.push(`${labels.code}: ${labels.reason}`);
      }
    } else {
      try {
        const content = await readGeneratedDocumentContent(doc, { requireVerifiedIntegrity: true });
        if (!content.buffer || content.buffer.byteLength === 0) {
          reasons.push("EMPTY_FILE_BYTES: final export file is empty.");
        } else {
          const signature = validateFileSignature(content.filename, content.base64);
          if (!signature.ok) reasons.push(`FILE_SIGNATURE_MISMATCH: ${signature.reason}`);
          // Canonical identity: extension, DECLARED format, claimed MIME and
          // the bytes must all agree. validateFileSignature compares the
          // extension against the bytes only, so "named .pdf, declared DOCX"
          // was invisible to it.
          const identity = resolveArtifactIdentity({
            fileName: content.filename,
            format: doc.format,
            contentMimeType: (doc as { contentMimeType?: string | null }).contentMimeType ?? null,
            bytes: content.buffer,
          });
          if (!identity.agrees && identity.code !== "FILE_SIGNATURE_MISMATCH") {
            reasons.push(`${identity.code}: ${identity.reason}`);
          }
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
