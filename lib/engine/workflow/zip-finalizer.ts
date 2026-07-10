/**
 * Workflow ZIP finalization helper.
 *
 * The CANONICAL final-package path is the download route's zipPackage (which
 * layers the central gate, canonical readiness, operation gate, quality
 * validation, authority review, format coverage, and manifest verification
 * on top of assembleFinalSubmissionZip). This helper exists for workflow
 * callers and enforces the same per-document invariants so it can never be
 * used as a weaker side door:
 *
 *   • only active final-export candidate documents are packaged,
 *   • every document must be GENERATED + validated + approved
 *     (isReadyForFinalExport — identical rule to the canonical path),
 *   • every document's bytes must match its extension's file signature
 *     (a DOCX renamed to .pdf can never enter the ZIP),
 *   • unsafe paths, duplicate names, and empty content fail closed,
 *   • the generated archive is reopened to verify integrity.
 */
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { isFinalExportCandidateDocument } from "../document-output-state";
import { isReadyForFinalExport, type ExportReadyDocument } from "../export-readiness";
import { validateFileSignature } from "../export-format-policy";

export type ZipFinalizerResult = {
  ok: boolean;
  buffer?: Buffer;
  error?: string;
  code?: string;
  fileList?: string[];
};

/** Normalize inline content (string base64 or legacy Buffer/Uint8Array) to base64. */
function toBase64Content(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  if (Buffer.isBuffer(value)) return value.length > 0 ? value.toString("base64") : null;
  if (value instanceof Uint8Array) return value.length > 0 ? Buffer.from(value).toString("base64") : null;
  return null;
}

export async function finalizeTenderZip(
  prisma: PrismaClient,
  tenderId: string,
  userId: string
): Promise<ZipFinalizerResult> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      generatedDocuments: {
        where: { generationStatus: "GENERATED" }
      }
    }
  });

  if (!tender) return { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" };

  const docs = tender.generatedDocuments.filter(doc => isFinalExportCandidateDocument(doc as any));
  if (docs.length === 0) return { ok: false, error: "No documents ready for export", code: "NO_DOCUMENTS" };

  // First pass: structural safety — name safety, duplicates, content presence.
  const seenNames = new Set<string>();
  const prepared: Array<{ fileName: string; base64: string; doc: (typeof docs)[number] }> = [];
  for (const doc of docs) {
    const fileName = doc.exactFileName || doc.name || `document-${doc.id}.docx`;

    // Path traversal protection
    if (fileName.includes("..") || fileName.startsWith("/") || fileName.includes("\\")) {
        return { ok: false, error: `Invalid filename: ${fileName}`, code: "INVALID_FILENAME" };
    }

    if (seenNames.has(fileName.toLowerCase())) {
        return { ok: false, error: `Duplicate filename in ZIP: ${fileName}`, code: "DUPLICATE_FILENAME" };
    }
    seenNames.add(fileName.toLowerCase());

    const base64 = toBase64Content(doc.fileContent);
    if (!base64) {
        return { ok: false, error: `Document ${fileName} has no content`, code: "EMPTY_DOCUMENT" };
    }
    prepared.push({ fileName, base64, doc });
  }

  // Second pass: per-document export invariants — the same rules the
  // canonical download route enforces. A document that is not validated +
  // approved, or whose bytes do not match its extension's signature, must
  // never reach a final ZIP through this helper either.
  for (const item of prepared) {
    const ready: ExportReadyDocument = {
      id: String(item.doc.id),
      name: String(item.doc.name ?? item.fileName),
      exactFileName: item.doc.exactFileName ?? null,
      documentType: (item.doc as { documentType?: string | null }).documentType ?? null,
      format: (item.doc as { format?: string | null }).format ?? null,
      generationStatus: String(item.doc.generationStatus ?? ""),
      validationStatus: String((item.doc as { validationStatus?: string | null }).validationStatus ?? ""),
      reviewStatus: String((item.doc as { reviewStatus?: string | null }).reviewStatus ?? ""),
      fileContent: item.base64,
      storagePath: (item.doc as { storagePath?: string | null }).storagePath ?? null,
    };
    if (!isReadyForFinalExport(ready)) {
      return { ok: false, error: `Document ${item.fileName} is not validated and approved for export`, code: "NOT_EXPORT_READY" };
    }
    const sig = validateFileSignature(item.fileName, item.base64);
    if (!sig.ok) {
      return { ok: false, error: `File signature mismatch on ${item.fileName}`, code: "FILE_SIGNATURE_MISMATCH" };
    }
  }

  const zip = new JSZip();
  const fileList: string[] = [];
  for (const item of prepared) {
    zip.file(item.fileName, Buffer.from(item.base64, "base64"));
    fileList.push(item.fileName);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Basic CRC validation simulated by re-opening
  try {
    await JSZip.loadAsync(buffer);
  } catch {
    return { ok: false, error: "ZIP generation failed CRC validation", code: "ZIP_CORRUPT" };
  }

  return { ok: true, buffer, fileList };
}
