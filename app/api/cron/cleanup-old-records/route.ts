import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getStorageAdapter } from "../../../../lib/storage";
import { logger } from "../../../../lib/observability";
import {
  purgeExpiredSupersededDocuments,
  purgeExpiredTenderFiles,
} from "../../../../lib/engine/retention-storage-cleanup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prismaReady;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Delete only terminal AiJob rows — never delete RUNNING or QUEUED.
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

    const storage = getStorageAdapter();

    // External bytes are deleted before their database pointers are purged.
    // Failed storage cleanup leaves the row intact for the next cron run.
    const tenderFileCleanup = await purgeExpiredTenderFiles({
      prisma,
      storage,
      cutoff: thirtyDaysAgo,
    });

    // Clean up old SUPERSEDED ExportPackage rows. ExportPackage currently stores
    // manifest/digest state only; generated document bytes are handled below.
    const supersededExportPkgIds = await prisma.exportPackage.findMany({
      where: { status: "SUPERSEDED", createdAt: { lt: thirtyDaysAgo } },
      select: { id: true },
    }).then((rows) => rows.map((row) => row.id)).catch(() => [] as string[]);

    const deletedExportPackages = supersededExportPkgIds.length > 0
      ? await prisma.exportPackage.deleteMany({
          where: { id: { in: supersededExportPkgIds } },
        }).catch(() => ({ count: 0 }))
      : { count: 0 };

    const supersededDocumentCleanup = await purgeExpiredSupersededDocuments({
      prisma,
      storage,
      cutoff: thirtyDaysAgo,
    });

    return NextResponse.json({
      deleted: {
        aiJobs: deletedAiJobs.count,
        fallbackApprovals: deletedFallbackApprovals.count,
        copilotMessages: deletedCopilotMessages.count,
        tenderFiles: tenderFileCleanup.rowsDeleted,
        blobsCleaned: tenderFileCleanup.blobsCleaned,
        tenderFileBlobFailures: tenderFileCleanup.failures,
        tenderFileCandidates: tenderFileCleanup.candidates,
        exportPackages: deletedExportPackages.count,
        supersededDocs: supersededDocumentCleanup.rowsDeleted,
        supersededDocBlobsCleaned: supersededDocumentCleanup.blobsCleaned,
        supersededDocBlobFailures: supersededDocumentCleanup.failures,
        supersededDocCandidates: supersededDocumentCleanup.candidates,
      },
    });
  } catch (error) {
    logger.error("[cleanup-old-records] failed", { detail: error });
    return NextResponse.json({ error: "Cleanup failed. Check server logs." }, { status: 500 });
  }
}
