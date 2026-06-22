import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
// import { forbiddenResponse, unauthorizedResponse } from "@/lib/ui-tokens";
import { logAction } from "@/lib/audit";
import {
  type AiProviderName,
  isProviderCooledDown,
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderSuccess,
  recordProviderFailure,
  getGeminiApiKey,
  getAnthropicApiKey,
} from "@/lib/ai-provider-health";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  isProviderConfigured,
  getProviderConfig,
  AI_PROVIDER_REGISTRY,
} from "@/lib/ai-provider-policy";
import { GEMINI_TIMEOUT_MS } from "@/lib/timeout-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_TIMEOUT_MS = 30000;
const PER_PROVIDER_TIMEOUT_MS = 30000;

export type ProviderTestResult = {
  provider: AiProviderName;
  capability: "ping" | "analysis" | "generation";
  status: "ok" | "failed" | "not_configured" | "skipped_cooldown";
  model: string;
  durationMs: number;
  structuredOutput?: any;
  errorCategory?: string;
  safeError?: string;
};

const SYNTHETIC_TENDER_TEXT = `
Alpha Bridge Construction Project
Donor: World Bank
Implementing Agency: Ministry of Infrastructure
Submission Deadline: 2025-12-01
Scope: Construction of a 500m bridge over the Nile.
Requirements:
- Must have 10 years of experience in bridge building. (Priority: Critical)
- ISO 9001 certification required. (Priority: High)
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

function redactMessage(message: string | null | undefined): string {
  return (message ?? "")
    .replace(/sk-ant-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-or-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/gsk_[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/dsk[-_][A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9-_]{15,}/g, "[REDACTED]")
    .replace(/AQ[A-Za-z0-9-_]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/authorization:\s*[A-Za-z0-9._\-+/=]+/gi, "authorization: [REDACTED]")
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

  const config = getProviderConfig(provider);
  const meta = AI_PROVIDER_REGISTRY[provider];

  if (capability === "ping") {
    prompt = "Reply with the single word: PING";
    maxTokens = 10;
    model = config.models.fast;
  } else if (capability === "analysis") {
    prompt = ANALYSIS_PROMPT;
    maxTokens = meta.outputCaps.analysis || 3000;
    model = config.models.analysis;
  } else {
    prompt = GENERATION_PROMPT;
    maxTokens = meta.outputCaps.proposal || 4000;
    model = config.models.proposal;
  }

  try {
    let resultText = "";
    if (provider === "gemini") {
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
      // OpenAI Compatible
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      };

      if (provider === "openrouter") {
        headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "";
        headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "Hope Tender Path";
      }

      const body: any = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      };

      if (provider === "cerebras") {
        body.max_completion_tokens = maxTokens;
      } else {
        body.max_tokens = maxTokens;
      }

      const res: any = await withTimeout(
        fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
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
  catch (e) { return NextResponse.json({ success: false, message: "Forbidden or Unauthorized" }, { status: 403 }); }

  const url = new URL(req.url);
  const onlyProvider = url.searchParams.get("provider") as AiProviderName | null;
  const capability = (url.searchParams.get("capability") || "ping") as "ping" | "analysis" | "generation";

  const testers = CANONICAL_AI_PROVIDER_ORDER.map(p => new ProviderTester(p, capability));
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
  catch (e) { return NextResponse.json({ success: false, message: "Forbidden or Unauthorized" }, { status: 403 }); }

  const body = await req.json().catch(() => ({}));
  const provider = typeof body.provider === "string" ? (body.provider as AiProviderName) : null;
  const capability = typeof body.capability === "string" ? (body.capability as "ping" | "analysis" | "generation") : "ping";

  if (!provider) {
    return NextResponse.json({ success: false, message: "Provider is required" }, { status: 400 });
  }

  const result = await testProvider(provider, capability);

  await logAction({
    userId: actor.id,
    action: "AI_PROVIDER_FAILOVER",
    entityType: "AiProviderHealth",
    entityId: provider,
    description: `Operator ran ${capability} test for ${provider}: ${result.status}`,
  });

  return NextResponse.json({
    success: true,
    result,
  });
}
