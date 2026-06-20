import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import {
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderSuccess,
  recordProviderFailure,
  isProviderCooledDown,
  isMistralConfigured,
  getMistralApiKey,
  getMistralBaseUrl,
  getMistralProposalModel,
  isGroqConfigured,
  getGroqApiKey,
  getGroqBaseUrl,
  getGroqModel,
  isOpenRouterConfigured,
  getOpenRouterApiKey,
  getOpenRouterBaseUrl,
  getOpenRouterModel,
  getOpenRouterSiteUrl,
  getOpenRouterAppName,
  isGeminiConfigured,
  getGeminiApiKey,
  isOpenAIConfigured,
  getOpenAIApiKey,
  isTogetherConfigured,
  getTogetherApiKey,
  getTogetherBaseUrl,
  getTogetherProposalModel,
  isDeepSeekConfigured,
  getDeepSeekApiKey,
  getDeepSeekModel,
  isAnthropicConfigured,
  getAnthropicApiKey,
  type AiProviderName
} from "@/lib/ai-provider-health";
import {
  PER_PROVIDER_TIMEOUT_MS,
  ANTHROPIC_TIMEOUT_MS,
  GEMINI_TIMEOUT_MS
} from "@/lib/timeout-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const isConfigured = {
    mistral: isMistralConfigured(),
    groq: isGroqConfigured(),
    openrouter: isOpenRouterConfigured(),
    gemini: isGeminiConfigured(),
    openai: isOpenAIConfigured(),
    together: isTogetherConfigured(),
    deepseek: isDeepSeekConfigured(),
    anthropic: isAnthropicConfigured(),
  }[provider];

  if (!isConfigured) return { provider, capability, status: "not_configured", model: "", durationMs: 0 };
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
      // OpenAI Compatible
      const config: any = {
        mistral: { key: getMistralApiKey()!, url: getMistralBaseUrl(), model: getMistralProposalModel() },
        groq: { key: getGroqApiKey()!, url: getGroqBaseUrl(), model: getGroqModel() },
        openrouter: {
          key: getOpenRouterApiKey()!,
          url: getOpenRouterBaseUrl(),
          model: getOpenRouterModel(),
          headers: { "HTTP-Referer": getOpenRouterSiteUrl(), "X-Title": getOpenRouterAppName() }
        },
        openai: { key: getOpenAIApiKey()!, url: "https://api.openai.com/v1", model: process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o-mini" },
        together: { key: getTogetherApiKey()!, url: getTogetherBaseUrl(), model: getTogetherProposalModel() },
        deepseek: { key: getDeepSeekApiKey()!, url: "https://api.deepseek.com/v1", model: getDeepSeekModel() },
      }[provider];

      model = config.model;
      const res: any = await withTimeout(
        fetch(`${config.url}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.key}`,
            ...config.headers
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
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

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

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
