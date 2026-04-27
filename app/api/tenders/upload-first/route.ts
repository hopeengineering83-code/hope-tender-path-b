import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { logAction } from "../../../../lib/audit";
import { inferTenderMetadata } from "../../../../lib/engine/tender-metadata";
import { runTenderEngine } from "../../../../lib/engine/run-tender-engine";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "Upload at least one tender document" }, { status: 400 });

    const extracted: Array<{
      file: File;
      base64Content: string;
      mimeType: string;
      fileTypeLabel: string;
      extractedText: string;
      meaningful: boolean;
    }> = [];
    const errors: string[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        errors.push(`${file.name}: exceeds 10 MB limit`);
        continue;
      }
      const mimeType = file.type || "application/octet-stream";
      if (!ALLOWED_MIME.has(mimeType)) {
        errors.push(`${file.name}: unsupported file type ${mimeType}`);
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await extractTextFromBuffer(buffer, mimeType, file.name);
      const meaningful = isMeaningfulExtraction(extractedText);
      extracted.push({ file, base64Content: buffer.toString("base64"), mimeType, fileTypeLabel: getFileTypeLabel(mimeType, file.name), extractedText, meaningful });
    }

    const usable = extracted.filter((x) => x.meaningful);
    if (usable.length === 0) {
      return NextResponse.json({ error: "No usable tender text extracted", errors }, { status: 422 });
    }

    const combinedText = usable.map((x) => `FILE: ${x.file.name}\n${x.extractedText}`).join("\n\n--- NEXT TENDER FILE ---\n\n");
    const metadata = inferTenderMetadata(combinedText, usable[0].file.name);
    const titleOverride = String(form.get("title") || "").trim();
    const refOverride = String(form.get("reference") || "").trim();

    const tender = await prisma.tender.create({
      data: {
        id: crypto.randomUUID(),
        title: titleOverride || metadata.title,
        description: metadata.description,
        reference: refOverride || metadata.reference,
        clientName: metadata.clientName,
        category: metadata.category,
        country: metadata.country,
        currency: "USD",
        deadline: metadata.deadline,
        submissionMethod: metadata.submissionMethod,
        submissionAddress: metadata.submissionAddress,
        intakeSummary: metadata.intakeSummary,
        notes: `Created by upload-first tender intake from ${usable.length} extracted file(s).`,
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        userId,
      },
    });

    for (const item of extracted) {
      const fileRecord = await prisma.tenderFile.create({
        data: {
          tenderId: tender.id,
          fileName: item.file.name,
          originalFileName: item.file.name,
          mimeType: item.mimeType,
          size: item.file.size,
          storagePath: "",
          fileContent: item.base64Content,
          classification: "Tender Document",
          extractedText: item.extractedText || null,
        },
      });
      await logAction({
        userId,
        action: "TENDER_FILE_UPLOAD",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        description: `Upload-first tender intake uploaded ${item.fileTypeLabel} "${item.file.name}" — ${item.meaningful ? `${item.extractedText.length.toLocaleString()} chars extracted` : "no usable text"}`,
        metadata: { tenderId: tender.id, fileName: item.file.name, extracted: item.meaningful, extractedChars: item.meaningful ? item.extractedText.length : 0 },
      });
    }

    let engineResult: unknown = null;
    let engineError: string | null = null;
    try {
      engineResult = await runTenderEngine(tender.id, userId);
      await logAction({
        userId,
        action: "TENDER_ANALYSIS_RUN",
        entityType: "Tender",
        entityId: tender.id,
        description: `Upload-first tender intake auto-ran engine for "${tender.title}"`,
        metadata: { files: usable.length },
      });
    } catch (err) {
      engineError = err instanceof Error ? err.message : String(err);
      console.error("[upload-first tender] engine failed:", err);
    }

    return NextResponse.json({
      success: true,
      tenderId: tender.id,
      tender: engineResult ?? tender,
      extractedFiles: usable.length,
      skippedFiles: extracted.length - usable.length,
      metadata,
      errors,
      engineError,
    }, { status: 201 });
  } catch (error) {
    console.error("[upload-first tender] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload-first tender intake failed" }, { status: 500 });
  }
}
