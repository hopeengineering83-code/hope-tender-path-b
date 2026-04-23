import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId, fileId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await prisma.tenderFile.findFirst({
    where: { id: fileId, tenderId },
  });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  if (!file.fileContent) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  const buffer = Buffer.from(file.fileContent, "base64");
  const safeFileName = file.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId, fileId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await prisma.tenderFile.findFirst({ where: { id: fileId, tenderId } });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  await prisma.tenderFile.delete({ where: { id: fileId } });

  await logAction({
    userId,
    action: "TENDER_FILE_UPLOAD",
    entityType: "TenderFile",
    entityId: fileId,
    description: `Deleted tender file "${file.originalFileName}" from tender "${tender.title}"`,
  });

  return NextResponse.json({ success: true });
}
