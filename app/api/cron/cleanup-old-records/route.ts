import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";

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

    const deletedCopilotMessages = await prisma.tenderCopilotMessage.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    });

    // Permanently purge soft-deleted TenderFile records older than 30 days.
    // Files soft-deleted via ui-triggered deletion or api purge requests are
    // retained for 30 days to allow recovery if user action was accidental.
    // After 30 days, the files are permanently deleted to free storage.
    const deletedTenderFiles = await prisma.tenderFile.deleteMany({
      where: {
        deletedAt: { not: null, lt: thirtyDaysAgo },
      },
    });

    return NextResponse.json({
      deleted: {
        aiJobs: deletedAiJobs.count,
        copilotMessages: deletedCopilotMessages.count,
        tenderFiles: deletedTenderFiles.count,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
