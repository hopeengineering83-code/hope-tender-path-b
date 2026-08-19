import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "@/lib/rate-limit";
import { redactSecrets } from "@/lib/sanitize-error";
import {
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderSuccess,
  recordProviderFailure,
  isProviderCooledDown,
  isProviderConfigured,
  getGeminiApiKey,
  getOpenRouterSiteUrl,
  getOpenRouterAppName,
  getAnthropicApiKey,
  type AiProviderName
} from "@/lib/ai-provider-health";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getProviderEntry,
  getProviderModel,
  getProviderBaseUrl,
  readProviderKey,
} from "@/lib/ai-provider-registry";
import { PER_PROVIDER_TIMEOUT_MS, ANTHROPIC_TIMEOUT_MS, GEMINI_TIMEOUT_MS } from "@/lib/timeout-config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type ProviderTestResult = {
  provider: string;
  status: "ok" | "failed" | "skipped_cooldown" | "not_configured";
  capability: "ping" | "analysis" | "generation";
  model: string;
  durationMs: number;
  errorCategory?: string;
  safeError?: string;
  structuredOutput?: any;
};

export type ProviderTestSummary = {
  tested: number;
  ok: number;
  failed: number;
  skipped: number;
  notConfigured: number;
};

function summarizeResults(results: ProviderTestResult[]): ProviderTestSummary {
  return {
    tested: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped_cooldown").length,
    notConfigured: results.filter((r) => r.status === "not_configured").length,
  };
}

const SYNTHETIC_TENDER_TEXT = `
[FILE_ID:doc-1|FILE_NAME:tender.pdf]
# PROJECT: Alpha Bridge Construction
Sector: Infrastructure
Tender Type: RFP
The Alpha Bridge Project requires a qualified engineering firm to provide design and supervision services.
Submission Deadline: 2026-12-31
Requirements:
1. Valid Professional Indemnity Insurance of at least $10M.
2. At least 10 years of experience in bridge design.
Submission instructions: Submit technical and financial proposals via email to procurement@alpha.gov.
`;

const ANALYSIS_PROMPT = `
Analyze the following synthetic tender text and return a JSON object with:
- tenderType (e.g. RFP, EOI)
- oneRequirement (an object with title, description, requirementType, priority, sourcePage, sourceQuote)
- submissionInstruction (string)

Synthetic Tender Text:
${SYNTHETIC_TENDER_TEXT}

Respond ONLY with valid JSON.
`;

const GENERATION_PROMPT = "Write a 2-paragraph professional introduction for a proposal responding to the Alpha Bridge Construction project. Mention our 25 years of experience.";

class ProviderTester {
  provider: AiProviderName;
  capability: "ping" | "analysis" | "generation";

  constructor(provider: AiProviderName, capability: "ping" | "analysis" | "generation" = "ping") {
    this.provider = provider;
    this.capability = capability;
  }

  async run(): Promise<ProviderTestResult> {
    return testProvider(this.provider, this.capability);
  }
}

