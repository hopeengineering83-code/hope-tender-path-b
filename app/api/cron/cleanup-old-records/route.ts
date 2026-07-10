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

    // Clean up old SUPERSEDED ExportPackage rows — each /export POST creates a
    // new READY row and marks the prior as SUPERSEDED. Without this, old
    // package records accumulate indefinitely (cost + clutter).
    // Select exact IDs first, then delete only those IDs — prevents race
    // condition where rows change between a broad deleteMany and metrics.
    const supersededExportPkgIds = await prisma.exportPackage.findMany({
      where: { status: "SUPERSEDED", createdAt: { lt: thirtyDaysAgo } },
      select: { id: true },
    }).then((rows) => rows.map((r) => r.id)).catch(() => [] as string[]);

    const deletedExportPackages = supersededExportPkgIds.length > 0
      ? await prisma.exportPackage.deleteMany({ where: { id: { in: supersededExportPkgIds } } }).catch(() => ({ count: 0 }))
      : { count: 0 };

    // Clean up old SUPERSEDED GeneratedDocument rows AND their blob storage.
    // Each engine re-run supersedes all active docs, but the old rows —
    // including their fileContent blobs — persist forever without this.
    //
    // Race-condition-safe approach:
    //   1. Select exact candidate IDs + storagePath (single read)
    //   2. Delete only those exact IDs (deterministic — no broad deleteMany)
    //   3. Blob cleanup uses exactly the selected/deleted rows
    // This prevents divergence between DB cleanup and blob cleanup if rows
    // change status between read and delete.
    const supersededDocCandidates = await prisma.generatedDocument.findMany({
      where: {
        generationStatus: "SUPERSEDED",
        updatedAt: { lt: thirtyDaysAgo },
      },
      select: { id: true, storagePath: true, fileContent: true, exactFileName: true },
    }).catch(() => []);

    const supersededDocIds = supersededDocCandidates.map((d) => d.id);
    const deletedSupersededDocs = supersededDocIds.length > 0
      ? await prisma.generatedDocument.deleteMany({ where: { id: { in: supersededDocIds } } }).catch(() => ({ count: 0 }))
      : { count: 0 };

    // Best-effort blob cleanup for exactly the selected/deleted rows.
    // If blob cleanup fails after DB deletion, log safe diagnostics and
    // report partial blob cleanup — do not expose raw internals.
    let supersededDocBlobsCleaned = 0;
    let supersededDocBlobFailures = 0;
    if (supersededDocCandidates.length > 0) {
      const storage = getStorageAdapter();
      for (const doc of supersededDocCandidates) {
        if (doc.storagePath || doc.fileContent) {
          try {
            await storage.deleteFile({
              storagePath: doc.storagePath,
              fileContent: doc.fileContent,
              fileName: doc.exactFileName ?? doc.id,
            });
            supersededDocBlobsCleaned++;
          } catch (err) {
            supersededDocBlobFailures++;
            logger.warn(`[cleanup-old-records] generated doc blob cleanup failed`, {
              docId: doc.id,
              exactFileName: doc.exactFileName,
              errorClass: err instanceof Error ? err.constructor.name : "UnknownError",
            });
          }
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
        exportPackages: deletedExportPackages.count,
        supersededDocs: deletedSupersededDocs.count,
        supersededDocBlobsCleaned,
        supersededDocBlobFailures,
      },
    });
  } catch (error) {
    logger.error("[cleanup-old-records] failed", { detail: error });
    return NextResponse.json({ error: "Cleanup failed. Check server logs." }, { status: 500 });
  }
}
