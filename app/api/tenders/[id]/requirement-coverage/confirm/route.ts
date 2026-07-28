import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { extractRequestId } from "../../../../../../lib/request-id";
import { isGroundedEvidenceInActiveFiles } from "../../../../../../lib/engine/evidence-grounding";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Body = {
  requirementId?: string;
  evidenceType?: string;
  evidenceId?: string;
  evidenceReference?: string;
  supportLevel?: string;
  notes?: string;
};

function requestedSupportLevel(value: unknown): string {
  const normalized = String(value ?? "PARTIAL").toUpperCase();
  if (["FULL", "SUBSTANTIAL", "PARTIAL", "NONE", "NOT_APPLICABLE"].includes(normalized)) return normalized;
  return "PARTIAL";
}

function isManualReviewerConfirmation(body: Body): boolean {
  return String(body.evidenceType ?? "").toUpperCase() === "MANUAL_REVIEWER_CONFIRMATION";
}

function safeAutoLinkSupportLevel(value: unknown): { level: string; capped: boolean; reason: string | null } {
  const requested = requestedSupportLevel(value);
  if (requested === "FULL" || requested === "SUBSTANTIAL") {
    return {
      level: "PARTIAL",
      capped: true,
      reason: "Auto-linked vault evidence is reviewer-confirmed only as PARTIAL here. Mark FULL/SUBSTANTIAL only through the compliance matrix with traceable source support.",
    };
  }
  return { level: requested, capped: false, reason: null };
}