// SECURITY (audit H-9): use the unified redactor from lib/sanitize-error.ts.
// The previous inline redactMessage() was one of 5 divergent implementations
// and missed several provider key prefixes (csk_, vcp_, etc.).
function redactMessage(message: string | null | undefined): string {
  return redactSecrets(message ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}

async function testProvider(
  provider: AiProviderName,
  capability: "ping" | "analysis" | "generation"
): Promise<ProviderTestResult> {
  if (!isProviderConfigured(provider)) return { provider, capability, status: "not_configured", model: "", durationMs: 0 };
  if (isProviderCooledDown(provider)) return { provider, capability, status: "skipped_cooldown", model: "", durationMs: 0 };

  const start = Date.now();
  let model = "";
  let prompt = "";
  let maxTokens = 10;

  if (capability === "ping") {
    prompt = "Reply with the single word: PING";
    maxTokens = 10;
  } else if (capability === "analysis") {
    prompt = ANALYSIS_PROMPT;
    maxTokens = 1000;
  } else {
    prompt = GENERATION_PROMPT;
    maxTokens = 2000;
  }

  try {
    let resultText = "";
    if (provider === "gemini") {
      model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const client = new GoogleGenerativeAI(getGeminiApiKey()!);
      const m = client.getGenerativeModel({ model });
      const res: any = await withTimeout(
        m.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens }
        }),
        GEMINI_TIMEOUT_MS
      );
      resultText = res.response.text();
    } else if (provider === "anthropic") {
      model = process.env.ANTHROPIC_PROPOSAL_MODELS?.split(",")[0]?.trim() || "claude-3-5-haiku-latest";
      const res: any = await withTimeout(
        fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": getAnthropicApiKey()!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }],
          }),
        }),
        ANTHROPIC_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      resultText = data.content[0].text;
    } else {
      // OpenAI-compatible providers (zai, cerebras, mistral, groq, openrouter,
      // openai, together, deepseek) — all config derived from the registry.
      const entry = getProviderEntry(provider);
      const key = readProviderKey(provider);
      const url = getProviderBaseUrl(provider);
      model = getProviderModel(provider, capability === "analysis" ? "extraction" : "proposal");
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = getOpenRouterSiteUrl();
        headers["X-Title"] = getOpenRouterAppName();
      }
      // Cerebras requires max_completion_tokens instead of max_tokens.
      const tokenParam = entry.requestFormat === "cerebras" ? "max_completion_tokens" : "max_tokens";
      const res: any = await withTimeout(
        fetch(`${url}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            [tokenParam]: maxTokens,
            temperature: 0,
          }),
        }),
        PER_PROVIDER_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      resultText = data.choices[0].message.content;
    }

    let structuredOutput: any = null;
    if (capability === "analysis") {
      try {
        const jsonMatch = resultText.match(/\{.*\}/s);
        if (jsonMatch) {
          structuredOutput = JSON.parse(jsonMatch[0]);
          // Verify required fields
          const required = ["tenderType", "oneRequirement", "submissionInstruction"];
          const hasAll = required.every(f => structuredOutput[f] !== undefined);
          if (!hasAll) throw new Error("Structured output missing required fields");

          const reqFields = ["title", "description", "requirementType", "priority", "sourcePage", "sourceQuote"];
          const hasReqAll = reqFields.every(f => structuredOutput.oneRequirement[f] !== undefined);
          if (!hasReqAll) throw new Error("oneRequirement missing required fields");

          structuredOutput.providerUsed = provider;
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (e) {
        throw new Error(`Analysis failed validation: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (capability === "ping") recordProviderPingSuccess(provider);
    else if (capability === "analysis") recordProviderAnalysisSuccess(provider);
    else recordProviderSuccess(provider);

    return {
      provider,
      capability,
      status: "ok",
      model,
      durationMs: Date.now() - start,
      structuredOutput
    };
  } catch (err) {
    const category = recordProviderFailure(provider, err);
    return {
      provider,
      capability,
      status: "failed",
      model,
      durationMs: Date.now() - start,
      errorCategory: category,
      safeError: redactMessage(err instanceof Error ? err.message : String(err))
    };
  }
}

export async function GET(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  // Rate limit — this route makes one outbound API call per configured provider
  // per request. A compromised admin session could run up large bills.
  const rl = await rateLimitPersistent(`provider-test:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const url = new URL(req.url);
  const onlyProvider = url.searchParams.get("provider") as AiProviderName | null;
  const capability = (url.searchParams.get("capability") || "ping") as "ping" | "analysis" | "generation";

  const PROVIDERS: readonly AiProviderName[] = CANONICAL_AI_PROVIDER_ORDER;
  const testers = PROVIDERS.map(p => new ProviderTester(p, capability));
  const results: ProviderTestResult[] = [];

  for (const tester of testers) {
    if (onlyProvider && tester.provider !== onlyProvider) continue;
    results.push(await tester.run());
  }

  await logAction({
    userId: actor.id,
    action: "CREATE",
    entityType: "AiProviderHealth",
    entityId: "batch",
    description: `Operator ran batch ${capability} test for ${onlyProvider || "all"} providers`,
  });

  return NextResponse.json({
    success: true,
    capability,
    results,
  });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  // SECURITY (audit H-10): persistent rate limit on POST. Each request makes
  // one outbound API call per configured provider; without a limit a
  // compromised admin session could burn the full provider chain repeatedly.
  // The GET route already had this limit; POST was missing it.
  const rl = await rateLimitPersistent(`provider-test:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const body = await req.json().catch(() => ({}));
  const provider = typeof body.provider === "string" ? (body.provider as AiProviderName) : null;
  const capability = typeof body.capability === "string" ? (body.capability as "ping" | "analysis" | "generation") : "ping";

  // "Test provider chain": with no specific provider, ping the full canonical
  // chain (the AIHealthTestButton action). With a provider, test just that one.
  // Both shapes return { results, summary } so the operator UI renders the grid
  // and the per-instance "recorded a successful response" state is updated.
  const providers: readonly AiProviderName[] = provider ? [provider] : CANONICAL_AI_PROVIDER_ORDER;
  const results: ProviderTestResult[] = [];
  for (const p of providers) {
    results.push(await testProvider(p, capability));
  }
  const summary = summarizeResults(results);

  await logAction({
    userId: actor.id,
    action: provider ? "AI_PROVIDER_FAILOVER" : "CREATE",
    entityType: "AiProviderHealth",
    entityId: provider ?? "chain",
    description: `Operator ran ${capability} test for ${provider ?? "full chain"}: ${summary.ok}/${summary.tested} ok`,
  });

  return NextResponse.json({
    success: true,
    results,
    summary,
  });
}
