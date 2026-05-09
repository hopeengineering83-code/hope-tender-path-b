// Single-version routes:
//
// GET  /api/tenders/[id]/proposal-versions/[versionId]
//   Returns the full markdown (and optionally fileContent) of one version.
//   Used to preview a previous generation before deciding to restore it.
//
// POST /api/tenders/[id]/proposal-versions/[versionId]/restore  →
//   handled by the dedicated restore sub-route below.
//
// DELETE /api/tenders/[id]/proposal-versions/[versionId]
//   Permanently removes a single version (user-initiated cleanup).

import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; version: number; markdown: string; fileContent: string | null;
    benchmarkScore: number | null; qualityScore: number | null; winProbabilityScore: number | null;
    mode: string | null; summary: string | null; createdAt: string;
  }>>(
    `SELECT * FROM "ProposalVersion" WHERE "id" = $1 AND "tenderId" = $2 LIMIT 1`,
    versionId, id
  );

  if (rows.length === 0) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ version: rows[0] });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await prisma.$executeRawUnsafe(
    `DELETE FROM "ProposalVersion" WHERE "id" = $1 AND "tenderId" = $2`,
    versionId, id
  );

  return NextResponse.json({ success: true });
}

// POST /api/tenders/[id]/proposal-versions/[versionId] with body { action: "restore" }
// Copies the selected version's markdown back into the active GeneratedDocument
// for this tender. Does NOT re-run the engine — just replaces the DOCX content
// with the saved snapshot so the user can download the restored version.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (body.action !== "restore") return NextResponse.json({ error: "Unsupported action. Send { action: \"restore\" }." }, { status: 400 });

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; version: number; markdown: string; fileContent: string | null; summary: string | null;
  }>>(
    `SELECT "id","version","markdown","fileContent","summary" FROM "ProposalVersion" WHERE "id" = $1 AND "tenderId" = $2 LIMIT 1`,
    versionId, id
  );

  if (rows.length === 0) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const v = rows[0];

  // Update the live Technical Proposal generated document for this tender.
  const existing = await prisma.generatedDocument.findFirst({
    where: {
      tenderId: id,
      documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL"] },
    },
    orderBy: { exactOrder: "asc" },
  });

  if (existing) {
    await prisma.generatedDocument.update({
      where: { id: existing.id },
      data: {
        fileContent: v.fileContent ?? existing.fileContent,
        contentSummary: `[Restored from version ${v.version}] ${v.summary ?? ""}`.slice(0, 500),
        generationStatus: "GENERATED",
        updatedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    success: true,
    restoredVersion: v.version,
    message: `Proposal restored to version ${v.version}. Download the updated document from the Documents tab.`,
  });
}
