import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getStorageAdapter } from "../../../../lib/storage";
import { logger } from "../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET; if (!secret || secret.length < 16) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prismaReady;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Delete only terminal AiJob rows — never delete RUNNING or QUEUED
    const deletedAiJobs = await prisma.aiJob.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"] },
      },
    });

    // Clean up orphaned FallbackApprovalRecord rows — these reference AiJob
    // rows that were just deleted above. Without this, stale approvals could
    // authorize an old hash that happens to recur.
    const deletedFallbackApprovals = await prisma.fallbackApprovalRecord.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    }).catch(() => ({ count: 0 }));

    const deletedCopilotMessages = await prisma.tenderCopilotMessage.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    });

    // Permanently purge soft-deleted TenderFile records older than 30 days.
    // Files soft-deleted via ui-triggered deletion or api purge requests are
    // retained for 30 days to allow recovery if user action was accidental.
    // After 30 days, the files are permanently deleted to free storage.
    // Read storagePaths BEFORE deleting so we can clean up blob storage too
    // (was DB-only — orphaned blobs in Vercel Blob storage = cost leak + PII).
    const filesToDelete = await prisma.tenderFile.findMany({
      where: { deletedAt: { not: null, lt: thirtyDaysAgo } },
      select: { id: true, storagePath: true, fileContent: true, originalFileName: true },
    });
    const deletedTenderFiles = await prisma.tenderFile.deleteMany({
      where: {
        deletedAt: { not: null, lt: thirtyDaysAgo },
      },
    });

    // Best-effort blob cleanup for soft-deleted files.
    if (filesToDelete.length > 0) {
      const storage = getStorageAdapter();
      for (const file of filesToDelete) {
        if (file.storagePath || file.fileContent) {
          storage.deleteFile({
            storagePath: file.storagePath,
            fileContent: file.fileContent,
            fileName: file.originalFileName,
          }).catch((err) => {
            logger.warn(`[cleanup-old-records] blob cleanup failed for ${file.originalFileName}`, { detail: err instanceof Error ? err.message : String(err) });
          });
        }
      }
    }

    return NextResponse.json({
      deleted: {
        aiJobs: deletedAiJobs.count,
        fallbackApprovals: deletedFallbackApprovals.count,
        copilotMessages: deletedCopilotMessages.count,
        tenderFiles: deletedTenderFiles.count,
        blobsCleaned: filesToDelete.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
