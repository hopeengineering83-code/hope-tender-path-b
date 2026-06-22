// GET /api/tenders/[id]/score-breakdown
//
// Returns the 12-perspective match dimension scores for every expert and
// project that has been scored against this tender. Joins entity names
// from the Expert and Project tables so the UI can display them without
// a second round-trip.
//
// Auth: ADMIN, PROPOSAL_MANAGER, REVIEWER
// Rate: API_RATE_LIMIT (read-only)

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { reportError } from "../../../../../lib/observability";

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
  const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = dims.reduce((s, d) => s + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
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
      return {
        severity,
        dimension: dim.code,
        title: "Weak discipline fit",
        action: "Select a reviewed expert whose discipline directly matches the tender requirement, or add a JV/subcontractor mitigation for the missing discipline.",
      };
    case "SCOPE_COVERAGE":
      return {
        severity,
        dimension: dim.code,
        title: "Weak scope coverage",
        action: `Link a reviewed ${projectOrExpert} evidence record that covers the tender scope, or mark the scope gap as a bid risk with mitigation.`,
      };
    case "SENIORITY_OR_SCALE":
      return {
        severity,
        dimension: dim.code,
        title: "Seniority/scale gap",
        action: entityType === "EXPERT"
          ? "Select a more senior reviewed expert or attach credentials proving years of experience."
          : "Select a larger comparable reviewed project or add project-value evidence.",
      };
    case "SECTOR_FIT":
      return {
        severity,
        dimension: dim.code,
        title: "Sector-fit gap",
        action: entityType === "PROJECT"
          ? "Select the closest reviewed sector-specific project, especially hospital/healthcare/building references where relevant, or add JV mitigation."
          : "Select an expert with sector-aligned discipline/sector evidence or add a specialist partner.",
      };
    case "ROLE_RECENCY":
      return {
        severity,
        dimension: dim.code,
        title: "Recency gap",
        action: `Use a more recent reviewed ${projectOrExpert} record or attach recency evidence before relying on this match.`,
      };
    case "EVIDENCE_QUALITY":
      return {
        severity,
        dimension: dim.code,
        title: "Evidence quality gap",
        action: "Attach reviewed source evidence, certificate, CV credential, project completion letter, contract page, or client reference before final generation.",
      };
    case "COMPLIANCE_CRITICALITY":
      return {
        severity,
        dimension: dim.code,
        title: "Compliance-critical gap",
        action: "Link this weak dimension to the mandatory requirement coverage panel and resolve it with reviewed vault evidence or a documented mitigation.",
      };
    case "PORTFOLIO_CONTRIBUTION":
      return {
        severity,
        dimension: dim.code,
        title: "Portfolio contribution gap",
        action: "Select stronger reviewed project references that directly improve the proposal's past-performance evidence.",
      };
    case "MANDATORY_ELIGIBILITY":
      return {
        severity,
        dimension: dim.code,
        title: "Mandatory eligibility gap",
        action: "Attach or review the required license, registration, certificate, financial record, or eligibility evidence before final export.",
      };
    case "DELIVERY_RISK":
      return {
        severity,
        dimension: dim.code,
        title: "Delivery-risk gap",
        action: "Add a mitigation plan, stronger team role assignment, or lower-risk reviewed project evidence.",
      };
    case "DIFFERENTIATION":
      return {
        severity,
        dimension: dim.code,
        title: "Differentiation gap",
        action: "Add a unique value proposition, comparable innovation, or stronger methodology evidence supported by reviewed company records.",
      };
    case "COMMERCIAL_VALUE":
      return {
        severity,
        dimension: dim.code,
        title: "Commercial-value gap",
        action: "Use comparable value/scale evidence and avoid pricing claims in technical documents; keep financial details in the financial envelope.",
      };
  }
}

function deriveCorrectiveActions(entityType: "EXPERT" | "PROJECT", dims: DimensionRow[]): CorrectiveAction[] {
  return dims
    .filter((d) => d.score < 40)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((dim) => actionForWeakDimension(entityType, dim));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`score-breakdown:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

    // Load all dimension rows for this tender
    const breakdownRows = await prisma.matchScoreBreakdown.findMany({
      where: { tenderId: id },
      orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { dimensionCode: "asc" }],
    });

    // Load expert matches with names
    const expertMatches = await prisma.tenderExpertMatch.findMany({
      where: { tenderId: id },
      select: { expertId: true, score: true, isSelected: true, expert: { select: { fullName: true } } },
    });

    // Load project matches with names
    const projectMatches = await prisma.tenderProjectMatch.findMany({
      where: { tenderId: id },
      select: { projectId: true, score: true, isSelected: true, project: { select: { name: true } } },
    });

    // Build lookup: entityId → dimension rows
    const dimsByEntity = new Map<string, DimensionRow[]>();
    for (const row of breakdownRows) {
      const key = row.entityId;
      if (!dimsByEntity.has(key)) dimsByEntity.set(key, []);
      const ordered = DIMENSION_ORDER.indexOf(row.dimensionCode as DimensionCode);
      if (ordered !== -1) {
        dimsByEntity.get(key)!.push({
          code: row.dimensionCode as DimensionCode,
          score: Math.round(row.score),
          weight: row.weight,
          rationale: row.rationale,
          source: row.source,
        });
      }
    }

    // Sort each entity's dimensions in canonical order
    for (const dims of dimsByEntity.values()) {
      dims.sort((a, b) => DIMENSION_ORDER.indexOf(a.code) - DIMENSION_ORDER.indexOf(b.code));
    }

    function buildBreakdown(
      entityType: "EXPERT" | "PROJECT",
      entityId: string,
      name: string,
      matchScore: number,
      isSelected: boolean,
    ): EntityBreakdown {
      const dims = dimsByEntity.get(entityId) ?? [];
      const overallScore = dims.length > 0 ? computeWeightedScore(dims) : Math.round(matchScore * 100);
      const weakDimensions = dims.filter((d) => d.score < 40).map((d) => d.code);
      const correctiveActions = deriveCorrectiveActions(entityType, dims);
      return { entityId, name, overallScore, matchScore: Math.round(matchScore * 100), isSelected, dimensions: dims, weakDimensions, correctiveActions };
    }

    const experts: EntityBreakdown[] = expertMatches
      .map((m) => buildBreakdown("EXPERT", m.expertId, m.expert.fullName, m.score, m.isSelected))
      .sort((a, b) => b.overallScore - a.overallScore);

    const projects: EntityBreakdown[] = projectMatches
      .map((m) => buildBreakdown("PROJECT", m.projectId, m.project.name, m.score, m.isSelected))
      .sort((a, b) => b.overallScore - a.overallScore);

    const hasDimensionData =
      experts.some((e) => e.dimensions.length > 0) ||
      projects.some((p) => p.dimensions.length > 0);

    const correctiveActionSummary = [...experts, ...projects]
      .flatMap((entity) => entity.correctiveActions.map((action) => ({ entity: entity.name, selected: entity.isSelected, ...action })))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "HIGH" ? -1 : b.severity === "HIGH" ? 1 : a.severity === "MEDIUM" ? -1 : 1))
      .slice(0, 8);

    return NextResponse.json({
      ok: true,
      experts,
      projects,
      hasDimensionData,
      dimensionOrder: DIMENSION_ORDER,
      correctiveActionSummary,
    });
  } catch (error) {
    void reportError(error, { route: "/api/tenders/[id]/score-breakdown" });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