async function resolveReviewedEvidence(companyId: string, body: Body) {
  const type = String(body.evidenceType ?? "").toUpperCase();
  const ref = String(body.evidenceReference ?? "").trim();
  const id = String(body.evidenceId ?? "").trim();

  if (type === "EXPERT") {
    const expert = await prisma.expert.findFirst({
      where: {
        companyId,
        deletedAt: null,
        trustLevel: "REVIEWED",
        OR: [
          ...(id ? [{ id }] : []),
          ...(ref ? [{ fullName: ref }] : []),
        ],
      },
      select: { id: true, fullName: true },
    });
    if (!expert) return null;
    return { evidenceType: "EXPERT", evidenceSource: "VAULT_CONFIRMED", evidenceReference: expert.fullName, evidenceId: expert.id };
  }

  if (type === "PROJECT") {
    const project = await prisma.project.findFirst({
      where: {
        companyId,
        deletedAt: null,
        trustLevel: "REVIEWED",
        OR: [
          ...(id ? [{ id }] : []),
          ...(ref ? [{ name: ref }] : []),
        ],
      },
      select: { id: true, name: true },
    });
    if (!project) return null;
    return { evidenceType: "PROJECT", evidenceSource: "VAULT_CONFIRMED", evidenceReference: project.name, evidenceId: project.id };
  }

  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.requirementId) return NextResponse.json({ ok: false, error: "requirementId is required" }, { status: 400 });

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true, userId: true } });
  if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

  const requirement = await prisma.tenderRequirement.findFirst({
    where: { id: body.requirementId, tenderId: id },
    select: {
      id: true,
      title: true,
      sourceTenderFileId: true,
      sourcePageNumber: true,
      sourceExactQuote: true,
    },
  });
  if (!requirement) return NextResponse.json({ ok: false, error: "Requirement not found for this tender" }, { status: 404 });

  const requestedLevel = requestedSupportLevel(body.supportLevel);

  if (isManualReviewerConfirmation(body)) {
    if (requestedLevel === "FULL" || requestedLevel === "SUBSTANTIAL") {
      const activeFiles = await prisma.tenderFile.findMany({
        where: { tenderId: id, deletionStatus: "ACTIVE" },
        select: { id: true, extractedText: true, totalPages: true },
      });
      if (!isGroundedEvidenceInActiveFiles(
        requirement.sourcePageNumber,
        requirement.sourceExactQuote,
        requirement.sourceTenderFileId,
        activeFiles,
      )) {
        return NextResponse.json({
          ok: false,
          code: "REQUIREMENT_SOURCE_TRACE_REQUIRED",
          error: "FULL or SUBSTANTIAL coverage requires an active tender source file, valid page, and exact quote contained in that source.",
        }, { status: 422 });
      }
    }
    const evidenceReference = `reviewer:${actor.id}:requirement:${requirement.id}`;
    const notes = body.notes ?? `Reviewer manually confirmed ${requestedLevel} coverage.`;
    const existing = await prisma.complianceMatrix.findFirst({
      where: { tenderId: id, requirementId: requirement.id, evidenceType: "MANUAL_REVIEWER_CONFIRMATION" },
      select: { id: true },
    });

    const row = existing
      ? await prisma.complianceMatrix.update({ where: { id: existing.id }, data: { evidenceSource: "REVIEWER_CONFIRMED", evidenceReference, supportLevel: requestedLevel, notes, updatedAt: new Date() } })
      : await prisma.complianceMatrix.create({ data: { tenderId: id, requirementId: requirement.id, evidenceType: "MANUAL_REVIEWER_CONFIRMATION", evidenceSource: "REVIEWER_CONFIRMED", evidenceReference, supportLevel: requestedLevel, notes } });

    await logAction({ userId: actor.id, action: "REQUIREMENT_COVERAGE_MANUALLY_CONFIRMED", entityType: "Tender", entityId: id, description: `Manually confirmed ${requestedLevel.toLowerCase()} coverage for requirement: ${requirement.title}`, metadata: { requirementId: requirement.id, complianceMatrixId: row.id, supportLevel: requestedLevel }, requestId });

    return NextResponse.json({ ok: true, success: true, row, requestedSupportLevel: requestedLevel, effectiveSupportLevel: requestedLevel, supportLevelCapped: false, supportLevelPolicy: null });
  }

  const company = await prisma.company.findUnique({ where: { userId: tender.userId }, select: { id: true } });
  if (!company) return NextResponse.json({ ok: false, error: "Company profile required" }, { status: 422 });

  const evidence = await resolveReviewedEvidence(company.id, body);
  if (!evidence) {
    return NextResponse.json({ ok: false, code: "REVIEWED_EVIDENCE_NOT_FOUND", error: "Only REVIEWED vault experts/projects can be confirmed as requirement evidence." }, { status: 422 });
  }

  const supportPolicy = safeAutoLinkSupportLevel(body.supportLevel);
  const level = supportPolicy.level;
  const confirmationNote = supportPolicy.capped
    ? `${body.notes ?? "Confirmed reviewed vault evidence."} Strong-support request (${requestedLevel}) capped to PARTIAL: ${supportPolicy.reason}`
    : body.notes ?? "Confirmed reviewed vault evidence.";
  const existing = await prisma.complianceMatrix.findFirst({
    where: { tenderId: id, requirementId: requirement.id, evidenceType: evidence.evidenceType, evidenceReference: evidence.evidenceReference },
    select: { id: true },
  });

  const row = existing
    ? await prisma.complianceMatrix.update({ where: { id: existing.id }, data: { evidenceSource: evidence.evidenceSource, supportLevel: level, notes: confirmationNote, updatedAt: new Date() } })
    : await prisma.complianceMatrix.create({ data: { tenderId: id, requirementId: requirement.id, evidenceType: evidence.evidenceType, evidenceSource: evidence.evidenceSource, evidenceReference: evidence.evidenceReference, supportLevel: level, notes: confirmationNote } });

  await logAction({ userId: actor.id, action: "REQUIREMENT_EVIDENCE_CONFIRMED", entityType: "Tender", entityId: id, description: `Confirmed ${evidence.evidenceType.toLowerCase()} evidence for requirement: ${requirement.title}`, metadata: { requirementId: requirement.id, complianceMatrixId: row.id, evidenceId: evidence.evidenceId, requestedSupportLevel: requestedLevel, supportLevel: level, supportLevelCapped: supportPolicy.capped }, requestId });

  return NextResponse.json({ ok: true, success: true, row, requestedSupportLevel: requestedLevel, effectiveSupportLevel: level, supportLevelCapped: supportPolicy.capped, supportLevelPolicy: supportPolicy.reason });
}
