// POST /api/tenders/[id]/deduplicate-documents
// Supersedes duplicate GeneratedDocument rows, keeping the best (latest with content).
// Auth: ADMIN or PROPOSAL_MANAGER

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`dedup:${ip}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun === true;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Load all non-superseded docs
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true, name: true, exactFileName: true, documentType: true,
      reviewStatus: true, generationStatus: true, updatedAt: true,
      fileContent: true, storagePath: true, exactOrder: true,
    },
  });

  // Group by dedup key: normalized name + documentType
  function dedupKey(doc: typeof docs[0]): string {
    const nameKey = (doc.exactFileName ?? doc.name).trim().toLowerCase().replace(/\s+\d+\.docx?$/i, "");
    const typeKey = (doc.documentType ?? "").toUpperCase();
    return `${nameKey}||${typeKey}`;
  }

  const groups = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = dedupKey(doc);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  const toSupersede: string[] = [];
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    // Keep the best: prefer rows with fileContent or storagePath, then latest
    const [keep, ...supersede] = group.sort((a, b) => {
      const aHasContent = (a.fileContent ? 1 : 0) + (a.storagePath ? 1 : 0);
      const bHasContent = (b.fileContent ? 1 : 0) + (b.storagePath ? 1 : 0);
      if (bHasContent !== aHasContent) return bHasContent - aHasContent;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    void keep; // explicitly used as the kept row (not superseded)
    toSupersede.push(...supersede.map((d) => d.id));
  }

  if (!dryRun && toSupersede.length > 0) {
    await prisma.generatedDocument.updateMany({
      where: { id: { in: toSupersede } },
      data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED" },
    });
    await logAction({
      userId: actor.id,
      action: "DOCUMENT_DEDUPLICATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `Superseded ${toSupersede.length} duplicate document(s).`,
    });
  }

  return NextResponse.json({
    success: true,
    dryRun,
    duplicatesFound: toSupersede.length,
    supersededIds: dryRun ? toSupersede : [],
  });
}
