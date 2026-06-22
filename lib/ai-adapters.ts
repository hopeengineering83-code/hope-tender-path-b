import { AI_PROVIDER_REGISTRY, getProviderConfig, type AiUseCase } from "./ai-provider-policy";
import { type AiProviderName } from "./ai-provider-health";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

// ─── OpenAI Compatible Generic Caller ────────────────────────────────────────

async function callOpenAICompatible(
  provider: AiProviderName,
  prompt: string,
  systemPrompt?: string,
  maxTokens?: number,
  useCase: AiUseCase = "proposal",
  customHeaders?: Record<string, string>
): Promise<string | null> {
  const config = getProviderConfig(provider);
  if (!config.apiKey) return null;

  const meta = AI_PROVIDER_REGISTRY[provider];
  const timeoutMs = meta.timeoutMs;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    ...customHeaders,
  };

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const body: any = {
    model: config.models[useCase],
    messages,
    temperature: 0,
  };

  if (provider === "cerebras") {
    body.max_completion_tokens = maxTokens || meta.outputCaps[useCase];
  } else {
    body.max_tokens = maxTokens || meta.outputCaps[useCase];
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    if (res.status === 429 && provider === "cerebras") {
       const retryAfter = res.headers.get("retry-after");
       throw new Error(`RATE_LIMIT: Cerebras 429${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`);
    }
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`${provider} error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Specific Adapters ───────────────────────────────────────────────────────

export async function generateWithZai(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("zai", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithCerebras(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("cerebras", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithMistral(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("mistral", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithGroq(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("groq", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithOpenRouter(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  const customHeaders = {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Hope Tender Path",
  };
  return callOpenAICompatible("openrouter", prompt, systemPrompt, maxTokens, useCase, customHeaders);
}

export async function generateWithOpenAI(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("openai", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithTogether(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("together", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithDeepSeek(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  return callOpenAICompatible("deepseek", prompt, systemPrompt, maxTokens, useCase);
}

export async function generateWithGemini(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  const config = getProviderConfig("gemini");
  if (!config.apiKey) return null;

  const meta = AI_PROVIDER_REGISTRY.gemini;
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const model = genAI.getGenerativeModel({ model: config.models[useCase] });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: (systemPrompt ? systemPrompt + "\n\n" : "") + prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens || meta.outputCaps[useCase] },
  });

  return result.response.text();
}

export async function generateWithClaude(prompt: string, systemPrompt?: string, maxTokens?: number, useCase: AiUseCase = "proposal"): Promise<string | null> {
  const config = getProviderConfig("anthropic");
  if (!config.apiKey) return null;

  const meta = AI_PROVIDER_REGISTRY.anthropic;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.models[useCase],
      max_tokens: maxTokens || meta.outputCaps[useCase],
      messages: [{ role: "user", content: prompt }],
      system: systemPrompt,
    }),
    signal: AbortSignal.timeout(meta.timeoutMs),
  });

  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}
