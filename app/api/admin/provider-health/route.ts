// Admin endpoint: provider health summary (ADMIN_SECRET-protected).
//
// Returns the DB-backed provider health table so an operator can check
// which providers are cooling down after a cold start, without relying on
// in-memory state that resets on every Vercel instance recycle.
//
// Auth: Bearer token in Authorization header must match ADMIN_SECRET env var.
// Never exposes API keys, raw provider bodies, or prompts.

import { NextRequest, NextResponse } from "next/server";
import { getProviderHealthSummary } from "@/lib/engine/provider-health-store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const health = await getProviderHealthSummary();

  return NextResponse.json({
    providers: health,
    timestamp: new Date().toISOString(),
    summary: {
      totalTracked: health.length,
      cooling: health.filter((p) => p.cooldownUntil && p.cooldownUntil > new Date()).map((p) => p.provider),
      healthy: health.filter((p) => p.status === "OK").map((p) => p.provider),
    },
  });
}
