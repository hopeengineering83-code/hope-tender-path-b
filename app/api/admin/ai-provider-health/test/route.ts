import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "@/lib/rate-limit";
import { type AiProviderName } from "@/lib/ai-provider-health";
import { CANONICAL_AI_PROVIDER_ORDER, automaticChainDisplay, isZeroPaidMode } from "@/lib/ai-provider-registry";
import {
  testProviderCapabilities,
  testAutomaticChainCapabilities,
  verifiedAnalysisProviders,
  type CapabilityName,
  type ProviderCapabilityReport,
} from "@/lib/ai-provider-capability-test";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Operator "Test provider chain".
 *
 * This route used to carry its own copy of every provider's wire call — its own
 * fetch, its own headers, its own model defaults. Two of those defaults openly
 * contradicted the registry (Gemini fell back to a different model than the one
 * AI Analyze uses; Anthropic to a hardcoded haiku alias), so the operator could
 * be shown a green provider that the workflow could not actually use. It also
 * wrote its findings into the routing health state, meaning that running the
 * diagnostic imposed real cooldowns on real analysis work.
 *
 * Both are gone. Everything here delegates to lib/ai-provider-capability-test.ts,
 * which drives the real runtime adapter and keeps its observations off the
 * routing path. There is now exactly one implementation of "call this provider".
 */

/** Legacy capability names accepted from existing clients. */
function normalizeCapability(raw: string | null | undefined): CapabilityName {
  if (raw === "analysis" || raw === "generation") return raw;
  if (raw === "connectivity") return "connectivity";
  // "ping" is what the existing operator UI sends for the connectivity check.
  return "connectivity";
}

export type ProviderTestResult = {
  provider: string;
  status: "ok" | "failed" | "skipped_cooldown" | "not_configured";
  capability: CapabilityName;
  model: string;
  durationMs: number;
  errorCategory?: string;
  safeError?: string;
  /** Whether the provider's own model listing confirms the account can call it. */
  modelConfirmedByProvider?: boolean | null;
};

export type ProviderTestSummary = {
  tested: number;
  ok: number;
  failed: number;
  skipped: number;
  notConfigured: number;
};

/** Flatten a capability report into the row shape the operator grid renders. */
function toRows(report: ProviderCapabilityReport): ProviderTestResult[] {
  return report.results.map((result) => ({
    provider: report.provider,
    capability: result.capability,
    status:
      result.status === "ok"
        ? "ok"
        : result.status === "skipped"
          // A provider excluded for requiring payment is NOT "not configured" —
          // the key may well be present. Reporting it as unconfigured would send
          // an operator hunting for a missing key that is already there.
          ? (result.category === "BILLING" ? "skipped_cooldown" : "not_configured")
          : "failed",
    model: result.model ?? "",
    durationMs: result.durationMs,
    errorCategory: result.category ?? undefined,
    safeError: result.safeMessage ?? undefined,
    modelConfirmedByProvider: result.modelConfirmedByProvider,
  }));
}

function summarizeResults(results: ProviderTestResult[]): ProviderTestSummary {
  return {
    tested: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped_cooldown").length,
    notConfigured: results.filter((r) => r.status === "not_configured").length,
  };
}

async function runTests(
  provider: AiProviderName | null,
  capability: CapabilityName,
): Promise<{ reports: ProviderCapabilityReport[]; results: ProviderTestResult[] }> {
  const reports = provider
    ? [await testProviderCapabilities(provider, { capabilities: [capability] })]
    : await testAutomaticChainCapabilities({ capabilities: [capability] });
  return { reports, results: reports.flatMap(toRows) };
}

function isKnownProvider(value: string): value is AiProviderName {
  return (CANONICAL_AI_PROVIDER_ORDER as readonly string[]).includes(value);
}

export async function GET(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  // Rate limit — this route makes one outbound API call per tested provider.
  const rl = await rateLimitPersistent(`provider-test:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const url = new URL(req.url);
  const requestedProvider = url.searchParams.get("provider");
  const provider = requestedProvider && isKnownProvider(requestedProvider) ? requestedProvider : null;
  const capability = normalizeCapability(url.searchParams.get("capability"));

  const { reports, results } = await runTests(provider, capability);

  await logAction({
    userId: actor.id,
    action: "CREATE",
    entityType: "AiProviderHealth",
    entityId: provider ?? "batch",
    description: `Operator ran batch ${capability} test for ${provider ?? "the active provider chain"}`,
  });

  return NextResponse.json({
    success: true,
    capability,
    zeroPaidMode: isZeroPaidMode(),
    activeChain: automaticChainDisplay(),
    analysisVerifiedProviders: verifiedAnalysisProviders(reports),
    results,
  });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = await rateLimitPersistent(`provider-test:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const body = await req.json().catch(() => ({}));
  const requestedProvider = typeof body.provider === "string" ? body.provider : null;
  const provider = requestedProvider && isKnownProvider(requestedProvider) ? requestedProvider : null;
  const capability = normalizeCapability(typeof body.capability === "string" ? body.capability : null);

  const { reports, results } = await runTests(provider, capability);
  const summary = summarizeResults(results);

  await logAction({
    userId: actor.id,
    action: provider ? "AI_PROVIDER_FAILOVER" : "CREATE",
    entityType: "AiProviderHealth",
    entityId: provider ?? "chain",
    description: `Operator ran ${capability} test for ${provider ?? "the active provider chain"}: ${summary.ok}/${summary.tested} ok`,
  });

  return NextResponse.json({
    success: true,
    zeroPaidMode: isZeroPaidMode(),
    activeChain: automaticChainDisplay(),
    analysisVerifiedProviders: verifiedAnalysisProviders(reports),
    results,
    summary,
  });
}
