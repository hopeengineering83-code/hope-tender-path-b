import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { buildProviderDiagnosticsSnapshot } from "../../../../lib/ai-provider-health";
import { CANONICAL_AI_PROVIDER_ENV_LIST } from "../../../../lib/ai-provider-env";
import { selfTestAllProviders } from "../../../../lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI provider diagnostics — the definitive "why is AI Analyze failing?" check.
 *
 * GET /api/ai-providers/diagnostics            → in-memory health snapshot only
 * GET /api/ai-providers/diagnostics?live=1     → live per-provider self-test
 *
 * The live test makes ONE tiny request per CONFIGURED provider and reports
 * ok / redacted-reason, so an operator can see e.g. "zai: 401 invalid key,
 * cerebras: not configured" instead of a blank "analysis failed". It NEVER
 * returns API key values. Requires ADMIN or PROPOSAL_MANAGER.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const live = new URL(req.url).searchParams.get("live") === "1";

  if (!live) {
    const snapshot = buildProviderDiagnosticsSnapshot();
    return NextResponse.json({ live: false, perProvider: snapshot.perProvider });
  }

  const results = await selfTestAllProviders();
  const working = results.filter((r) => r.ok);
  const configured = results.filter((r) => r.configured);
  const anyWorking = working.length > 0;

  return NextResponse.json({
    live: true,
    anyWorking,
    configuredCount: configured.length,
    workingCount: working.length,
    summary: anyWorking
      ? `${working.length} of ${configured.length} configured provider(s) responded OK — AI Analyze can run.`
      : configured.length === 0
        ? `No AI provider is configured. Set at least one provider API key (${CANONICAL_AI_PROVIDER_ENV_LIST}) in your environment and redeploy.`
        : "No configured provider responded. Every key is invalid, rate-limited, or cooling down — AI Analyze cannot run until at least one provider works.",
    perProvider: results,
  });
}
