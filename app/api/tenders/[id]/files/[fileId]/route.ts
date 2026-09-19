import { NextResponse } from "next/server";
import { getSession, requireRole } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { getStorageAdapter } from "../../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { logger } from "../../../../../../lib/observability";
import { requireVerifiedPersistedFileBytes } from "../../../../../../lib/engine/persisted-byte-integrity";
import { durableDeleteTenderFile } from "../../../../../../lib/engine/workflow/durable-deletion";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId, fileId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await prisma.tenderFile.findFirst({ where: { id: fileId, tenderId } });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!file.fileContent && !file.storagePath) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  try {
    const buffer = await getStorageAdapter().getFile({
      storagePath: file.storagePath,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });
    requireVerifiedPersistedFileBytes({
      bytes: buffer,
      filename: file.originalFileName,
      claimedMimeType: file.mimeType,
      persisted: {
        contentSha256: file.contentSha256,
        contentByteLength: file.contentByteLength,
        contentMimeType: file.contentMimeType,
        detectedFormat: file.detectedFormat,
        integrityStatus: file.integrityStatus,
      },
    });
    const safeFileName = file.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFileName}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File content could not be retrieved from storage" }, { status: 502 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = await rateLimitPersistent(`file-delete:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId, fileId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true, title: true } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await prisma.tenderFile.findFirst({ where: { id: fileId, tenderId } });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  let deletion;
  try {
    deletion = await durableDeleteTenderFile(prisma, fileId, tenderId, actor.id);
  } catch (error) {
    logger.error("[file-delete] durable deletion failed", {
      tenderId,
      fileId,
      errorName: error instanceof Error ? error.constructor.name : typeof error,
      errorCode: error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : null,
    });
    return NextResponse.json(
      {
        error: "File could not be deleted safely",
        code: "FILE_DELETE_FAILED",
      },
      { status: 502 },
    );
  }

  await logAction({
    userId: actor.id,
    action: "DELETE",
    entityType: "TenderFile",
    entityId: fileId,
    description: deletion.storageCleanupPending
      ? `Removed a tender file from active use in tender "${tender.title}"; external storage cleanup remains pending`
      : `Deleted a tender file from tender "${tender.title}"`,
    metadata: {
      tenderId,
      storageCleanupPending: deletion.storageCleanupPending,
      alreadyDeleted: deletion.alreadyDeleted === true,
    },
  });

  return NextResponse.json(
    {
      success: true,
      storageCleanupPending: deletion.storageCleanupPending,
      alreadyDeleted: deletion.alreadyDeleted === true,
    },
    { status: deletion.storageCleanupPending ? 202 : 200 },
  );
}
