import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      status: true,
      generatedDocuments: {
        orderBy: [{ exactOrder: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          documentType: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          reviewNotes: true,
          exactFileName: true,
          exactOrder: true,
          contentSummary: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return NextResponse.json(tenders);
}
