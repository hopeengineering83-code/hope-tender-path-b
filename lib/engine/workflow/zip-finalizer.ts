/**
 * Fail-closed workflow ZIP finalizer.
 *
 * This helper is not allowed to be a weaker side door around the canonical
 * download route. It applies the central final-export gate, reads the actual
 * stored bytes, requires persisted integrity, validates signatures and
 * approval state, builds a manifest from those exact bytes, then reopens the
 * archive and verifies exact-byte parity.
 */
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { readGeneratedDocumentContent } from "../../generated-document-content";
import { assertTenderReadyForGenerationAndExport } from "../generation-readiness-gate";
import { isFinalExportCandidateDocument } from "../document-output-state";
import { isReadyForFinalExport, type ExportReadyDocument } from "../export-readiness";
import { validateFileSignature } from "../export-format-policy";
import {
  computeFileHash,
  validatePackageManifest,
  type ManifestValidationItem,
} from "../generated-file-integrity";

export type ZipFinalizerResult = {
  ok: boolean;
  buffer?: Buffer;
  error?: string;
  code?: string;
  fileList?: string[];
  manifest?: ManifestValidationItem[];
};

function asExportReadyDocument(doc: Record<string, unknown>): ExportReadyDocument {
  return {
    id: String(doc.id),
    name: String(doc.name ?? doc.exactFileName ?? doc.id),
    exactFileName: typeof doc.exactFileName === "string" ? doc.exactFileName : null,
    exactOrder: typeof doc.exactOrder === "number" ? doc.exactOrder : null,
    documentType: typeof doc.documentType === "string" ? doc.documentType : null,
    format: typeof doc.format === "string" ? doc.format : null,
    generationStatus: String(doc.generationStatus ?? ""),
    validationStatus: String(doc.validationStatus ?? ""),
    reviewStatus: String(doc.reviewStatus ?? ""),
    fileContent: typeof doc.fileContent === "string" ? doc.fileContent : null,
    storagePath: typeof doc.storagePath === "string" ? doc.storagePath : null,
    contentSha256: typeof doc.contentSha256 === "string" ? doc.contentSha256 : null,
    contentByteLength: typeof doc.contentByteLength === "number" ? doc.contentByteLength : null,
    contentMimeType: typeof doc.contentMimeType === "string" ? doc.contentMimeType : null,
    detectedFormat: typeof doc.detectedFormat === "string" ? doc.detectedFormat : null,
    integrityStatus: typeof doc.integrityStatus === "string" ? doc.integrityStatus : "UNKNOWN",
    integrityVerifiedAt: doc.integrityVerifiedAt instanceof Date ? doc.integrityVerifiedAt : null,
    integrityFailureCode: typeof doc.integrityFailureCode === "string" ? doc.integrityFailureCode : null,
  };
}

function safeZipName(value: string): boolean {
  return Boolean(value.trim()) &&
    !value.includes("..") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":");
}

export async function finalizeApprovedDocumentsZip(
  docs: ExportReadyDocument[],
): Promise<ZipFinalizerResult> {
  if (docs.length === 0) {
    return { ok: false, error: "No documents ready for export", code: "NO_DOCUMENTS" };
  }

  const seen = new Set<string>();
  const prepared: Array<{
    doc: ExportReadyDocument;
    fileName: string;
    bytes: Buffer;
    mimeType: string;
    sha256: string;
    order: number;
  }> = [];

  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];
    const fileName = doc.exactFileName ?? doc.name;
    const normalized = fileName.trim().toLowerCase();
    if (!safeZipName(fileName)) {
      return { ok: false, error: "Final ZIP contains an invalid filename.", code: "INVALID_FILENAME" };
    }
    if (seen.has(normalized)) {
      return { ok: false, error: "Final ZIP contains duplicate filenames.", code: "DUPLICATE_FILENAME" };
    }
    seen.add(normalized);
    if (!isReadyForFinalExport(doc)) {
      return {
        ok: false,
        error: "A document is not validated and approved for export.",
        code: "NOT_EXPORT_READY",
      };
    }

    try {
      const content = await readGeneratedDocumentContent(doc, {
        requireVerifiedIntegrity: true,
      });
      const signature = validateFileSignature(fileName, content.base64);
      if (!signature.ok) {
        return {
          ok: false,
          error: "A document byte signature does not match its required format.",
          code: "FILE_SIGNATURE_MISMATCH",
        };
      }
      prepared.push({
        doc,
        fileName,
        bytes: content.buffer,
        mimeType: content.mimeType,
        sha256: computeFileHash(content.buffer),
        order: doc.exactOrder ?? index + 1,
      });
    } catch (error) {
      return {
        ok: false,
        error: "A document is missing or its persisted byte integrity is not verified.",
        code:
          error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "FILE_BYTES_NOT_VERIFIED",
      };
    }
  }

  prepared.sort((left, right) => left.order - right.order || left.fileName.localeCompare(right.fileName));
  const manifest: ManifestValidationItem[] = prepared.map((item) => ({
    documentId: item.doc.id,
    filename: item.fileName,
    required: true,
    source: "generated",
    mimeType: item.mimeType,
    byteSize: item.bytes.length,
    sha256: item.sha256,
    order: item.order,
    valid: true,
  }));
  const manifestValidation = validatePackageManifest(manifest, { requireAllRequired: true });
  if (!manifestValidation.ok) {
    return {
      ok: false,
      error: "Final ZIP manifest verification failed.",
      code: "FINAL_ZIP_MANIFEST_INVALID",
      manifest,
    };
  }

  const zip = new JSZip();
  for (const item of prepared) zip.file(item.fileName, item.bytes);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  try {
    const reopened = await JSZip.loadAsync(buffer);
    const actualNames = Object.keys(reopened.files).filter((name) => !reopened.files[name].dir);
    if (actualNames.length !== prepared.length) throw new Error("ZIP_ENTRY_COUNT_MISMATCH");
    for (const item of prepared) {
      const entry = reopened.file(item.fileName);
      if (!entry) throw new Error("ZIP_ENTRY_MISSING");
      const bytes = await entry.async("nodebuffer");
      if (bytes.length !== item.bytes.length || computeFileHash(bytes) !== item.sha256) {
        throw new Error("ZIP_ENTRY_BYTE_MISMATCH");
      }
    }
  } catch {
    return {
      ok: false,
      error: "Final ZIP exact-byte verification failed.",
      code: "FINAL_ZIP_EXACT_BYTE_MISMATCH",
      manifest,
    };
  }

  return {
    ok: true,
    buffer,
    fileList: prepared.map((item) => item.fileName),
    manifest,
  };
}

export async function finalizeTenderZip(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<ZipFinalizerResult> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!tender) return { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" };

  const gate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId,
    purpose: "final-zip",
  });
  if (!gate.ok) {
    return {
      ok: false,
      error: "Final ZIP is blocked by release-readiness requirements.",
      code: gate.blockerCode ?? "FINAL_ZIP_NOT_READY",
    };
  }

  const docs = tender.generatedDocuments
    .map((doc) => asExportReadyDocument(doc as unknown as Record<string, unknown>))
    .filter((doc) => isFinalExportCandidateDocument(doc));

  return finalizeApprovedDocumentsZip(docs);
}
