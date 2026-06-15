import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { detectBrandingPolicy } from "../../../../../../lib/engine/export/export-format-policy";
import { logAction } from "../../../../../../lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: { requirements: true, generatedDocuments: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const company = await prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const appSettings = await prisma.appSettings.findFirst({ where: { companyId: company.id } });

  const tenderText = [
    tender.title ?? "",
    tender.description ?? "",
    tender.intakeSummary ?? "",
    tender.analysisSummary ?? "",
    tender.evaluationMethodology ?? "",
    ...tender.requirements.map((r) => `${r.title ?? ""} ${r.description ?? ""} ${r.restrictions ?? ""}`),
  ].join("\n\n");

  const policy = detectBrandingPolicy(tenderText);
  const conflicts: string[] = [];
  if (!policy.brandingAllowed && (appSettings?.allowBrandingDefault !== false)) conflicts.push("branding");
  if (!policy.signatureAllowed && (appSettings?.allowSignatureDefault !== false)) conflicts.push("signature");
  if (!policy.stampAllowed && (appSettings?.allowStampDefault !== false)) conflicts.push("stamp");

  if (conflicts.length === 0) {
    await logAction({ userId: actor.id, action: "EXPORT_PACKAGE_REPAIR", entityType: "Tender", entityId: tender.id, description: "Export policy repair requested, but no conflicts were found.", metadata: { conflicts } });
    return NextResponse.json({ ok: true, changed: 0, message: "No export-policy conflict detected." });
  }

  const affected = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");

  if (affected.length > 0) {
    await prisma.generatedDocument.updateMany({
      where: { id: { in: affected.map((d) => d.id) } },
      data: {
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
        reviewNotes: `Export policy repair required: regenerate/strip prohibited assets (${conflicts.join(", ")}).`,
      },
    });
  }

  await logAction({
    userId: actor.id,
    action: "EXPORT_PACKAGE_REPAIR",
    entityType: "Tender",
    entityId: tender.id,
    description: `Marked ${affected.length} generated documents for regeneration due to prohibited assets: ${conflicts.join(", ")}.`,
    metadata: { conflicts, affectedDocumentIds: affected.map((d) => d.id), blockers: policy.blockers },
  });

  return NextResponse.json({
    ok: true,
    changed: affected.length,
    action: "REGENERATE_WITHOUT_PROHIBITED_ASSETS",
    conflicts,
    blockers: policy.blockers,
  });
}
