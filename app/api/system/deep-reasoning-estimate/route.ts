import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { estimateDeepReasoningCost } from "../../../../lib/engine/deep-reasoning-estimate";

/**
 * Pre-generation cost estimate. UI surfaces this BEFORE the user
 * kicks off an expensive proposal generation so they can make an
 * informed decision on whether to enable deep reasoning for THIS
 * tender. POST with a JSON body describing the tender shape:
 *
 *   {
 *     tenderTextLength: number,    // characters in the analysed text
 *     expertCount: number,         // selected experts
 *     projectCount: number,        // selected projects
 *     expectedInitialScore?: number,
 *     refinementThreshold?: number,
 *     maxRefinementAttempts?: number,
 *   }
 *
 * Returns the estimate shape from `estimateDeepReasoningCost`:
 *   { willRun, blocker, worstCaseCalls, typicalCalls, steps, costGuard }
 *
 * The endpoint is read-only — it never runs AI or hits the database
 * for the tender's content. Safe for any logged-in user.
 */
export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    return fallback;
  };
  const optionalNum = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    return undefined;
  };

  const estimate = estimateDeepReasoningCost({
    tenderTextLength: num(b.tenderTextLength, 0),
    expertCount: num(b.expertCount, 0),
    projectCount: num(b.projectCount, 0),
    expectedInitialScore: optionalNum(b.expectedInitialScore),
    refinementThreshold: optionalNum(b.refinementThreshold),
    maxRefinementAttempts: optionalNum(b.maxRefinementAttempts),
    // Optional auto-trigger context — when the UI supplies tender
    // complexity, the estimate reflects auto-triggered deep reasoning.
    requirementCount: optionalNum(b.requirementCount),
    mandatoryRequirementCount: optionalNum(b.mandatoryRequirementCount),
    budget: typeof b.budget === "number" && Number.isFinite(b.budget) ? b.budget : undefined,
    totalPages: optionalNum(b.totalPages),
  });

  return NextResponse.json(estimate);
}
