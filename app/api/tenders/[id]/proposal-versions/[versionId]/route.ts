import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse, getCurrentUser } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { requireTenderAccess } from "../../../../../../lib/tender-ownership";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;

  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

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

  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await prisma.proposalVersion.deleteMany({
    where: { id: versionId, tenderId: id },
  });

  return NextResponse.json({ success: true });
}

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

  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const v = await prisma.proposalVersion.findFirst({
    where: { id: versionId, tenderId: id },
    select: { id: true, version: true, markdown: true, fileContent: true, summary: true },
  });
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });

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
