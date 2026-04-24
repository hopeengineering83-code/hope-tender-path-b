import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!doc.fileContent) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  const buffer = Buffer.from(doc.fileContent, "base64");
  const safeFileName = doc.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.companyDocument.delete({ where: { id } });

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Deleted company document "${doc.originalFileName}" (${doc.category})`,
  });

  return NextResponse.json({ success: true });
}
