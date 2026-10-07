import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { prismaReady } from "../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { logAction } from "../../../../lib/audit";
import { addRateCardEntries, deleteRateCardEntry, loadRateCard } from "../../../../lib/engine/pricing-rate-card";

export const dynamic = "force-dynamic";

/** The firm's rate card and the public benchmarks the estimator reads. */
export async function GET() {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) return forbiddenResponse();
  await prismaReady;
  const card = await loadRateCard(actor.id);
  return NextResponse.json(card);
}

/** Add rate-card entries: `{ entries: [...] }` or one entry. All-or-nothing. */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();
  const rl = await rateLimitPersistent(`pricing-rate-card:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const entries = Array.isArray(body.entries) ? body.entries : [body];
  await prismaReady;
  const result = await addRateCardEntries(actor.id, entries);
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, rejected: result.rejected ?? [] }, { status: result.status });
  await logAction({
    userId: actor.id,
    action: "PRICING_RATE_CARD_UPDATED",
    entityType: "PricingBenchmark",
    description: `Added ${result.added.length} rate-card entr${result.added.length === 1 ? "y" : "ies"}`,
    metadata: { added: result.added.map((b) => ({ id: b.id, category: b.category, label: b.label, unit: b.unit, currency: b.currency, median: b.median, source: b.source })) },
  });
  return NextResponse.json({ added: result.added }, { status: 201 });
}

/** Remove one rate-card entry: `?id=…`. Public benchmarks cannot be removed. */
export async function DELETE(req: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id || id.startsWith("seed-")) return NextResponse.json({ error: "Only rate-card entries can be removed." }, { status: 400 });
  await prismaReady;
  const result = await deleteRateCardEntry(actor.id, id);
  if (!result.ok) return NextResponse.json({ error: result.status === 503 ? "Rate card unavailable until the database migration runs." : "Not found" }, { status: result.status });
  await logAction({ userId: actor.id, action: "PRICING_RATE_CARD_UPDATED", entityType: "PricingBenchmark", entityId: id, description: "Removed a rate-card entry" });
  return NextResponse.json({ removed: id });
}
