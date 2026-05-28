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

type EntityBreakdown = {
  entityId: string;
  name: string;
  overallScore: number;
  matchScore: number;
  isSelected: boolean;
  dimensions: DimensionRow[];
  weakDimensions: DimensionCode[];
};

function computeWeightedScore(dims: DimensionRow[]): number {
  if (dims.length === 0) return 0;
  const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = dims.reduce((s, d) => s + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
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
      entityId: string,
      name: string,
      matchScore: number,
      isSelected: boolean,
    ): EntityBreakdown {
      const dims = dimsByEntity.get(entityId) ?? [];
      const overallScore = dims.length > 0 ? computeWeightedScore(dims) : Math.round(matchScore * 100);
      const weakDimensions = dims.filter((d) => d.score < 40).map((d) => d.code);
      return { entityId, name, overallScore, matchScore: Math.round(matchScore * 100), isSelected, dimensions: dims, weakDimensions };
    }

    const experts: EntityBreakdown[] = expertMatches
      .map((m) => buildBreakdown(m.expertId, m.expert.fullName, m.score, m.isSelected))
      .sort((a, b) => b.overallScore - a.overallScore);

    const projects: EntityBreakdown[] = projectMatches
      .map((m) => buildBreakdown(m.projectId, m.project.name, m.score, m.isSelected))
      .sort((a, b) => b.overallScore - a.overallScore);

    const hasDimensionData =
      experts.some((e) => e.dimensions.length > 0) ||
      projects.some((p) => p.dimensions.length > 0);

    return NextResponse.json({
      ok: true,
      experts,
      projects,
      hasDimensionData,
      dimensionOrder: DIMENSION_ORDER,
    });
  } catch (error) {
    console.error("score-breakdown GET failed", error);
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
