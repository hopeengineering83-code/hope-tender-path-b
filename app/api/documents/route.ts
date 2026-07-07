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
        where: { generationStatus: { not: "SUPERSEDED" } },
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
          storagePath: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const docIds = tenders.flatMap((tender) => tender.generatedDocuments.map((doc) => doc.id));
  const inlineLengths = docIds.length > 0
    ? await prisma.$queryRaw<Array<{ id: string; fileContentLength: number }>>`
        SELECT id, ("fileContent" IS NOT NULL)::int AS "fileContentLength"
        FROM "GeneratedDocument"
        WHERE id = ANY(${docIds}::text[])
      `.catch(() => [] as Array<{ id: string; fileContentLength: number }>)
    : [];
  const inlineLengthById = new Map(inlineLengths.map((doc) => [doc.id, doc.fileContentLength]));

  return NextResponse.json(tenders.map((tender) => ({
    ...tender,
    generatedDocuments: tender.generatedDocuments.map((doc) => ({
      ...doc,
      hasInlineFileContent: (inlineLengthById.get(doc.id) ?? 0) > 0,
    })),
  })));
}
