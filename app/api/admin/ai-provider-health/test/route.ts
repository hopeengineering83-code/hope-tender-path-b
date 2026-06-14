// POST /api/admin/ai-provider-health/test
// Runs a minimal PING prompt against each configured, non-cooling provider.
// Returns per-provider status without exposing API keys or raw responses.
// Auth: ADMIN only.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import {
  recordProviderSuccess,
  recordProviderFailure,
  isProviderCooledDown,
  isDeepSeekConfigured,
  getDeepSeekApiKey,
  getDeepSeekModel,
  isMistralConfigured,
  getMistralApiKey,
  getMistralProposalModel,
  getMistralBaseUrl,
  isGroqConfigured,
  getGroqApiKey,
  getGroqModel,
  getGroqBaseUrl,
  isTogetherConfigured,
  getTogetherApiKey,
  getTogetherProposalModel,
  getTogetherBaseUrl,
  isOpenRouterConfigured,
  getOpenRouterApiKey,
  getOpenRouterModel,
  getOpenRouterBaseUrl,
  getOpenRouterSiteUrl,
  getOpenRouterAppName,
  classifyAiError,
} from "../../../../../lib/ai-provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type ProviderTestResult = {
  provider: string;
  status: "ok" | "failed" | "skipped_cooldown" | "not_configured";
  model: string;
  durationMs: number;
  errorCategory?: string;
  safeError?: string;
};

const TEST_PROMPT = "Reply with the single word: PING";
const PER_PROVIDER_TIMEOUT_MS = 3_000;

function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return raw
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .trim()
    .slice(0, 200);
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

// ── Gemini ────────────────────────────────────────────────────────────────────
async function testGemini(): Promise<ProviderTestResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { provider: "gemini", status: "not_configured", model: "", durationMs: 0 };
  if (isProviderCooledDown("gemini")) return { provider: "gemini", status: "skipped_cooldown", model: "", durationMs: 0 };
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const start = Date.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");
    const client = new GoogleGenerativeAI(key);
    const m = client.getGenerativeModel({ model });
    await withTimeout(
      m.generateContent({ contents: [{ role: "user", parts: [{ text: TEST_PROMPT }] }], generationConfig: { maxOutputTokens: 10 } }),
      PER_PROVIDER_TIMEOUT_MS,
    );
    recordProviderSuccess("gemini");
    return { provider: "gemini", status: "ok", model, durationMs: Date.now() - start };
  } catch (err) {
    const category = recordProviderFailure("gemini", err);
    return { provider: "gemini", status: "failed", model, durationMs: Date.now() - start, errorCategory: category, safeError: safeError(err) };
  }
}

