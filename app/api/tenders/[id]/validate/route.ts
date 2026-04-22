import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { logAction } from "../../../../../lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const report = await validateTender(id);

  await logAction({
    userId,
    action: "TENDER_VALIDATED",
    entityType: "Tender",
    entityId: id,
    description: `Validated tender "${tender.title}" — ${report.passed ? "PASSED" : "FAILED"}`,
    metadata: { tenderId: id, passed: report.passed, issues: report.issues.length },
  });

  if (report.passed) {
    await prisma.tender.update({
      where: { id },
      data: { status: "APPROVED" },
    });
  }

  return NextResponse.json({ report });
}
