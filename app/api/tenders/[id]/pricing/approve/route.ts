import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { prismaReady } from "../../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { approvePricingEstimate } from "../../../../../../lib/engine/pricing-approval";
import { scheduleRequestScopedWorkerWake } from "../../../../../../lib/ai-jobs/request-scoped-worker-wake";

export const dynamic = "force-dynamic";

function numberMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    const n = Number(raw);
    if (key.length <= 200 && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** The owner approves (optionally adjusting) one pricing scenario. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`pricing-approve:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  await prismaReady;

  const result = await approvePricingEstimate({
    tenderId: id,
    userId: actor.id,
    actorLabel: actor.email ?? actor.id,
    request: {
      scenario: String(body.scenario ?? "") as never,
      rates: numberMap(body.rates),
      quantities: numberMap(body.quantities),
      exclude: Array.isArray(body.exclude) ? body.exclude.filter((k): k is string => typeof k === "string").slice(0, 500) : undefined,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, unpriced: result.unpriced }, { status: result.status });
  }
  if (result.finalize === "REQUEUED") scheduleRequestScopedWorkerWake(req, "AUTO_FINALIZE");
  return NextResponse.json({
    approved: { scenario: result.scenario, offerTotal: result.offerTotal, currency: result.currency, lineCount: result.lineCount },
    finalize: result.finalize,
  });
}
