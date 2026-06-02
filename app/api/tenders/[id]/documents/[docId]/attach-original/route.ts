import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { logAction } from "../../../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { getStorageAdapter } from "../../../../../../../lib/storage";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { validateFileSignature } from "../../../../../../../lib/engine/export-format-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["doc", "docx", "pdf", "xls", "xlsx"]);
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "",
]);

function safeName(value: string): string {
  return value.replace(/[\\/\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

function extension(value: string): string {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function canonicalMimeType(name: string, browserMimeType: string): string {
  const ext = extension(name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "xls") return "application/vnd.ms-excel";
  return browserMimeType || "application/octet-stream";
}

function formatForName(name: string): string {
  const ext = extension(name);
  if (ext === "pdf") return "PDF";
  if (ext === "xlsx" || ext === "xls") return "XLSX";
  return "DOCX";
}

function sameRequiredExtension(expected: string | null | undefined, actual: string): boolean {
  const expectedExt = extension(expected ?? "");
  const actualExt = extension(actual);
  if (!expectedExt) return true;
  if (expectedExt === actualExt) return true;
  if (expectedExt === "doc" && actualExt === "docx") return true;
  if (expectedExt === "xls" && actualExt === "xlsx") return true;
  return false;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`attach-original:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id: tenderId, docId } = await params;
  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tender: { id: tenderId, userId: actor.id } },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, reviewStatus: true, validationStatus: true },
  });
  if (!doc) return NextResponse.json({ success: false, ok: false, code: "DOCUMENT_NOT_FOUND", error: "Generated document not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ success: false, ok: false, code: "FILE_REQUIRED", error: "Original file is required" }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ success: false, ok: false, code: "EMPTY_FILE", error: "Original file is empty" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, ok: false, code: "FILE_TOO_LARGE", error: "Original file exceeds 10 MB limit" }, { status: 413 });

  const uploadedName = safeName(file.name || "original-file");
  const uploadedExt = extension(uploadedName);
  const browserMimeType = file.type || "";
  if (!ALLOWED_EXTENSIONS.has(uploadedExt) || !ALLOWED_MIME.has(browserMimeType)) {
    return NextResponse.json({ success: false, ok: false, code: "UNSUPPORTED_FILE_TYPE", error: "Only DOC, DOCX, PDF, XLS, and XLSX originals can be attached" }, { status: 415 });
  }

  if (!sameRequiredExtension(doc.exactFileName, uploadedName)) {
    return NextResponse.json({
      success: false,
      ok: false,
      code: "ORIGINAL_EXTENSION_MISMATCH",
      error: `Uploaded original extension does not match the required file name (${doc.exactFileName ?? "unspecified"}).`,
      expectedFileName: doc.exactFileName,
      uploadedFileName: uploadedName,
    }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const outputName = doc.exactFileName || uploadedName;
  const mimeType = canonicalMimeType(outputName, browserMimeType);
  const sig = validateFileSignature(outputName, base64);
  if (!sig.ok) {
    return NextResponse.json({ success: false, ok: false, code: "FILE_SIGNATURE_MISMATCH", error: sig.reason }, { status: 422 });
  }

  const stored = await getStorageAdapter().putFile(buffer, { fileName: outputName, mimeType, tenderId });
  const priorStatus = doc.reviewStatus;
  await prisma.$transaction(async (tx) => {
    await tx.generatedDocument.update({
      where: { id: doc.id },
      data: {
        name: doc.name || outputName.replace(/\.[a-z0-9]{2,5}$/i, ""),
        exactFileName: outputName,
        format: formatForName(outputName),
        fileContent: stored.fileContent ?? null,
        storagePath: stored.storagePath || null,
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNotes: `Official tender-issued original attached: ${uploadedName}.`,
        contentSummary: `Official tender-issued original attached for ${outputName}. This file was uploaded by a reviewer and was not regenerated by AI.`,
        updatedAt: new Date(),
      },
    });
    await tx.documentReview.create({
      data: {
        documentId: doc.id,
        reviewerId: actor.id,
        action: "READY_FOR_EXPORT",
        priorStatus,
        newStatus: "READY_FOR_EXPORT",
        notes: `Attached official tender-issued original file: ${uploadedName}.`,
      },
    });
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_REVIEW",
    entityType: "GeneratedDocument",
    entityId: doc.id,
    description: `${actor.email} attached official original "${uploadedName}" for final export file "${outputName}".`,
    metadata: { tenderId, documentId: doc.id, uploadedFileName: uploadedName, exactFileName: outputName, mimeType, size: file.size, action: "ORIGINAL_REQUIRED_FILE_ATTACHED" },
  });

  return NextResponse.json({
    success: true,
    ok: true,
    document: {
      id: doc.id,
      exactFileName: outputName,
      format: formatForName(outputName),
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
    },
  });
}
