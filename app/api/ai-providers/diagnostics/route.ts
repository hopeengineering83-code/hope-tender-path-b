import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { buildProviderDiagnosticsSnapshot } from "../../../../lib/ai-provider-health";
import {
  testAutomaticChainCapabilities,
  verifiedAnalysisProviders,
  billingBlockedProviders,
  type CapabilityName,
} from "../../../../lib/ai-provider-capability-test";
import { automaticChainDisplay, isZeroPaidMode } from "../../../../lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI provider diagnostics — the definitive "why is AI Analyze failing?" check.
 *
 * GET /api/ai-providers/diagnostics                    → in-memory snapshot only
 * GET /api/ai-providers/diagnostics?live=1             → real capability tests
 * GET /api/ai-providers/diagnostics?live=1&capability= → connectivity|analysis|generation
 *
 * The live path runs the SAME adapter, model and configuration that AI Analyze
 * and proposal generation use, so the report and the runtime cannot disagree.
 * It replaces a ping test whose passing condition was "returned any non-empty
 * text" — a bar a provider can clear while still being unable to produce the
 * structured analysis the workflow depends on.
 *
 * Results NEVER include API key values, and the tests never write to the health
 * state that governs routing (see lib/ai-provider-capability-test.ts).
 * Requires ADMIN or PROPOSAL_MANAGER.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const url = new URL(req.url);
  const live = url.searchParams.get("live") === "1";
  const zeroPaid = isZeroPaidMode();

  if (!live) {
    const snapshot = buildProviderDiagnosticsSnapshot();
    return NextResponse.json({
      live: false,
      zeroPaidMode: zeroPaid,
      activeChain: automaticChainDisplay(),
      perProvider: snapshot.perProvider,
    });
  }

  const requested = url.searchParams.get("capability");
  const capabilities: readonly CapabilityName[] =
    requested === "connectivity" || requested === "analysis" || requested === "generation"
      ? [requested]
      : (["connectivity", "analysis", "generation"] as const);

  const reports = await testAutomaticChainCapabilities({ capabilities });
  const analysisReady = verifiedAnalysisProviders(reports);
  const billingBlocked = billingBlockedProviders(reports);
  const tested = reports.filter((r) => r.eligible);
  const anyKeyPresent = reports.some((r) => r.keyPresent);

  return NextResponse.json({
    live: true,
    zeroPaidMode: zeroPaid,
    activeChain: automaticChainDisplay(),
    // The headline is ANALYSIS readiness, not "something answered". A chain
    // where every provider returns a cheerful "OK" to a ping and none can
    // produce structured output is not a working chain, and reporting it as
    // one is what let AI Analyze fail on an environment the diagnostics called
    // healthy.
    aiAnalyzeReady: analysisReady.length > 0,
    analysisVerifiedProviders: analysisReady,
    billingBlockedProviders: billingBlocked,
    testedCount: tested.length,
    summary: analysisReady.length > 0
      ? `${analysisReady.length} of ${tested.length} tested provider(s) completed a real AI Analyze extraction — AI Analyze can run.`
      : tested.length === 0 && !anyKeyPresent
        ? `No provider in the active chain is configured. Set a free provider key (GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY) and redeploy.`
        : tested.length === 0
          ? "Provider keys exist, but no provider has a complete effective model configuration. See each explicit provider state below."
        : `No provider completed a real AI Analyze extraction. Connectivity alone is not sufficient — see the per-provider analysis result below.`,
    perProvider: reports,
  });
}
