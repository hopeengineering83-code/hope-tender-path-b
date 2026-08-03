import { NextResponse } from "next/server";
import { inspectActualFileBytes } from "../../../../../../../lib/engine/persisted-byte-integrity";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { logAction } from "../../../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { getStorageAdapter } from "../../../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { validateUploadFile } from "../../../../../../../lib/upload-security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extension(value: string): string {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function formatForName(name: string): string {
  const ext = extension(name);
  if (ext === "pdf") return "PDF";
  if (ext === "xlsx") return "XLSX";
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
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = await rateLimitPersistent(`attach-original:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id: tenderId, docId } = await params;
  await prismaReady;
  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tender: { id: tenderId, userId: actor.id } },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, reviewStatus: true, validationStatus: true, storagePath: true, fileContent: true },
  });
  if (!doc) return NextResponse.json({ success: false, ok: false, code: "DOCUMENT_NOT_FOUND", error: "Generated document not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ success: false, ok: false, code: "FILE_REQUIRED", error: "Original file is required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = await validateUploadFile(file, buffer);
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, ok: false, code: "UNSAFE_OR_INVALID_ORIGINAL", error: validation.error },
      { status: buffer.byteLength > 10 * 1024 * 1024 ? 413 : 422 },
    );
  }

  const uploadedName = validation.safeFileName;
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

  const outputName = doc.exactFileName || uploadedName;
  // Pin integrity from the actual bytes BEFORE any storage write. A row must
  // never claim READY_FOR_EXPORT while its persisted integrity cannot verify:
  // the final ZIP read gate (requireVerifiedIntegrity) would dead-end it later
  // with a generic failure, so reject here with the specific reason instead.
  const attachedIntegrity = inspectActualFileBytes({ bytes: buffer, filename: outputName, claimedMimeType: validation.normalizedMime });
  if (attachedIntegrity.integrityStatus !== "VERIFIED") {
    return NextResponse.json({
      success: false,
      ok: false,
      code: attachedIntegrity.integrityFailureCode ?? "ORIGINAL_BYTES_NOT_VERIFIED",
      error: `The uploaded original cannot be byte-verified against the required file name "${outputName}". Correct the required file name or upload a matching format so the final package can verify it.`,
      expectedFileName: doc.exactFileName,
      uploadedFileName: uploadedName,
    }, { status: 422 });
  }
  const stored = await getStorageAdapter().putFile(buffer, {
    fileName: outputName,
    mimeType: validation.normalizedMime,
    tenderId,
  });
  const priorStatus = doc.reviewStatus;
  // Capture the prior storagePath so we can clean up the OLD blob after the
  // transaction commits. Without this, each "attach original" call leaks the
  // previous blob (was silently abandoned — cost leak + PII retention).
  const priorStoragePath = doc.storagePath;
  const priorFileContent = doc.fileContent;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.generatedDocument.update({
        where: { id: doc.id },
        data: {
          name: doc.name || outputName.replace(/\.[a-z0-9]{2,5}$/i, ""),
          exactFileName: outputName,
          format: formatForName(outputName),
          fileContent: stored.fileContent ?? null,
          storagePath: stored.storagePath || null,
          ...attachedIntegrity,
          // Legacy final-ZIP digest columns must describe the same bytes.
          sha256: attachedIntegrity.contentSha256,
          byteSize: attachedIntegrity.contentByteLength,
          generationStatus: "GENERATED",
          // Gap A: attaching an official original is a genuine human release
          // decision (a real person uploads the file), so reviewStatus +
          // reviewedBy + reviewedAt + DocumentReview are legitimate. But
          // validationStatus MUST NOT be fabricated — the canonical Document
          // Validator owns VALIDATED. Set PENDING so the next AUTO_FINALIZE
          // pass runs the validator on the attached bytes.
          validationStatus: "PENDING",
          reviewStatus: "READY_FOR_EXPORT",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNotes: `Official tender-issued original attached: ${uploadedName}. Awaiting canonical Document Validator.`,
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

    // Best-effort cleanup of the OLD blob after the transaction commits.
    if (priorStoragePath || priorFileContent) {
      getStorageAdapter().deleteFile({
        storagePath: priorStoragePath,
        fileContent: priorFileContent,
        fileName: doc.exactFileName ?? doc.name ?? "previous-file",
      }).catch(() => {
        // Non-fatal — the new file is already stored and the DB row is updated.
      });
    }
  } catch (error) {
    await getStorageAdapter().deleteFile({
      storagePath: stored.storagePath,
      fileContent: stored.fileContent,
      fileName: outputName,
    }).catch(() => {});
    throw error;
  }

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_REVIEW",
    entityType: "GeneratedDocument",
    entityId: doc.id,
    description: `${actor.email} attached official original "${uploadedName}" for final export file "${outputName}".`,
    metadata: {
      tenderId,
      documentId: doc.id,
      uploadedFileName: uploadedName,
      exactFileName: outputName,
      mimeType: validation.normalizedMime,
      size: buffer.byteLength,
      action: "ORIGINAL_REQUIRED_FILE_ATTACHED",
    },
  });

  return NextResponse.json({
    success: true,
    ok: true,
    document: {
      id: doc.id,
      exactFileName: outputName,
      format: formatForName(outputName),
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "READY_FOR_EXPORT",
    },
  });
}
