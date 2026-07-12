import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getStorageAdapter } from "../../../../lib/storage";
import { logger } from "../../../../lib/observability";
import { processPendingTenderStorageCleanupTasks } from "../../../../lib/tender/tender-storage-cleanup-task";

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
    await prismaReady;
    const result = await processPendingTenderStorageCleanupTasks({
      prisma,
      storage: getStorageAdapter(),
      limit: 50,
    });
    return NextResponse.json({ cleanup: result });
  } catch (error) {
    logger.error("[cleanup-tender-storage] failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Tender storage cleanup failed. Check server logs." },
      { status: 500 },
    );
  }
}
