import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
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
        status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] },
      },
    });

    // Delete old TenderCopilotMessage rows using raw SQL because the model
    // may not yet be present in the generated Prisma client (schema-ahead-of-client).
    const copilotResult = await prisma.$executeRaw`
      DELETE FROM "TenderCopilotMessage"
      WHERE "createdAt" < ${ninetyDaysAgo}
    `;

    return NextResponse.json({
      deleted: {
        aiJobs: deletedAiJobs.count,
        copilotMessages: copilotResult,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
