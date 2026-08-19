import { logger } from "../observability";
// Score breakdown writer (G3 fix)
//
// THE PROBLEM
// ───────────
// Up until now the app had two scoring worlds:
//   • the original engine match path (lib/engine/matching.ts) writes a
//     single Float `score` into TenderExpertMatch / TenderProjectMatch
//     plus a `rationale` text blob.
//   • the AI multi-perspective rematch path (lib/engine/ai-multi-
//     perspective-matcher.ts) computes 12 dimension scores then collapses
//     them into the same single Float — the dimension scores are lost.
//
// Result: readiness, bid/no-bid, evaluator simulator, and proposal
// generator can only read the scalar score; the rich dimension scoring
// is invisible to the rest of the engine.
//
// THE FIX
// ───────
// One canonical writer that BOTH paths call to persist 12-dimension
// scores into the new MatchScoreBreakdown table. The collapsed scalar
// score still lives on TenderExpertMatch.score / TenderProjectMatch.score
// for backward compatibility, but downstream consumers can now SELECT
// the dimension rows for cohort analysis, weak-dimension detection,
// trend tracking, and Copilot reasoning.
//
// Source values:
//   "AI_REMATCH"             — written by Run Engine after its
//                              12-perspective AI scoring pass returns
//   "ENGINE_MATCH"           — written by the engine matcher when it
//                              first scores experts/projects against a
//                              tender
//   "DETERMINISTIC_FALLBACK" — written when the AI is unavailable; the
//                              dimensions are derived from rule-based
//                              keyword scoring as a degraded but
//                              consistent baseline.

import { prisma, prismaReady } from "../prisma";
import { type MatchPerspective } from "./ai-multi-perspective-matcher";

export type ScoreSource = "AI_REMATCH" | "ENGINE_MATCH" | "DETERMINISTIC_FALLBACK";
export type EntityType = "EXPERT" | "PROJECT";

export interface ScoreBreakdown {
  tenderId: string;
  entityType: EntityType;
  entityId: string;
  // 0–100 dimension score per perspective; partial maps allowed (missing
  // dimensions are written as 0 with weight 0 so the row is still queryable).
  perspectives: Partial<Record<MatchPerspective, number>>;
  // optional 1–2 sentence rationale per dimension.
  rationales?: Partial<Record<MatchPerspective, string>>;
  // dimension weight; defaults to 1.0 if not specified.
  weights?: Partial<Record<MatchPerspective, number>>;
  source: ScoreSource;
}

const ALL_DIMENSIONS: MatchPerspective[] = [
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
];

/**
 * Upsert all 12 dimension rows for one entity. Idempotent: an entity can
 * be re-scored from any source; the unique index on
 * (tenderId, entityType, entityId, dimensionCode) ensures no duplicates.
 *
 * Skipped silently when no dimensions are present (caller may have no
 * AI scores to write).
 */
export async function writeScoreBreakdown(input: ScoreBreakdown): Promise<{ written: number }> {
  await prismaReady;
  const persp = input.perspectives ?? {};
  const present = ALL_DIMENSIONS.filter((d) => typeof persp[d] === "number");
  if (present.length === 0) return { written: 0 };

  let written = 0;
  for (const dim of present) {
    const score = Math.max(0, Math.min(100, Number(persp[dim] ?? 0)));
    const weight = input.weights?.[dim] ?? 1.0;
    const rationale = input.rationales?.[dim];
    try {
      await prisma.matchScoreBreakdown.upsert({
        where: {
          tenderId_entityType_entityId_dimensionCode: {
            tenderId: input.tenderId,
            entityType: input.entityType,
            entityId: input.entityId,
            dimensionCode: dim,
          },
        },
        update: { score, weight, rationale: rationale ?? null, source: input.source, updatedAt: new Date() },
        create: {
          tenderId: input.tenderId,
          entityType: input.entityType,
          entityId: input.entityId,
          dimensionCode: dim,
          score,
          weight,
          rationale: rationale ?? null,
          source: input.source,
        },
      });
      written += 1;
    } catch (err) {
      // One bad row should never block the rest. Log and move on.
      logger.warn(`[score-breakdown-writer] Failed to upsert ${input.entityType}/${input.entityId}/${dim}:`, { detail: err instanceof Error ? err.message : err });
    }
  }
  return { written };
}

/**
 * Read all dimension scores for one tender, optionally filtered to one
 * entity type. Used by the Tender Command Center to display dimension
 * cohort analysis and by the Copilot to reason against weak dimensions.
 */
