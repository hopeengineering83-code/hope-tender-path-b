import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { z } from "zod";

/**
 * Manual Requirement Entry
 *
 * Allows authorized users (ADMIN, PROPOSAL_MANAGER) to add requirements
 * that were missed by extraction or not stated in the tender source.
 *
 * Manual requirements:
 * - Are included in analysis, matching, draft BuildPlan input, and proposal preparation
 * - Are visibly identified as human-entered, NOT tender-source quotations
 * - Retain user, timestamp, reason, and classification
 * - Are editable by authorized roles
 * - Are tenant-isolated
 * - Are preserved through re-analysis unless explicitly superseded by reviewed source-grounded requirements
 */

const manualRequirementSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  requirementType: z.enum([
    "ELIGIBILITY", "QUALIFICATIONS", "COMPANY_EXPERIENCE", "PERSONNEL",
    "METHODOLOGY", "DELIVERABLES", "WORK_PLAN", "REQUIRED_DOCUMENTS",
    "EVALUATION_CRITERIA", "BID_SECURITY", "PRICING", "LANGUAGE",
    "SUBMISSION_RULES", "TECHNICAL_ENVELOPE", "FINANCIAL_ENVELOPE",
    "ANNEXES", "FILE_NAMES", "FORMATTING", "CONTRACTS", "COMPLIANCE", "OTHER"
  ]),
  priority: z.enum(["MANDATORY", "CRITICAL", "ADVISORY", "SCORED", "INFORMATIONAL"]),
  sourceOrigin: z.enum(["SOURCE_GROUNDED", "HUMAN_ENTERED", "NOT_STATED", "CANDIDATE_REVIEW"]).default("HUMAN_ENTERED"),
  reason: z.string().min(1).max(2000),
  linkedProposalSection: z.string().optional().nullable(),
  linkedCompanyEvidenceId: z.string().optional().nullable(),
  exactFileName: z.string().optional().nullable(),
  exactOrder: z.number().optional().nullable(),
  pageLimit: z.number().optional().nullable(),
  sectionReference: z.string().optional().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
    if (!actor) return forbiddenResponse();
  } catch {
    return forbiddenResponse();
  }

  const { id: tenderId } = params;

  // Verify tender ownership and tenant isolation
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true, title: true },
  });

  if (!tender) {
    return NextResponse.json({ error: "Tender not found or access denied" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = manualRequirementSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid requirement data", issues: parseResult.error.issues },
      { status: 400 }
    );
  }

  const data = parseResult.data;

  // Create the manual requirement
  const requirement = await prisma.requirement.create({
    data: {
      tenderId,
      title: data.title,
      description: data.description,
      requirementType: data.requirementType,
      priority: data.priority,
      sourceOrigin: data.sourceOrigin,
      sourceExactQuote: `[MANUAL] ${data.reason}`,
      sourceContentHash: `manual-${actor.id}-${Date.now()}`,
      extractionConfidence: 1.0, // Human-entered = full confidence in the entry itself
      extractionMethod: "MANUAL",
      status: "NEEDS_REVIEW",
      linkedProposalSection: data.linkedProposalSection ?? null,
      linkedCompanyEvidenceId: data.linkedCompanyEvidenceId ?? null,
      exactFileName: data.exactFileName ?? null,
      exactOrder: data.exactOrder ?? null,
      pageLimit: data.pageLimit ?? null,
      sectionReference: data.sectionReference ?? null,
      sourceSectionHeading: "Manual Entry",
      // Audit trail
      createdById: actor.id,
      createdAt: new Date(),
    },
  });

  await logAction({
    userId: actor.id,
    action: "MANUAL_REQUIREMENT_CREATED",
    entityType: "Requirement",
    entityId: requirement.id,
    description: `Manual requirement "${data.title}" added to tender "${tender.title ?? "[Untitled]"}"`,
    metadata: {
      tenderId,
      requirementType: data.requirementType,
      priority: data.priority,
      sourceOrigin: data.sourceOrigin,
      reason: data.reason,
    },
  });

  return NextResponse.json({
    success: true,
    requirement: {
      ...requirement,
      sourceOrigin: data.sourceOrigin,
      isManual: true,
    },
  });
}

/**
 * GET: List all requirements for a tender, distinguishing manual from source-grounded
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER");
    if (!actor) return forbiddenResponse();
  } catch {
    return forbiddenResponse();
  }

  const { id: tenderId } = params;

  // Verify tender access (tenant isolation)
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });

  if (!tender) {
    return NextResponse.json({ error: "Tender not found or access denied" }, { status: 404 });
  }

  const requirements = await prisma.requirement.findMany({
    where: { tenderId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    requirements: requirements.map((r) => ({
      ...r,
      isManual: r.extractionMethod === "MANUAL" || r.sourceExactQuote?.startsWith("[MANUAL]") || false,
      sourceOrigin: r.extractionMethod === "MANUAL" ? "HUMAN_ENTERED" : "SOURCE_GROUNDED",
    })),
  });
}
