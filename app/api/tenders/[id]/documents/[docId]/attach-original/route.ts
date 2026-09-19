// Attach the official original for a tender-required file the app must not
// invent.
//
// WHY THIS ROUTE EXISTS
// ---------------------
// Some tender-required files can only come from the owner: a priced financial
// proposal, a tender-issued form that must be submitted on the issuer's own
// template. The app deliberately refuses to fabricate those, plans the row as
// PLANNED / REPLACE_WITH_ORIGINAL, and the export gate then blocks until the
// file exists.
//
// Nothing could satisfy that block. Across the whole API, no route accepted a
// file upload that wrote GeneratedDocument.fileContent — the only multipart
// endpoints were login, company assets and the Plan-B import, none of which
// touch generated documents. A two-envelope tender was therefore unfinishable
// by construction: export required 02-Financial-Proposal.docx, generation
// correctly declined to invent it, and the owner had nowhere to put the real
// one.
//
// The upload is held to the same standards as anything else that reaches a
// final package: tenant scoping, the plan's own file name, a real file
// signature, a size cap, and recorded byte integrity. Attaching an original
// never marks it approved — it lands validated-pending and review-pending, so
// the existing validation and review gates still have to pass on the real
// bytes.

import { NextResponse } from "next/server";
import { logger } from "../../../../../../../lib/observability";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { logAction } from "../../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { validateFileSignature } from "../../../../../../../lib/engine/export-format-policy";
import { verifiedIntegrityDataFromBase64 } from "../../../../../../../lib/engine/persisted-byte-integrity";

export const dynamic = "force-dynamic";

/**
 * Matches the final-ZIP input cap so a file that can be attached can be
 * packaged. Not exported: Next.js route modules may only export route handlers
 * and the framework's own config keys.
 */
const ATTACH_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

function err(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, ok: false, error: message, message, ...extra }, { status });
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const limit = await rateLimitPersistent(`attach-original:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { success: false, error: "Too many upload requests. Wait and retry.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId, docId } = await params;

  // Tenant scoping: the document is reached through a tender this actor owns,
  // never by document id alone.
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true, title: true } });
  if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

  const document = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
    select: {
      id: true,
      name: true,
      exactFileName: true,
      documentType: true,
      generationStatus: true,
      reviewStatus: true,
    },
  });
  if (!document) return err("Document not found on this tender.", 404, { code: "DOCUMENT_NOT_FOUND" });

  // Only a row that is actually awaiting an original may be filled this way.
  // Anything else would let an upload silently replace generated, validated
  // bytes without going back through generation.
  const awaitingOriginal = document.generationStatus === "PLANNED"
    || document.reviewStatus === "REPLACE_WITH_ORIGINAL";
  if (!awaitingOriginal) {
    return err(
      `"${document.exactFileName ?? document.name}" is not awaiting an official original (generationStatus=${document.generationStatus}, reviewStatus=${document.reviewStatus}). Only PLANNED or REPLACE_WITH_ORIGINAL rows accept an upload.`,
      409,
      { code: "DOCUMENT_NOT_AWAITING_ORIGINAL", generationStatus: document.generationStatus, reviewStatus: document.reviewStatus },
    );
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return err("Request body must be multipart/form-data with a 'file' field.", 400, { code: "INVALID_FORM_DATA" }); }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return err("No file provided. Send the original as multipart/form-data field 'file'.", 400, { code: "NO_FILE" });
  }
  if (file.size === 0) return err("The uploaded file is empty.", 400, { code: "EMPTY_FILE" });
  if (file.size > ATTACH_ORIGINAL_MAX_BYTES) {
    return err(
      `The original must not exceed ${Math.floor(ATTACH_ORIGINAL_MAX_BYTES / (1024 * 1024))} MB.`,
      413,
      { code: "FILE_TOO_LARGE", maxBytes: ATTACH_ORIGINAL_MAX_BYTES, actualBytes: file.size },
    );
  }

  // The plan's file name is authoritative. An original uploaded under a
  // different name would be packaged under the plan name anyway, so a mismatch
  // is reported rather than silently renamed.
  const targetName = document.exactFileName ?? document.name ?? "";
  const uploadedName = typeof (file as File).name === "string" ? (file as File).name : "";
  if (targetName && uploadedName && normalizeName(uploadedName) !== normalizeName(targetName)) {
    return err(
      `This slot expects "${targetName}" but the uploaded file is named "${uploadedName}". Rename the file to the tender-required name before attaching it.`,
      422,
      { code: "FILE_NAME_MISMATCH", expected: targetName, received: uploadedName },
    );
  }

  const fileContent = Buffer.from(await file.arrayBuffer()).toString("base64");

  // The bytes must actually be what the name claims. A .docx that is not an
  // Office package would otherwise reach the ZIP and fail in the buyer's hands.
  const signature = validateFileSignature(targetName || uploadedName, fileContent);
  if (!signature.ok) {
    return err(`Uploaded file rejected: ${signature.reason}`, 422, { code: "FILE_SIGNATURE_INVALID" });
  }

  const integrity = verifiedIntegrityDataFromBase64({
    fileContent,
    filename: targetName || uploadedName,
    claimedMimeType: (file as File).type || null,
  });

  // The placeholder row was created with format "CONTROL" — an internal
  // control record, which downstream classifiers correctly refuse to package.
  // Now that real bytes are attached the row is no longer a control record, so
  // the format has to follow the bytes. Leaving it CONTROL kept the file out of
  // the package and the export gate still reporting it missing, even though it
  // was sitting right there.
  const attachedFormat = signature.detected.toUpperCase();

  const updated = await prisma.generatedDocument.update({
    where: { id: document.id },
    data: {
      fileContent,
      ...integrity,
      format: attachedFormat,
      generationStatus: "GENERATED",
      // Deliberately NOT approved. The original still has to clear validation
      // and reviewer approval on its real bytes, exactly like generated output.
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      contentSummary: `Official original attached for tender-required file ${targetName || uploadedName}. Awaiting validation and reviewer approval.`,
      integrityFailureCode: null,
      updatedAt: new Date(),
    },
    select: { id: true, exactFileName: true, format: true, contentSha256: true, contentByteLength: true, detectedFormat: true },
  });

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "GeneratedDocument",
    entityId: document.id,
    description: `${actor.email} attached the official original for "${targetName || uploadedName}" on "${tender.title}" (${file.size} bytes).`,
    metadata: {
      operation: "ATTACH_ORIGINAL",
      tenderId,
      documentId: document.id,
      exactFileName: targetName,
      byteLength: updated.contentByteLength,
      contentSha256: updated.contentSha256,
      detectedFormat: updated.detectedFormat,
    },
  }).catch((e) => logger.warn(`[attach-original] audit log failed: ${e instanceof Error ? e.message : String(e)}`));

  return NextResponse.json({
    success: true,
    ok: true,
    document: {
      id: updated.id,
      exactFileName: updated.exactFileName,
      contentSha256: updated.contentSha256,
      contentByteLength: updated.contentByteLength,
      format: updated.format,
      detectedFormat: updated.detectedFormat,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
    },
    nextAction: "VALIDATE_AND_REVIEW",
    message: "Original attached. It must still pass validation and reviewer approval before export.",
  });
}