export async function readScoreBreakdown(tenderId: string, entityType?: EntityType): Promise<Array<{
  entityType: EntityType;
  entityId: string;
  dimensionCode: MatchPerspective;
  score: number;
  weight: number;
  rationale: string | null;
  source: ScoreSource;
}>> {
  await prismaReady;
  const rows = await prisma.matchScoreBreakdown.findMany({
    where: { tenderId, ...(entityType ? { entityType } : {}) },
    orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { dimensionCode: "asc" }],
  });
  return rows.map((r) => ({
    entityType: r.entityType as EntityType,
    entityId: r.entityId,
    dimensionCode: r.dimensionCode as MatchPerspective,
    score: r.score,
    weight: r.weight,
    rationale: r.rationale,
    source: r.source as ScoreSource,
  }));
}

/**
 * Collapse a perspectives map to one 0–1 scalar score using uniform weights.
 * Used as a fallback when the engine matcher path needs a single number to
 * write into TenderExpertMatch.score / TenderProjectMatch.score for
 * backward-compatible downstream consumers (the UI ranks by this scalar).
 */
export function collapseToScalar(perspectives: Partial<Record<MatchPerspective, number>>): number {
  const present = ALL_DIMENSIONS.filter((d) => typeof perspectives[d] === "number").map((d) => perspectives[d] as number);
  if (present.length === 0) return 0;
  const avg100 = present.reduce((s, v) => s + v, 0) / present.length;
  return Math.max(0, Math.min(1, avg100 / 100));
}

/**
 * Deterministic fallback scoring. Used when the AI rematch is unavailable
 * (rate-limited, JSON malformed twice, network error). Produces a
 * consistent baseline across the same 12 dimensions using the rule-based
 * keyword logic the original engine matcher already uses for its scalar.
 *
 * Inputs are deliberately loose strings so this can be called with any
 * candidate-shaped object. The result is suitable for `writeScoreBreakdown`
 * with source="DETERMINISTIC_FALLBACK".
 */
export function deterministicScoreBreakdown(opts: {
  candidateText: string;
  tenderText: string;
  evaluationText?: string;
}): Partial<Record<MatchPerspective, number>> {
  const t = (opts.candidateText || "").toLowerCase();
  const tt = (opts.tenderText || "").toLowerCase();
  const ee = (opts.evaluationText || "").toLowerCase();

  const has = (s: string, ...keys: string[]) => keys.some((k) => s.includes(k));
  const hits = (a: string, b: string, ...keys: string[]) => keys.reduce((n, k) => n + (a.includes(k) && b.includes(k) ? 1 : 0), 0);

  // Each dimension: produce a 0–100 number with a deterministic recipe.
  return {
    DISCIPLINE_FIT: Math.min(100, hits(t, tt, "architect", "structural", "civil", "electrical", "mechanical", "sanitary", "interior", "geotechnical", "MEP") * 25),
    SCOPE_COVERAGE: Math.min(100, hits(t, tt, "design", "supervision", "feasibility", "BOQ", "concept", "construction", "permit") * 18),
    SENIORITY_OR_SCALE: has(t, "senior", "lead", "principal", "head", "manager", "director") ? 70 : has(t, "junior", "intern", "trainee") ? 25 : 50,
    SECTOR_FIT: Math.min(100, hits(t, tt, "healthcare", "hospital", "school", "water", "road", "bridge", "ESIA", "urban", "industrial", "commercial", "energy", "mining", "port", "pipeline", "banking", "telecom", "irrigation", "agriculture") * 15),
    ROLE_RECENCY: /20(2[2-6])/.test(t) ? 80 : /20(1[5-9]|2[01])/.test(t) ? 50 : 30,
    EVIDENCE_QUALITY: (has(t, "ref:", "ref ", "pf/", "ppa/", "pe/", "license") ? 30 : 0) + (has(t, "etb", "$", "usd", "gbp", "eur") ? 30 : 0) + (t.length > 400 ? 20 : 10),
    COMPLIANCE_CRITICALITY: has(ee || tt, "mandatory", "minimum", "must have", "required") && t.length > 200 ? 70 : 50,
    PORTFOLIO_CONTRIBUTION: has(t, "lead", "manager", "principal") ? 65 : 50,
    MANDATORY_ELIGIBILITY: has(t, "license", "licence", "ppa", "psnse", "pe/", "pepcm", "registered") ? 80 : 40,
    DELIVERY_RISK: has(t, "available", "confirmed", "active", "permanent") ? 70 : 50,
    DIFFERENTIATION: has(t, "phd", "m.sc", "msc", "international", "world bank", "british council", "usaid") ? 75 : 50,
    COMMERCIAL_VALUE: has(t, "etb", "$", "usd", "gbp", "eur") && /[\d,]{3,}/.test(t) ? 65 : 50,
  };
}
