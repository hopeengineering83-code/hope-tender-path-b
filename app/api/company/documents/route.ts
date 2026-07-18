import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  getSession,
  requireRole,
  unauthorizedResponse,
} from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { getStorageAdapter } from "../../../../lib/storage";
import {
  COMPANY_DOCUMENT_PENDING_DELETE_MARKER,
  deleteCompanyDocumentDurably,
} from "../../../../lib/company-document-durable-deletion";

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
      NOT: {
        metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER },
      },
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
      ? await prisma.$queryRaw<Array<{ id: string; len: number; fileContentLength: number }>>`
          SELECT id, COALESCE(char_length("extractedText"), 0)::int AS len,
                 ("fileContent" IS NOT NULL)::int AS "fileContentLength"
          FROM "CompanyDocument"
          WHERE id = ANY(${ids}::text[])
        `
      : [];
  const lengthById = Object.fromEntries(textLengths.map((r) => [r.id, r.len]));
  const fileContentLengthById = Object.fromEntries(textLengths.map((r) => [r.id, (r as { fileContentLength?: number }).fileContentLength ?? 0]));
  const itemsWithLength = items.map((doc) => {
    const { storagePath: privateStoragePath, ...publicDoc } = doc;
    return {
      ...publicDoc,
      extractedTextLength: lengthById[doc.id] ?? 0,
      hasInlineFileContent: (fileContentLengthById[doc.id] ?? 0) > 0,
      hasPrivateStorage: Boolean(privateStoragePath?.trim()),
    };
  });

  return NextResponse.json({ items: itemsWithLength, nextCursor, hasMore });
}

export async function DELETE(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const rl = rateLimit(`docs-delete:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    await prismaReady;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const company = await prisma.company.findUnique({ where: { userId: actor.id } });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const result = await deleteCompanyDocumentDurably({
      prisma,
      storage: getStorageAdapter(),
      companyId: company.id,
      documentId: id,
    });

    if (!result.ok) {
      const error = result.code === "REVIEWED_PROVENANCE_DEPENDENCY"
        ? "Deletion blocked because reviewed experts or projects still depend on this source document."
        : result.code === "NOT_FOUND"
          ? "Document not found"
          : "Document deletion is pending a safe retry.";
      return NextResponse.json({ error, ...result }, { status: result.status });
    }

    await logAction({
      userId: actor.id,
      action: "COMPANY_DOCUMENT_DELETE",
      entityType: "CompanyDocument",
      entityId: id,
      description: "Deleted a company source document and its unreviewed derived records",
      metadata: {
        companyId: company.id,
        draftExpertsRemoved: result.draftExpertsRemoved,
        draftProjectsRemoved: result.draftProjectsRemoved,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("Company document DELETE failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Failed to delete document safely" }, { status: 500 });
  }
}
