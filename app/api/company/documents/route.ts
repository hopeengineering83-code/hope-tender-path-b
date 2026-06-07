import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";

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
      size: true, category: true, createdAt: true, storagePath: true, aiExtractionStatus: true,
    },
  });

  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, limit) : documents;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  // Return text length (not the full text) so UI can show extraction status
  // without loading MB-scale blobs over the network.
  const ids = items.map((d) => d.id);
  const textLengths =
    ids.length > 0
      ? await prisma.$queryRaw<Array<{ id: string; len: number }>>`
          SELECT id, COALESCE(char_length("extractedText"), 0)::int AS len
          FROM "CompanyDocument"
          WHERE id = ANY(${ids}::text[])
        `
      : [];
  const lengthById = Object.fromEntries(textLengths.map((r) => [r.id, r.len]));
  const itemsWithLength = items.map((doc) => ({
    ...doc,
    extractedTextLength: lengthById[doc.id] ?? 0,
  }));

  return NextResponse.json({ items: itemsWithLength, nextCursor, hasMore });
}

export async function DELETE(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`docs-delete:${userId}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

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
