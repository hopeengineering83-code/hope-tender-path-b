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
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // PR XX-A — typed access via Prisma model.
  const version = await prisma.proposalVersion.findFirst({
    where: { id: versionId, tenderId: id },
  });
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ version });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`version-delete:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id, versionId } = await params;

  // Authorization: owner-scoped by default. Only ADMIN can fall back to the
  // unscoped lookup (for cross-tenant operator access). PROPOSAL_MANAGER is
  // restricted to their own tenders — prevents cross-tenant content mutation.
  const ownerTender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  let tender = ownerTender;
  if (!tender && actor.role === "ADMIN") {
    tender = await prisma.tender.findFirst({ where: { id }, select: { id: true } });
  }
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await prisma.proposalVersion.deleteMany({
    where: { id: versionId, tenderId: id },
  });

  return NextResponse.json({ success: true });
}

// POST /api/tenders/[id]/proposal-versions/[versionId] with body { action: "restore" }
// Copies the selected version's markdown back into the active GeneratedDocument
// for this tender. Does NOT re-run the engine — just replaces the DOCX content
// with the saved snapshot so the user can download the restored version.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`version-restore:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id, versionId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (body.action !== "restore") return NextResponse.json({ error: "Unsupported action. Send { action: \"restore\" }." }, { status: 400 });

  // Authorization: owner-scoped by default (matches /export, /download, and
  // the GET sibling in this file at line 27). ADMIN/PROPOSAL_MANAGER fall back
  // Authorization: owner-scoped by default. Only ADMIN can fall back to the
  // unscoped lookup (for cross-tenant operator access). PROPOSAL_MANAGER is
  // restricted to their own tenders — prevents cross-tenant content mutation
  // (restore writes GeneratedDocument.fileContent).
  const ownerTender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  let tender = ownerTender;
  if (!tender && actor.role === "ADMIN") {
    tender = await prisma.tender.findFirst({ where: { id }, select: { id: true } });
  }
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // PR XX-A — typed access via Prisma model.
  const v = await prisma.proposalVersion.findFirst({
    where: { id: versionId, tenderId: id },
    select: { id: true, version: true, markdown: true, fileContent: true, summary: true },
  });
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });

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
        // Reset quality gate fields: restoring an old snapshot may bring back
        // stale content, so both status fields must be re-evaluated before the
        // document can be marked READY_FOR_EXPORT again.
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
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
