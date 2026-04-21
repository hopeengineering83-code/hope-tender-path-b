import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        complianceGaps: true,
        generatedDocuments: true,
      },
    });

    if (!tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json(
        { error: "Resolve high-severity compliance gaps before export preparation." },
        { status: 400 },
      );
    }

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "Run the tender engine before export preparation." }, { status: 400 });
    }

    await prisma.tender.update({
      where: { id },
      data: { status: "EXPORTED", stage: "EXPORT" },
    });

    return NextResponse.json({
      success: true,
      exportPackage: {
        id: crypto.randomUUID(),
        tenderId: tender.id,
        name: `${tender.title} Submission Package`,
        format: "ZIP",
        exportStatus: "ready",
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Export preparation failed:", error);
    return NextResponse.json({ error: "Export preparation failed" }, { status: 500 });
  }
}
