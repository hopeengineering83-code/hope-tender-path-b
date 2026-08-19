import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { z } from "zod";

/**
 * PATCH: Update a manual requirement
 * Only ADMIN and PROPOSAL_MANAGER can edit manual requirements.
 * REVIEWER and VIEWER are rejected.
 */

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(5000).optional(),
  requirementType: z.enum([
    "ELIGIBILITY", "QUALIFICATIONS", "COMPANY_EXPERIENCE", "PERSONNEL",
    "METHODOLOGY", "DELIVERABLES", "WORK_PLAN", "REQUIRED_DOCUMENTS",
    "EVALUATION_CRITERIA", "BID_SECURITY", "PRICING", "LANGUAGE",
    "SUBMISSION_RULES", "TECHNICAL_ENVELOPE", "FINANCIAL_ENVELOPE",
    "ANNEXES", "FILE_NAMES", "FORMATTING", "CONTRACTS", "COMPLIANCE", "OTHER"
  ]).optional(),
  priority: z.enum(["MANDATORY", "CRITICAL", "ADVISORY", "SCORED", "INFORMATIONAL"]).optional(),
  reason: z.string().min(1).max(2000).optional(),
  linkedProposalSection: z.string().optional().nullable(),
  linkedCompanyEvidenceId: z.string().optional().nullable(),
  exactFileName: z.string().optional().nullable(),
  exactOrder: z.number().optional().nullable(),
  pageLimit: z.number().optional().nullable(),
  sectionReference: z.string().optional().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; requirementId: string }> }
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id: tenderId, requirementId } = await params;

  // Ensure the runtime schema bootstrap has completed before any DB query.
  // Without this, the first request after a fresh deploy / DB reset can
  // fail with "relation does not exist" before bootstrap finishes.
  await prismaReady;

  // Verify tender ownership (tenant isolation)
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true, title: true },
  });

  if (!tender) {
    return NextResponse.json({ error: "Tender not found or access denied" }, { status: 404 });
  }

  // Verify requirement belongs to this tender
  const existing = await prisma.tenderRequirement.findFirst({
    where: { id: requirementId, tenderId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  // Only allow editing manual requirements
  if (existing.sourceExtractionMethod !== "MANUAL") {
    return NextResponse.json(
      { error: "Only manually-entered requirements can be edited. Source-grounded requirements must be corrected via re-analysis." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = updateSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid update data", issues: parseResult.error.issues },
      { status: 400 }
    );
  }

  const data = parseResult.data;

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.requirementType !== undefined) updateData.requirementType = data.requirementType;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.linkedProposalSection !== undefined) updateData.linkedProposalSection = data.linkedProposalSection;
  if (data.linkedCompanyEvidenceId !== undefined) updateData.linkedCompanyEvidenceId = data.linkedCompanyEvidenceId;
  if (data.exactFileName !== undefined) updateData.exactFileName = data.exactFileName;
  if (data.exactOrder !== undefined) updateData.exactOrder = data.exactOrder;
  if (data.pageLimit !== undefined) updateData.pageLimit = data.pageLimit;
  if (data.sectionReference !== undefined) updateData.sectionReference = data.sectionReference;

  if (data.reason !== undefined) {
    updateData.sourceExactQuote = `[MANUAL] ${data.reason}`;
  }

  const updated = await prisma.tenderRequirement.update({
    where: { id: requirementId },
    data: updateData,
  });

  await logAction({
    userId: actor.id,
    action: "TENDER_UPDATE",
    entityType: "TenderRequirement",
    entityId: requirementId,
    description: `Manual requirement "${updated.title}" updated in tender "${tender.title ?? "[Untitled]"}"`,
    metadata: {
      tenderId,
      updatedFields: Object.keys(data),
    },
  });

  return NextResponse.json({
    success: true,
    requirement: {
      ...updated,
      isManual: true,
      sourceOrigin: "HUMAN_ENTERED",
    },
  });
}
