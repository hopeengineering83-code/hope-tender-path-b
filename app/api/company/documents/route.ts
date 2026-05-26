import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 200);
  const cursor = searchParams.get("cursor") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const q = searchParams.get("q") ?? "";

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ items: [], nextCursor: null, hasMore: false });

  const documents = await prisma.companyDocument.findMany({
    where: {
      companyId: company.id,
      ...(category ? { category } : {}),
      ...(q ? { OR: [{ fileName: { contains: q } }, { originalFileName: { contains: q } }, { category: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, fileName: true, originalFileName: true, mimeType: true,
      size: true, category: true, createdAt: true,
      extractedText: true,
    },
  });

  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, limit) : documents;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor, hasMore });
}

export async function DELETE(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await prismaReady;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const company = await prisma.company.findUnique({ where: { userId } });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    await prisma.companyDocument.delete({ where: { id } });

    await logAction({
      userId,
      action: "COMPANY_DOCUMENT_DELETE",
      entityType: "CompanyDocument",
      entityId: id,
      description: `Deleted company document "${doc.originalFileName}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Company document DELETE failed", error);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
