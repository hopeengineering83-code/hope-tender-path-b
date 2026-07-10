import { NextResponse } from "next/server";
import { getSession, requireRole } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { getStorageAdapter } from "../../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { logger } from "../../../../../../lib/observability";

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

  try {
    await getStorageAdapter().deleteFile({
      storagePath: file.storagePath,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });
    // Nullify all source-evidence references to this file BEFORE deleting it,
    // so requirements and tender fields don't dangle. Without this,
    // the canonical resolver may still report EXTRACTED_AND_GROUNDED against
    // a fileId that no longer exists until the next AI Analyze run.
    //
    // CRITICAL: Linked-fact cleanup (TenderFactsLedger, ExtractionQualityOverride,
    // TenderSubmissionEmail) must NOT use silent .catch(() => {}). If these
    // fail, the transaction must roll back — deleting a source file while
    // leaving dangling source-grounded facts would create false confidence
    // in export readiness. The only exception is when the table itself doesn't
    // exist (test/dev environments before migration) — that specific Prisma
    // error (P2021 "table does not exist") is caught and logged explicitly.
    await prisma.$transaction(async (tx) => {
      // Nullify requirement source references
      await tx.tenderRequirement.updateMany({
        where: { tenderId, sourceTenderFileId: fileId },
        data: { sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null },
      });
      // Nullify tender source-evidence columns that reference this file
      const sourceColumns = [
        "titleSourceFileId", "clientNameSourceFileId", "deadlineSourceFileId",
        "referenceSourceFileId", "submissionMethodSourceFileId",
        "submissionAddressSourceFileId", "submissionEmailSourceFileId",
        "submissionEmailSubjectSourceFileId",
      ];
      for (const col of sourceColumns) {
        await (tx as any).tender.updateMany({
          where: { id: tenderId, [col]: fileId } as any,
          data: { [col]: null } as any,
        });
      }
      // Nullify TenderFactsLedger entries that reference this file.
      // Without this, ledger facts still claim SOURCE_GROUNDED against a
      // deleted file — false export-readiness confidence.
      // NO silent .catch — if this fails for a real DB error, roll back.
      // Only catch P2021 (table not found in pre-migration environments).
      try {
        await (tx as any).tenderFactsLedger.updateMany({
          where: { tenderId, sourceFileId: fileId },
          data: { sourceFileId: null, sourcePage: null, sourceQuote: null, authorityState: "EXTRACTED_UNVERIFIED" },
        });
      } catch (e: any) {
        if (e?.code === "P2021") {
          // Table doesn't exist yet (pre-migration) — safe to skip
          logger.info("[file-delete] TenderFactsLedger table not found — skipping (pre-migration)");
        } else {
          throw e; // Roll back — don't leave dangling source-grounded facts
        }
      }
      // Delete ExtractionQualityOverride entries that reference this file
      try {
        await (tx as any).extractionQualityOverride.deleteMany({
          where: { tenderFileId: fileId },
        });
      } catch (e: any) {
        if (e?.code === "P2021") {
          logger.info("[file-delete] ExtractionQualityOverride table not found — skipping (pre-migration)");
        } else {
          throw e;
        }
      }
      // Nullify TenderSubmissionEmail entries that reference this file
      try {
        await (tx as any).tenderSubmissionEmail.updateMany({
          where: { tenderId, sourceFileId: fileId },
          data: { sourceFileId: null, sourcePage: null, sourceQuote: null },
        });
      } catch (e: any) {
        if (e?.code === "P2021") {
          logger.info("[file-delete] TenderSubmissionEmail table not found — skipping (pre-migration)");
        } else {
          throw e;
        }
      }
      await tx.tenderFile.delete({ where: { id: fileId } });
    });
  } catch {
    return NextResponse.json({ error: "File could not be deleted safely" }, { status: 502 });
  }

  await logAction({
    userId: actor.id,
    action: "DELETE",
    entityType: "TenderFile",
    entityId: fileId,
    description: `Deleted a tender file from tender "${tender.title}"`,
  });
  return NextResponse.json({ success: true });
}
