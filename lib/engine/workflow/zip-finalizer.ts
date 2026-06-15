import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { isFinalExportCandidateDocument } from "../document-output-state";

export type ZipFinalizerResult = {
  ok: boolean;
  buffer?: Buffer;
  error?: string;
  code?: string;
  fileList?: string[];
};

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

  const zip = new JSZip();
  const fileList: string[] = [];
  const seenNames = new Set<string>();

  for (const doc of docs) {
    const fileName = doc.exactFileName || doc.name || `document-${doc.id}.docx`;

    // Path traversal protection
    if (fileName.includes("..") || fileName.startsWith("/")) {
        return { ok: false, error: `Invalid filename: ${fileName}`, code: "INVALID_FILENAME" };
    }

    if (seenNames.has(fileName.toLowerCase())) {
        return { ok: false, error: `Duplicate filename in ZIP: ${fileName}`, code: "DUPLICATE_FILENAME" };
    }
    seenNames.add(fileName.toLowerCase());

    const content = doc.fileContent;
    if (!content || content.length === 0) {
        return { ok: false, error: `Document ${fileName} has no content`, code: "EMPTY_DOCUMENT" };
    }

    zip.file(fileName, content);
    fileList.push(fileName);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Basic CRC validation simulated by re-opening
  try {
    await JSZip.loadAsync(buffer);
  } catch (err) {
    return { ok: false, error: "ZIP generation failed CRC validation", code: "ZIP_CORRUPT" };
  }

  return { ok: true, buffer, fileList };
}
