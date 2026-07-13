import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { z } from "zod";

/**
 * Manual Requirement Entry
 *
 * Human-entered requirements are useful draft inputs, but they are never
 * tender-source evidence. The canonical generation/export gate still requires
 * active-file + page + verbatim-quote grounding for every mandatory item.
 */

const MANUAL_SOURCE_ORIGINS = ["HUMAN_ENTERED", "NOT_STATED", "CANDIDATE_REVIEW"] as const;
type ManualSourceOrigin = (typeof MANUAL_SOURCE_ORIGINS)[number];

const manualRequirementSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  requirementType: z.enum([
    "ELIGIBILITY", "QUALIFICATIONS", "COMPANY_EXPERIENCE", "PERSONNEL",
    "METHODOLOGY", "DELIVERABLES", "WORK_PLAN", "REQUIRED_DOCUMENTS",
    "EVALUATION_CRITERIA", "BID_SECURITY", "PRICING", "LANGUAGE",
    "SUBMISSION_RULES", "TECHNICAL_ENVELOPE", "FINANCIAL_ENVELOPE",
    "ANNEXES", "FILE_NAMES", "FORMATTING", "CONTRACTS", "COMPLIANCE", "OTHER",
  ]),
  priority: z.enum(["MANDATORY", "CRITICAL", "ADVISORY", "SCORED", "INFORMATIONAL"]),
  sourceOrigin: z.enum(MANUAL_SOURCE_ORIGINS).default("HUMAN_ENTERED"),
  reason: z.string().min(1).max(2000),
  linkedProposalSection: z.string().optional().nullable(),
  linkedCompanyEvidenceId: z.string().optional().nullable(),
  exactFileName: z.string().optional().nullable(),
  exactOrder: z.number().optional().nullable(),
  pageLimit: z.number().optional().nullable(),
  sectionReference: z.string().optional().nullable(),
});

type ManualAudit = {
  sourceOrigin: ManualSourceOrigin;
  reason: string | null;
  enteredBy: string | null;
  enteredAt: Date | null;
};

function parseManualAuditMetadata(value: string): Pick<ManualAudit, "sourceOrigin" | "reason"> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const sourceOrigin = MANUAL_SOURCE_ORIGINS.includes(parsed.sourceOrigin as ManualSourceOrigin)
      ? parsed.sourceOrigin as ManualSourceOrigin
      : "HUMAN_ENTERED";
    const reason = typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : null;
    return { sourceOrigin, reason };
  } catch {
    return { sourceOrigin: "HUMAN_ENTERED", reason: null };
  }
}

function legacyManualReason(sourceExactQuote: string | null | undefined): string | null {
  const quote = sourceExactQuote?.trim() ?? "";
  if (!quote.startsWith("[MANUAL]")) return null;
  return quote.slice("[MANUAL]".length).trim() || null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(request);
  const limit = await rateLimitPersistent(`manual-requirement:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requirement updates", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId } = await params;
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
      { status: 400 },
    );
  }

  const data = parseResult.data;
  const requirement = await prisma.tenderRequirement.create({
    data: {
      tenderId,
      title: data.title,
      description: data.description,
      requirementType: data.requirementType,
      priority: data.priority,
      // Human input is not a verbatim tender quote. Keep source fields empty so
      // no UI or downstream consumer can mistake it for source-grounded evidence.
      sourceExactQuote: null,
      sourceTenderFileId: null,
      sourcePageNumber: null,
      sourceExtractionMethod: "MANUAL",
      sourceConfidence: 0,
      linkedProposalSection: data.linkedProposalSection ?? null,
      linkedCompanyEvidenceId: data.linkedCompanyEvidenceId ?? null,
      exactFileName: data.exactFileName ?? null,
      exactOrder: data.exactOrder ?? null,
      pageLimit: data.pageLimit ?? null,
      sectionReference: data.sectionReference ?? null,
      sourceSectionHeading: "Manual Entry — not tender-source evidence",
    },
  });

  await logAction({
    userId: actor.id,
    action: "TENDER_UPDATE",
    entityType: "TenderRequirement",
    entityId: requirement.id,
    description: `Manual requirement "${data.title}" added to tender "${tender.title ?? "[Untitled]"}"`,
    metadata: {
      tenderId,
      requirementType: data.requirementType,
      priority: data.priority,
      sourceOrigin: data.sourceOrigin,
      reason: data.reason,
      sourceGrounded: false,
    },
    requestId,
  });

  return NextResponse.json({
    success: true,
    requirement: {
      ...requirement,
      sourceOrigin: data.sourceOrigin,
      isManual: true,
      sourceGrounded: false,
      manualReason: data.reason,
      manualEnteredBy: actor.id,
      manualEnteredAt: requirement.createdAt,
    },
  });
}

/**
 * List all requirements, reconstructing durable manual provenance from the
 * immutable audit log. Legacy `[MANUAL] reason` rows remain readable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found or access denied" }, { status: 404 });
  }

  const requirements = await prisma.tenderRequirement.findMany({
    where: { tenderId },
    orderBy: { createdAt: "desc" },
  });
  const manualRequirementIds = requirements
    .filter((requirement) => requirement.sourceExtractionMethod === "MANUAL" || requirement.sourceExactQuote?.startsWith("[MANUAL]"))
    .map((requirement) => requirement.id);

  const auditRows = manualRequirementIds.length > 0
    ? await prisma.auditLog.findMany({
        where: {
          action: "TENDER_UPDATE",
          entityType: "TenderRequirement",
          entityId: { in: manualRequirementIds },
        },
        select: { entityId: true, userId: true, createdAt: true, metadata: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const manualAuditByRequirement = new Map<string, ManualAudit>();
  for (const row of auditRows) {
    if (!row.entityId || manualAuditByRequirement.has(row.entityId)) continue;
    const parsed = parseManualAuditMetadata(row.metadata);
    manualAuditByRequirement.set(row.entityId, {
      ...parsed,
      enteredBy: row.userId,
      enteredAt: row.createdAt,
    });
  }

  return NextResponse.json({
    requirements: requirements.map((requirement) => {
      const isManual = requirement.sourceExtractionMethod === "MANUAL"
        || requirement.sourceExactQuote?.startsWith("[MANUAL]")
        || false;
      const audit = isManual ? manualAuditByRequirement.get(requirement.id) : undefined;
      return {
        ...requirement,
        isManual,
        sourceOrigin: isManual ? audit?.sourceOrigin ?? "HUMAN_ENTERED" : "SOURCE_GROUNDED",
        sourceGrounded: !isManual && Boolean(requirement.sourceTenderFileId && requirement.sourcePageNumber && requirement.sourceExactQuote),
        manualReason: isManual ? audit?.reason ?? legacyManualReason(requirement.sourceExactQuote) : null,
        manualEnteredBy: isManual ? audit?.enteredBy ?? null : null,
        manualEnteredAt: isManual ? audit?.enteredAt ?? requirement.createdAt : null,
      };
    }),
  });
}
