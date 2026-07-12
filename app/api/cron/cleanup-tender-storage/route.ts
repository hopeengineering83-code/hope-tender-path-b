import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getStorageAdapter } from "../../../../lib/storage";
import { logger } from "../../../../lib/observability";
import { processPendingTenderStorageCleanupTasks } from "../../../../lib/tender/tender-storage-cleanup-task";
import { GET as cleanupOldRecords } from "../cleanup-old-records/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Vercel Hobby allows only two cron schedules. This endpoint is the single
    // maintenance schedule: it delegates to the existing retention cleanup,
    // then processes the durable external-storage queue. The existing route is
    // not modified, which keeps its contract reusable and avoids duplicate jobs.
    const retentionResponse = await cleanupOldRecords(req);
    const retention = await retentionResponse.json().catch(() => null);
    if (!retentionResponse.ok) {
      logger.error("[cleanup-tender-storage] delegated retention cleanup failed", {
        status: retentionResponse.status,
      });
      return NextResponse.json(
        { error: "Scheduled maintenance failed. Check server logs." },
        { status: 500 },
      );
    }

    await prismaReady;
    const storageCleanup = await processPendingTenderStorageCleanupTasks({
      prisma,
      storage: getStorageAdapter(),
      limit: 50,
    });
    return NextResponse.json({ retention, storageCleanup });
  } catch (error) {
    logger.error("[cleanup-tender-storage] failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Scheduled maintenance failed. Check server logs." },
      { status: 500 },
    );
  }
}
