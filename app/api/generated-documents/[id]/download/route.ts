import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { readStoredFile } from "../../../../../lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;
  const { id } = await params;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id, tender: { userId } },
  });

  if (!doc || !doc.storagePath) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const buffer = await readStoredFile(doc.storagePath);
  const fileName = doc.exactFileName || doc.name;
  const safeName = fileName.endsWith(".docx") ? fileName : `${fileName}.docx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${path.basename(safeName)}"`,
    },
  });
}
