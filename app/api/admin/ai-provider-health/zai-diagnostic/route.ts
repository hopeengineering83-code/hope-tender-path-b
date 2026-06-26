import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { getProviderOutputCap, readProviderKey, resolveZaiConfiguration } from "@/lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANALYSIS_TIMEOUT_MS = 45_000;
const STRUCTURED_ANALYSIS_DIAGNOSTIC_PROMPT = `Analyze this tender excerpt and return ONLY JSON with keys: tenderTitle, clientName, requirements. Tender: The client requires a technical proposal, valid business registration, and submission by email.`;

export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const apiKey = readProviderKey("zai");
  const config = resolveZaiConfiguration("extraction");
  const keyFormatIssues: string[] = [];
  if (apiKey) {
    if (apiKey.length < 20) keyFormatIssues.push("Key is unusually short (<20 chars) — may be truncated");
    if (apiKey.includes(" ")) keyFormatIssues.push("Key contains spaces — may have been copy-pasted with whitespace");
    if (apiKey.startsWith("sk-")) keyFormatIssues.push("Key starts with 'sk-' — this looks like an OpenAI key, NOT a Z.ai key");
    if (apiKey.startsWith("AIza")) keyFormatIssues.push("Key starts with 'AIza' — this looks like a Google/Gemini key, NOT a Z.ai key");
    if (apiKey.startsWith("gsk_")) keyFormatIssues.push("Key starts with 'gsk_' — this looks like a Groq key, NOT a Z.ai key");
  }

  const checks: Record<string, unknown> = {
    keyPresent: Boolean(apiKey),
    configurationValid: config.valid,
    pingVerified: false,
    structuredTenderAnalysisVerified: false,
  };
  let rootCause = config.valid ? "Z.ai configuration is valid but live checks were not run." : config.safeMessage;
  let recommendation = config.valid ? "Run this diagnostic with a valid ZAI_API_KEY to verify live analysis." : "Set ZAI_BASE_URL and ZAI_*_MODEL to a supported endpoint/model pair, then redeploy.";
  const live: Record<string, unknown> = { skipped: !apiKey || !config.valid };

  if (apiKey && config.valid) {
    try {
      const ping = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "Reply with: PING" }], max_tokens: 5, temperature: 0 }),
        signal: AbortSignal.timeout(15_000),
      });
      checks.pingVerified = ping.ok;
      live.pingHttpCode = ping.status;

      const analysis = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: STRUCTURED_ANALYSIS_DIAGNOSTIC_PROMPT }],
          max_tokens: getProviderOutputCap("zai", "extraction"),
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      });
      live.structuredAnalysisHttpCode = analysis.status;
      if (analysis.ok) {
        const data = await analysis.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        JSON.parse(text);
        checks.structuredTenderAnalysisVerified = true;
        rootCause = "Z.ai ping and structured tender-analysis diagnostic both succeeded.";
        recommendation = "Z.ai is ready for AI Analyze with the configured endpoint/model.";
      } else {
        rootCause = "Z.ai ping/configuration may be valid, but structured AI Analyze failed.";
        recommendation = "Use this ADMIN-only diagnostic result to inspect HTTP code, then check key access/billing/model entitlement.";
      }
    } catch (err) {
      live.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      rootCause = "Z.ai live structured-analysis diagnostic failed.";
      recommendation = "Check endpoint/model compatibility, account access, billing, and timeout before relying on Z.ai for AI Analyze.";
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "unknown",
    rootCause,
    recommendation,
    configuration: {
      apiKeyStatus: apiKey ? "SET" : "NOT SET",
      baseUrl: config.baseUrl,
      model: config.model,
      planType: config.planType,
      useCase: config.useCase,
      valid: config.valid,
      reason: config.reason,
      safeMessage: config.safeMessage,
      envVars: { ZAI_API_KEY: apiKey ? "SET" : "NOT SET", ZAI_PROPOSAL_MODEL: process.env.ZAI_PROPOSAL_MODEL?.trim() || "NOT SET", ZAI_ANALYSIS_MODEL: process.env.ZAI_ANALYSIS_MODEL?.trim() || "NOT SET", ZAI_BASE_URL: process.env.ZAI_BASE_URL?.trim() || "NOT SET (using default)" },
      keyFormatIssues,
    },
    checks,
    live,
    structuredAnalysisDiagnostic: { timeoutMs: ANALYSIS_TIMEOUT_MS, jsonMode: true, outputTokens: getProviderOutputCap("zai", "extraction") },
  });
}