// ── OpenAI-compatible helper ──────────────────────────────────────────────────
async function testOpenAICompat(
  providerKey: "openai" | "mistral" | "deepseek" | "groq" | "together" | "openrouter",
  apiKey: string,
  baseUrl: string,
  model: string,
  extraHeaders: Record<string, string> = {},
): Promise<ProviderTestResult> {
  if (isProviderCooledDown(providerKey)) return { provider: providerKey, status: "skipped_cooldown", model, durationMs: 0 };
  const start = Date.now();
  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: TEST_PROMPT }],
          max_tokens: 10,
          temperature: 0,
        }),
      }),
      PER_PROVIDER_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    recordProviderSuccess(providerKey);
    return { provider: providerKey, status: "ok", model, durationMs: Date.now() - start };
  } catch (err) {
    const category = recordProviderFailure(providerKey, err);
    return { provider: providerKey, status: "failed", model, durationMs: Date.now() - start, errorCategory: category, safeError: safeError(err) };
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function testOpenAI(): Promise<ProviderTestResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { provider: "openai", status: "not_configured", model: "", durationMs: 0 };
  return testOpenAICompat("openai", key, "https://api.openai.com/v1", process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o-mini");
}

// ── Mistral ───────────────────────────────────────────────────────────────────
async function testMistral(): Promise<ProviderTestResult> {
  if (!isMistralConfigured()) return { provider: "mistral", status: "not_configured", model: "", durationMs: 0 };
  const key = getMistralApiKey()!;
  return testOpenAICompat("mistral", key, getMistralBaseUrl(), getMistralProposalModel());
}

// ── DeepSeek ──────────────────────────────────────────────────────────────────
async function testDeepSeek(): Promise<ProviderTestResult> {
  if (!isDeepSeekConfigured()) return { provider: "deepseek", status: "not_configured", model: "", durationMs: 0 };
  const key = getDeepSeekApiKey()!;
  return testOpenAICompat("deepseek", key, "https://api.deepseek.com/v1", getDeepSeekModel());
}

// ── Groq ──────────────────────────────────────────────────────────────────────
async function testGroq(): Promise<ProviderTestResult> {
  if (!isGroqConfigured()) return { provider: "groq", status: "not_configured", model: "", durationMs: 0 };
  const key = getGroqApiKey()!;
  return testOpenAICompat("groq", key, getGroqBaseUrl(), getGroqModel());
}

// ── Together ─────────────────────────────────────────────────────────────────
async function testTogether(): Promise<ProviderTestResult> {
  if (!isTogetherConfigured()) return { provider: "together", status: "not_configured", model: "", durationMs: 0 };
  const key = getTogetherApiKey()!;
  return testOpenAICompat("together", key, getTogetherBaseUrl(), getTogetherProposalModel());
}

// ── OpenRouter ────────────────────────────────────────────────────────────────
async function testOpenRouter(): Promise<ProviderTestResult> {
  if (!isOpenRouterConfigured()) return { provider: "openrouter", status: "not_configured", model: "", durationMs: 0 };
  const key = getOpenRouterApiKey()!;
  return testOpenAICompat("openrouter", key, getOpenRouterBaseUrl(), getOpenRouterModel(), {
    "HTTP-Referer": getOpenRouterSiteUrl(),
    "X-Title": getOpenRouterAppName(),
  });
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────
async function testAnthropic(): Promise<ProviderTestResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { provider: "claude", status: "not_configured", model: "", durationMs: 0 };
  if (isProviderCooledDown("anthropic")) return { provider: "claude", status: "skipped_cooldown", model: "", durationMs: 0 };
  const model = process.env.ANTHROPIC_PROPOSAL_MODELS?.split(",")[0]?.trim() || "claude-3-5-haiku-latest";
  const start = Date.now();
  try {
    const res = await withTimeout(
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: TEST_PROMPT }],
        }),
      }),
      PER_PROVIDER_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    recordProviderSuccess("anthropic");
    return { provider: "claude", status: "ok", model, durationMs: Date.now() - start };
  } catch (err) {
    const category = recordProviderFailure("anthropic", err);
    return { provider: "claude", status: "failed", model, durationMs: Date.now() - start, errorCategory: category, safeError: safeError(err) };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const body = await req.json().catch(() => ({}));
  const onlyProvider = typeof body.provider === "string" ? body.provider : null;

  // Run tests sequentially to avoid simultaneous provider storms.
  // Order mirrors the fallback chain; Claude is last.
  // Order mirrors the canonical fallback chain: mistral → groq → openrouter → gemini → openai → together → deepseek → claude
  const testers: Array<{ provider: string; run: () => Promise<ProviderTestResult> }> = [
    { provider: "mistral", run: testMistral },
    { provider: "groq", run: testGroq },
    { provider: "openrouter", run: testOpenRouter },
    { provider: "gemini", run: testGemini },
    { provider: "openai", run: testOpenAI },
    { provider: "together", run: testTogether },
    { provider: "deepseek", run: testDeepSeek },
    { provider: "claude", run: testAnthropic },
  ];

  const results: ProviderTestResult[] = [];
  for (const tester of testers) {
    if (onlyProvider && tester.provider !== onlyProvider) continue;
    results.push(await tester.run());
  }

  const testedCount = results.filter((r) => r.status === "ok" || r.status === "failed").length;
  const okCount = results.filter((r) => r.status === "ok").length;

  await logAction({
    userId: actor.id,
    action: "AI_PROVIDER_FAILOVER",
    entityType: "AiProviderHealth",
    entityId: onlyProvider ?? "*",
    description: `Operator ran provider ping test: ${okCount}/${testedCount} tested providers responded OK.`,
  });

  return NextResponse.json({
    success: true,
    results,
    summary: { tested: testedCount, ok: okCount, failed: results.filter((r) => r.status === "failed").length, skipped: results.filter((r) => r.status === "skipped_cooldown").length, notConfigured: results.filter((r) => r.status === "not_configured").length },
  });
}
