import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const DIMENSION_ORDER = [
  "DISCIPLINE_FIT",
  "SCOPE_COVERAGE",
  "SENIORITY_OR_SCALE",
  "SECTOR_FIT",
  "ROLE_RECENCY",
  "EVIDENCE_QUALITY",
  "COMPLIANCE_CRITICALITY",
  "PORTFOLIO_CONTRIBUTION",
  "MANDATORY_ELIGIBILITY",
  "DELIVERY_RISK",
  "DIFFERENTIATION",
  "COMMERCIAL_VALUE",
] as const;

type DimensionCode = (typeof DIMENSION_ORDER)[number];
type DimensionRow = {
  code: DimensionCode;
  score: number;
  weight: number;
  rationale: string | null;
  source: string;
};
type CorrectiveAction = {
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  action: string;
  dimension: DimensionCode;
};
type EntityBreakdown = {
  entityId: string;
  name: string;
  overallScore: number;
  matchScore: number;
  isSelected: boolean;
  dimensions: DimensionRow[];
  weakDimensions: DimensionCode[];
  correctiveActions: CorrectiveAction[];
};

function computeWeightedScore(dims: DimensionRow[]): number {
  if (dims.length === 0) return 0;
  const totalWeight = dims.reduce((sum, dim) => sum + dim.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(dims.reduce((sum, dim) => sum + dim.score * dim.weight, 0) / totalWeight);
}

function severityForScore(score: number): CorrectiveAction["severity"] {
  if (score < 25) return "HIGH";
  if (score < 40) return "MEDIUM";
  return "LOW";
}

function actionForWeakDimension(entityType: "EXPERT" | "PROJECT", dim: DimensionRow): CorrectiveAction {
  const severity = severityForScore(dim.score);
  const projectOrExpert = entityType === "EXPERT" ? "expert" : "project";
  switch (dim.code) {
    case "DISCIPLINE_FIT":
      return { severity, dimension: dim.code, title: "Weak discipline fit", action: "Automatic rematching will prefer the strongest eligible source-verified expert whose discipline matches this requirement. If none exists, add the actual missing expert evidence or record a JV/subcontractor mitigation." };
    case "SCOPE_COVERAGE":
      return { severity, dimension: dim.code, title: "Weak scope coverage", action: `The Engine will automatically link the strongest eligible source-verified ${projectOrExpert} covering the tender scope. If no such evidence exists, add the actual missing Vault source or record the scope gap as a bid risk with mitigation.` };
    case "SENIORITY_OR_SCALE":
      return { severity, dimension: dim.code, title: "Seniority/scale gap", action: entityType === "EXPERT" ? "Automatic rematching will prefer a more senior eligible expert. Add the actual credential source only when Company Vault contains no evidence proving the required experience." : "Automatic rematching will prefer a larger comparable eligible project. Add actual contract/value evidence only when it is absent from Company Vault." };
    case "SECTOR_FIT":
      return { severity, dimension: dim.code, title: "Sector-fit gap", action: entityType === "PROJECT" ? "Automatic rematching will select the closest eligible sector-specific project. If no qualifying reference exists, add the actual missing project source or a specialist/JV mitigation." : "Automatic rematching will prefer an eligible expert with sector-aligned discipline evidence. If none exists, add the actual missing source or a specialist partner." };
    case "ROLE_RECENCY":
      return { severity, dimension: dim.code, title: "Recency gap", action: `Automatic rematching will prefer a more recent eligible ${projectOrExpert}. Add recency evidence only when the verified Vault record lacks it.` };
    case "EVIDENCE_QUALITY":
      return { severity, dimension: dim.code, title: "Evidence quality gap", action: "Company Vault ingestion and automatic matching will attach current source-verified credentials, CV evidence, completion records, contract pages, or client references. Upload only the actual missing source document." };
    case "COMPLIANCE_CRITICALITY":
      return { severity, dimension: dim.code, title: "Compliance-critical gap", action: "Automatic requirement coverage will persist the strongest current eligible evidence link. If no evidence qualifies, the system will retain a true-gap blocker and request only the missing source document or a documented mitigation." };
    case "PORTFOLIO_CONTRIBUTION":
      return { severity, dimension: dim.code, title: "Portfolio contribution gap", action: "Automatic project rematching will prefer source-verified references that most directly improve past-performance coverage. Add a new source only when no qualifying project exists." };
    case "MANDATORY_ELIGIBILITY":
      return { severity, dimension: dim.code, title: "Mandatory eligibility gap", action: "Company Vault will automatically verify and link the required licence, registration, certificate, financial record, or eligibility evidence. Supply the actual missing official source only if no current eligible record exists." };
    case "DELIVERY_RISK":
      return { severity, dimension: dim.code, title: "Delivery-risk gap", action: "The Engine will automatically prefer lower-risk eligible evidence. Where the underlying capability is genuinely absent, persist a mitigation plan, stronger team assignment, or JV response." };
    case "DIFFERENTIATION":
      return { severity, dimension: dim.code, title: "Differentiation gap", action: "The Engine will derive differentiators only from source-verified company records and current methodology evidence. Add a source document only when the supporting fact is genuinely absent." };
    case "COMMERCIAL_VALUE":
      return { severity, dimension: dim.code, title: "Commercial-value gap", action: "Automatic matching will use verified comparable value and scale evidence while keeping pricing out of technical documents and inside the financial envelope." };
  }
}

function deriveCorrectiveActions(entityType: "EXPERT" | "PROJECT", dims: DimensionRow[]): CorrectiveAction[] {
  return dims
    .filter((dim) => dim.score < 40)
    .sort((left, right) => left.score - right.score)
    .slice(0, 4)
    .map((dim) => actionForWeakDimension(entityType, dim));
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`score-breakdown:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!tender) {
      return NextResponse.json({ ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
    }

    const [breakdownRows, expertMatches, projectMatches] = await Promise.all([
      prisma.matchScoreBreakdown.findMany({
        where: { tenderId: id },
        orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { dimensionCode: "asc" }],
      }),
      prisma.tenderExpertMatch.findMany({
        where: { tenderId: id },
        select: { expertId: true, score: true, isSelected: true, expert: { select: { fullName: true } } },
      }),
      prisma.tenderProjectMatch.findMany({
        where: { tenderId: id },
        select: { projectId: true, score: true, isSelected: true, project: { select: { name: true } } },
      }),
    ]);

    const dimsByEntity = new Map<string, DimensionRow[]>();
    for (const row of breakdownRows) {
      if (!DIMENSION_ORDER.includes(row.dimensionCode as DimensionCode)) continue;
      const dims = dimsByEntity.get(row.entityId) ?? [];
      dims.push({
        code: row.dimensionCode as DimensionCode,
        score: Math.round(row.score),
        weight: row.weight,
        rationale: row.rationale,
        source: row.source,
      });
      dimsByEntity.set(row.entityId, dims);
    }
    for (const dims of dimsByEntity.values()) {
      dims.sort((left, right) => DIMENSION_ORDER.indexOf(left.code) - DIMENSION_ORDER.indexOf(right.code));
    }

    function buildBreakdown(
      entityType: "EXPERT" | "PROJECT",
      entityId: string,
      name: string,
      matchScore: number,
      isSelected: boolean,
    ): EntityBreakdown {
      const dimensions = dimsByEntity.get(entityId) ?? [];
      const overallScore = dimensions.length > 0 ? computeWeightedScore(dimensions) : Math.round(matchScore * 100);
      return {
        entityId,
        name,
        overallScore,
        matchScore: Math.round(matchScore * 100),
        isSelected,
        dimensions,
        weakDimensions: dimensions.filter((dim) => dim.score < 40).map((dim) => dim.code),
        correctiveActions: deriveCorrectiveActions(entityType, dimensions),
      };
    }

    const experts = expertMatches
      .map((match) => buildBreakdown("EXPERT", match.expertId, match.expert.fullName, match.score, match.isSelected))
      .sort((left, right) => right.overallScore - left.overallScore);
    const projects = projectMatches
      .map((match) => buildBreakdown("PROJECT", match.projectId, match.project.name, match.score, match.isSelected))
      .sort((left, right) => right.overallScore - left.overallScore);

    const hasDimensionData = experts.some((entity) => entity.dimensions.length > 0)
      || projects.some((entity) => entity.dimensions.length > 0);
    const correctiveActionSummary = [...experts, ...projects]
      .flatMap((entity) => entity.correctiveActions.map((action) => ({ entity: entity.name, selected: entity.isSelected, ...action })))
      .sort((left, right) => (
        left.severity === right.severity ? 0
          : left.severity === "HIGH" ? -1
            : right.severity === "HIGH" ? 1
              : left.severity === "MEDIUM" ? -1 : 1
      ))
      .slice(0, 8);

    return NextResponse.json({
      ok: true,
      experts,
      projects,
      hasDimensionData,
      dimensionOrder: DIMENSION_ORDER,
      correctiveActionSummary,
      remediationMode: "AUTOMATIC_SOURCE_VERIFIED",
      manualEvidenceLinkingRequired: false,
    });
  } catch (error) {
    logger.error("score-breakdown GET failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Score breakdown could not be loaded.",
        code: "SCORE_BREAKDOWN_RUNTIME_ERROR",
        requestId,
      },
      { status: 500 },
    );
  }
}
