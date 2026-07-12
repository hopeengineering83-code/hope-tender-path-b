import { logger } from "../../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { requireTenderAccess } from "../../../../../../lib/tender-ownership";
import { verifiedIntegrityDataFromBase64 } from "../../../../../../lib/engine/persisted-byte-integrity";
import { writeGeneratedDocumentContent } from "../../../../../../lib/generated-document-content";
import { extractRequestId } from "../../../../../../lib/request-id";
import { logAction } from "../../../../../../lib/audit";

export const dynamic = "force-dynamic";

function restoreFilename(input: {
  name: string;
  exactFileName: string | null;
  format: string | null;
}): string {
  if (input.exactFileName?.trim()) return input.exactFileName.trim();
  const base = input.name
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "Technical-Proposal";
  const format = (input.format ?? "DOCX").trim().toLowerCase();
  const extension = format === "pdf" || format === "xlsx" ? format : "docx";
  return `${base}.${extension}`;
}

function mimeTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const tender = await requireTenderAccess(id, userId, actor?.role ?? "");
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const version = await prisma.proposalVersion.findFirst({
    where: { id: versionId, tenderId: id },
  });
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ version });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const limit = rateLimit(`version-delete:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id, versionId } = await params;
  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await prisma.proposalVersion.deleteMany({ where: { id: versionId, tenderId: id } });
  return NextResponse.json({ success: true });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const limit = rateLimit(`version-restore:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id, versionId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (body.action !== "restore") {
    return NextResponse.json(
      { error: "Unsupported action. Send { action: \"restore\" }." },
      { status: 400 },
    );
  }

  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const version = await prisma.proposalVersion.findFirst({
    where: { id: versionId, tenderId: id },
    select: { id: true, version: true, fileContent: true, summary: true },
  });
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const versionFileContent = version.fileContent?.trim();
  if (!versionFileContent) {
    return NextResponse.json(
      {
        error: "This proposal version has no saved document bytes and cannot be restored.",
        code: "VERSION_BYTES_MISSING",
      },
      { status: 409 },
    );
  }

  const existing = await prisma.generatedDocument.findFirst({
    where: {
      tenderId: id,
      documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL"] },
      generationStatus: { not: "SUPERSEDED" },
    },
    orderBy: { exactOrder: "asc" },
    select: {
      id: true,
      name: true,
      exactFileName: true,
      format: true,
      generationStatus: true,
      updatedAt: true,
    },
  });
  if (!existing) {
    return NextResponse.json(
      {
        error: "No current technical proposal document exists to receive this version.",
        code: "LIVE_PROPOSAL_DOCUMENT_MISSING",
      },
      { status: 409 },
    );
  }
  if (existing.generationStatus === "GENERATING") {
    return NextResponse.json(
      {
        error: "A proposal restore or generation is already in progress. Retry after it completes.",
        code: "RESTORE_IN_PROGRESS",
      },
      { status: 409 },
    );
  }

  const filename = restoreFilename(existing);
  const mimeType = mimeTypeForFilename(filename);
  const normalizedContent = versionFileContent.replace(/\s+/g, "");
  try {
    verifiedIntegrityDataFromBase64({
      fileContent: normalizedContent,
      filename,
      claimedMimeType: mimeType,
    });
  } catch (error) {
    logger.warn("proposal version restore rejected unverified bytes", {
      requestId,
      tenderId: id,
      versionId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Saved proposal bytes are invalid or do not match the target document format.",
        code: "VERSION_BYTES_NOT_VERIFIED",
        requestId,
      },
      { status: 422 },
    );
  }

  // Claim the live document using optimistic locking before any external
  // storage write. Two requests that read the same row cannot both proceed;
  // requests arriving after the claim see GENERATING and fail closed above.
  const claim = await prisma.generatedDocument.updateMany({
    where: {
      id: existing.id,
      updatedAt: existing.updatedAt,
      generationStatus: existing.generationStatus,
    },
    data: {
      generationStatus: "GENERATING",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: `Restoring proposal version ${version.version}; validation and review are required again.`,
      updatedAt: new Date(),
    },
  });
  if (claim.count !== 1) {
    return NextResponse.json(
      {
        error: "The proposal document changed while the restore was starting. Retry with the latest state.",
        code: "CONCURRENT_MODIFICATION",
      },
      { status: 409 },
    );
  }

  try {
    // This writer validates bytes again, compensates rejected storage writes,
    // persists current integrity fields, and removes a replaced external object.
    await writeGeneratedDocumentContent(
      existing.id,
      Buffer.from(normalizedContent, "base64"),
      filename,
      mimeType,
    );

    await prisma.generatedDocument.update({
      where: { id: existing.id },
      data: {
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
        contentSummary: `[Restored from version ${version.version}] ${version.summary ?? ""}`.slice(0, 500),
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error("proposal version restore persistence failed", {
      requestId,
      tenderId: id,
      versionId,
      documentId: existing.id,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    await prisma.generatedDocument.update({
      where: { id: existing.id },
      data: {
        generationStatus: "FAILED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
        reviewNotes: "Proposal version restore failed. Retry before validation or export.",
        updatedAt: new Date(),
      },
    }).catch(() => undefined);
    return NextResponse.json(
      {
        error: "Proposal version restore failed. Retry or contact support with the request ID.",
        code: "VERSION_RESTORE_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }

  void logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "GeneratedDocument",
    entityId: existing.id,
    description: `Restored proposal version ${version.version}; validation and review reset to PENDING.`,
    metadata: {
      operation: "PROPOSAL_VERSION_RESTORED",
      tenderId: id,
      versionId,
      version: version.version,
      filename,
    },
    requestId,
  }).catch((error) => {
    logger.warn("proposal version restore audit persistence failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  });

  return NextResponse.json({
    success: true,
    restoredVersion: version.version,
    integrityStatus: "VERIFIED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
    message: `Proposal restored to version ${version.version}. Revalidate and reapprove it before export.`,
  });
}
