import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { createEvidenceDecision } from "../../../../../../../lib/engine/requirement-evidence";
import { extractRequestId } from "../../../../../../../lib/request-id";
import { logger } from "../../../../../../../lib/observability";

export const dynamic = "force-dynamic";

function safe(code: string, error: string, requestId: string, status: number) {
  return NextResponse.json({ ok: false, code, error, requestId }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId, requirementId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } });
  if (!tender) return safe("TENDER_NOT_FOUND", "Tender not found or not accessible.", requestId, 404);

  try {
    const body = await req.json().catch(() => ({}));
    const decision = await createEvidenceDecision({
      tenderId,
      tenderRequirementId: requirementId,
      tenderFileId: String(body.tenderFileId ?? ""),
      reviewerId: actor.id,
      pageNumber: Number(body.pageNumber),
      exactQuote: String(body.exactQuote ?? ""),
      asset: {
        expertId: body.expertId ?? null,
        projectId: body.projectId ?? null,
        legalRecordId: body.legalRecordId ?? null,
        companyComplianceRecordId: body.companyComplianceRecordId ?? null,
        companyAssetId: body.companyAssetId ?? null,
        originalUploadId: body.originalUploadId ?? null,
      },
    });
    return NextResponse.json({ ok: true, decisionId: decision.id, status: decision.status });
  } catch (error) {
    logger.error("[requirement-evidence:create] failed", { requestId, tenderId, requirementId, detail: error });
    return safe("EVIDENCE_DECISION_CREATE_FAILED", "Evidence decision could not be created. Check source grounding and evidence ownership.", requestId, 422);
  }
}