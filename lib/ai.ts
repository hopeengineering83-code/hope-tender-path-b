// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");
import { recordProviderSuccess, recordProviderFailure, recordProviderAnalysisSuccess, isProviderCooledDown, getProviderRuntimeSnapshot, getProviderStateSnapshot, getDeepSeekApiKey, isDeepSeekConfigured, getDeepSeekModel, getMistralApiKey, isMistralConfigured, getMistralProposalModel, getMistralAnalysisModel, getMistralFastModel, getMistralBaseUrl, getGroqApiKey, isGroqConfigured, getGroqModel, getGroqBaseUrl, getTogetherApiKey, isTogetherConfigured, getTogetherProposalModel, getTogetherAnalysisModel, getTogetherFastModel, getTogetherBaseUrl, getOpenRouterApiKey, isOpenRouterConfigured, getOpenRouterModel, getOpenRouterBaseUrl, getOpenRouterSiteUrl, getOpenRouterAppName, getAnthropicApiKey, isAnthropicConfigured, getGeminiApiKey, isGeminiConfigured, type AiProviderName } from "./ai-provider-health";
import { protectPrompt } from "./ai-trust-boundary";
import { GEMINI_TIMEOUT_MS, DEEPSEEK_DEFAULT_TIMEOUT_MS, OPENAI_COMPAT_DEFAULT_TIMEOUT_MS, O1_O3_TIMEOUT_MS, PROPOSAL_SECTION_TIMEOUT_MS, REFINEMENT_CALL_TIMEOUT_MS } from "./timeout-config";

function getGeminiDefaultModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-pro";
}

function getGeminiFallbackModels() {
  return (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function normalizeClaudeModelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getClaudeProposalModels() {
  const _rawModels = (process.env.ANTHROPIC_PROPOSAL_MODELS || "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest")
    .split(",")
    .map(normalizeClaudeModelName)
    .filter(Boolean);
  return _rawModels.length > 0
    ? _rawModels
    : ["claude-sonnet-4-5", "claude-3-5-sonnet-latest"];
}

function getClaudeMaxOutputTokens() {
  const raw = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 64000);
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 8000 : 16000;
}

const PROPOSAL_MODELS = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"];
const REASONING_MODELS = ["o3-mini", "o1-preview", "gpt-4o"];
const CLAUDE_REASONING_MODELS = ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest"];

function getClient() {
  const key = getGeminiApiKey();
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(key);
}

function getModel(modelName?: string) {
  return getClient().getGenerativeModel({ model: modelName || getGeminiDefaultModel() });
}

export function isAIEnabled() {
  return isGeminiEnabled() || isOpenAIEnabled() || isMistralEnabled() || isTogetherEnabled() || isDeepSeekEnabled() || isGroqEnabled() || isOpenRouterEnabled() || isClaudeEnabled();
}

export function isClaudeEnabled() {
  return isAnthropicConfigured();
}

export function isGeminiEnabled() {
  return isGeminiConfigured();
}

export function isOpenAIEnabled() {
  return isOpenAIConfigured();
}

export function isDeepSeekEnabled() {
  return isDeepSeekConfigured();
}

export function isMistralEnabled() {
  return isMistralConfigured();
}

export function isTogetherEnabled() {
  return isTogetherConfigured();
}

export function isGroqEnabled() {
  return isGroqConfigured();
}

export function isOpenRouterEnabled() {
  return isOpenRouterConfigured();
}

type AIProvider = "claude" | "gemini" | "openai" | "mistral" | "deepseek" | "groq" | "together" | "openrouter" | null;
let lastProposalProvider: AIProvider = null;

export function getLastProposalProvider(): AIProvider {
  return lastProposalProvider;
}

const DEFAULT_PROPOSAL_SYSTEM_PROMPT = `You are a senior bid director and proposal author with 25 years of experience winning competitive technical and financial proposals for World Bank, UNDP, AfDB, EU, USAID, GIZ, government, and large private-sector clients across Africa, Asia, and the Middle East. You have written, reviewed, or evaluated more than 2,000 tender submissions.

Your operating principles, in priority order:

1. EVALUATOR FIRST. Before writing a single word, you map every section of the proposal back to the evaluation criteria stated by the client. Every paragraph either scores points against a stated criterion or it does not exist.

2. EVIDENCE OVER INTENT. Every claim of capability is anchored in a specific named project, contract value, expert name + license, or client reference drawn from the COMPANY EVIDENCE the user provides. Generic "we are committed to" / "extensive experience in" / "team of qualified professionals" language is forbidden — it is a signal of weak proposals and you reject it.

3. NARRATIVE THROUGHLINE. Where the tender requires narrative sections, the strongest comparable projects (and named experts who delivered them) should recur consistently across those required sections so evaluators clearly see assignment-fit. Do not invent or force any section that the tender does not require.

4. COMPLIANCE DISCIPLINE. Every mandatory requirement in the tender is explicitly addressed and traceable. Where the firm cannot meet a requirement, you say so and propose a credible mitigation; you never silently drop a requirement.

5. TENDER-SPECIFIC, NEVER GENERIC. The proposal is shaped by THIS tender's exact section structure, file naming rules, page limits, subject line, deadline, and submission instructions — not a reusable template.

6. STRICT TENDER SCOPE. You generate ONLY the outputs and sections required by THIS tender's submission plan and instructions. Never force a canonical full proposal structure. If the tender requires only EOI, generate only EOI. If it requires separate technical/financial envelopes, keep them separate. Do not add cover page, TOC, annex register, executive summary, or any extra section unless explicitly required.

7. MARKDOWN RIGOR. Tables are real Markdown tables. Headings are real Markdown headings (#, ##, ###). No "[INSERT]" placeholders, no square-bracket TODOs, no AI-trace phrases ("As an AI…", "Certainly!", "I'd be happy to…", "Please note…"), no apologies, no preamble before the Cover Letter, no commentary after the proposal.

8. HONESTY ABOUT GAPS. If the COMPANY EVIDENCE genuinely does not support a claim, you do NOT fabricate project names, contract values, license numbers, or client references. Instead, mark the relevant compliance row as NOT MET or PARTIALLY MET with a concrete mitigation, and keep narrative claims strictly evidence-backed.

9. FORBIDDEN PHRASES — automatic failure. The following phrases appear in every losing bid. Never write them. Replace with a named project, expert, contract value, or year:
   - "extensive experience in" → instead: "delivered [Project X] (ETB Y, Client Z)"
   - "committed to excellence / quality / delivery"
   - "team of qualified professionals / experts / specialists"
   - "we look forward to the opportunity"
   - "strong track record of" → instead: state the specific record
   - "comprehensive understanding" → instead: "our 2022 [Sector] assessment for [Client]"
   - "wide range of experience / services / expertise"
   - "with a wealth of experience / knowledge"
   - "highly experienced / skilled / competent"
   - "deep understanding / appreciation / knowledge"
   - "proven track record"
   - "world-class / best-in-class / industry-leading"
   - "innovative solutions / cutting-edge / state-of-the-art"
   - "client-focused / client-centric / customer-oriented"
   - "I would be happy to / I am pleased to / Certainly! / Sure! / Of course!"
   - "As an AI / language model / I cannot / I am unable"

You output the proposal/document directly. You never explain what you are about to do, never ask clarifying questions, never repeat the user's instructions back. You start from the first tender-required output/section and nothing else.`;

async function generateWithClaude(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokensOverride?: number, modelOverride?: string): Promise<string | null> {
  const key = getAnthropicApiKey();
  if (!key) return null;

  let Anthropic: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch {
    return null;
  }

  const client = new Anthropic({ apiKey: key });
  const effectiveMaxTokens = (typeof maxTokensOverride === "number" && Number.isFinite(maxTokensOverride) && maxTokensOverride > 0)
    ? Math.min(maxTokensOverride, 64000)
    : getClaudeMaxOutputTokens();

  const errors: string[] = [];
  for (const modelName of (modelOverride ? [modelOverride] : getClaudeProposalModels())) {
    try {
      const response = await client.messages.create({
        model: modelName,
        max_tokens: effectiveMaxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].text;
    } catch (err: any) {
      errors.push(`${modelName}: ${err.message}`);
    }
  }
  return null;
}

async function generateWithOpenAI(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
  modelOverride?: string,
): Promise<string | null> {
  const key = getOpenAIApiKey();
  if (!key) return null;

  const model = modelOverride || process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateWithMistral(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
  useCase: AiUseCase = "proposal",
): Promise<string | null> {
  const key = getMistralApiKey();
  if (!key) return null;

  const res = await fetch(`${getMistralBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: useCase === "extraction" ? getMistralAnalysisModel() : getMistralProposalModel(),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateWithGroq(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokens = 16000): Promise<string | null> {
  const key = getGroqApiKey();
  if (!key) return null;

  const res = await fetch(`${getGroqBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getGroqModel(),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateWithTogether(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
  useCase: AiUseCase = "proposal",
): Promise<string | null> {
  const key = getTogetherApiKey();
  if (!key) return null;

  const res = await fetch(`${getTogetherBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: useCase === "extraction" ? getTogetherAnalysisModel() : getTogetherProposalModel(),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateWithOpenRouter(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokens = 16000): Promise<string | null> {
  const key = getOpenRouterApiKey();
  if (!key) return null;

  const res = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getOpenRouterSiteUrl(),
      "X-Title": getOpenRouterAppName(),
    },
    body: JSON.stringify({
      model: getOpenRouterModel(),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateWithDeepSeek(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
  modelOverride?: string,
): Promise<string | null> {
  const key = getDeepSeekApiKey();
  if (!key) return null;

  const model = modelOverride || getDeepSeekModel();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generate(prompt: string, modelName?: string, maxTokens?: number): Promise<string> {
  const model = getModel(modelName);
  const result = await model.generateContent(prompt, { maxOutputTokens: maxTokens });
  return result.response.text();
}

export type AiUseCase = "default" | "extraction" | "proposal" | "validation" | "fast" | "reasoning";

const PROVIDER_CHAINS: Record<AiUseCase, AiProviderName[]> = {
  default:    ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
  extraction: ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
  proposal:   ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
  validation: ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
  fast:       ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
  reasoning:  ["mistral","groq","openrouter","gemini","openai","together","deepseek","anthropic"],
};

function isProviderEnabled(name: AiProviderName): boolean {
  return isProviderConfigured(name);
}

function maxOutputTokensForUseCase(useCase: AiUseCase = "default"): number {
  if (useCase === "extraction" || useCase === "fast") return 4096;
  return 16000;
}

async function callProvider(
  name: AiProviderName,
  prompt: string,
  opts?: { systemPrompt?: string; geminiModel?: string; useCase?: AiUseCase },
): Promise<string | null> {
  const maxTokens = maxOutputTokensForUseCase(opts?.useCase);
  switch (name) {
    case "anthropic": {
      const r = await generateWithClaude(prompt, opts?.systemPrompt, maxTokens).catch((err) => {
        recordProviderFailure("anthropic", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("anthropic"); } else { recordProviderSuccess("anthropic"); } return r; }
      return null;
    }
    case "gemini": {
      try {
        const r = await generate(prompt, opts?.geminiModel, maxTokens);
        if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("gemini"); } else { recordProviderSuccess("gemini"); }
        return r;
      } catch (err) {
        recordProviderFailure("gemini", err);
        return null;
      }
    }
    case "openai": {
      const r = await generateWithOpenAI(prompt, opts?.systemPrompt, maxTokens).catch((err) => {
        recordProviderFailure("openai", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("openai"); } else { recordProviderSuccess("openai"); } return r; }
      return null;
    }
    case "mistral": {
      const r = await generateWithMistral(prompt, opts?.systemPrompt, maxTokens, opts?.useCase).catch((err) => {
        recordProviderFailure("mistral", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("mistral"); } else { recordProviderSuccess("mistral"); } return r; }
      return null;
    }
    case "deepseek": {
      const r = await generateWithDeepSeek(prompt, opts?.systemPrompt, maxTokens).catch((err) => {
        recordProviderFailure("deepseek", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("deepseek"); } else { recordProviderSuccess("deepseek"); } return r; }
      return null;
    }
    case "groq": {
      const r = await generateWithGroq(prompt, opts?.systemPrompt, maxTokens).catch((err) => {
        recordProviderFailure("groq", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("groq"); } else { recordProviderSuccess("groq"); } return r; }
      return null;
    }
    case "together": {
      const r = await generateWithTogether(prompt, opts?.systemPrompt, maxTokens, opts?.useCase).catch((err) => {
        recordProviderFailure("together", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("together"); } else { recordProviderSuccess("together"); } return r; }
      return null;
    }
    case "openrouter": {
      const r = await generateWithOpenRouter(prompt, opts?.systemPrompt, maxTokens).catch((err) => {
        recordProviderFailure("openrouter", err);
        return null;
      });
      if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("openrouter"); } else { recordProviderSuccess("openrouter"); } return r; }
      return null;
    }
  }
  return null;
}

export async function generateWithFallback(
  prompt: string,
  opts?: { systemPrompt?: string; geminiModel?: string; useCase?: AiUseCase; onProviderUsed?: (provider: AiProviderName) => void },
): Promise<string> {
  const useCase = opts?.useCase ?? "default";
  const chain = PROVIDER_CHAINS[useCase];
  const trustBoundary = protectPrompt(prompt);

  for (const provider of chain) {
    const configured = isProviderEnabled(provider);
    const coolingDown = isProviderCooledDown(provider);

    if (!configured || coolingDown) continue;

    const result = await callProvider(provider, trustBoundary.protectedPrompt, { ...opts, useCase });
    if (result) {
      opts?.onProviderUsed?.(provider);
      return result;
    }
  }

  throw new Error("All AI providers exhausted");
}

export async function analyzeWithAI(tenderContent: string): Promise<any> {
  const prompt = `Analyze this tender: ${tenderContent}`;
  const result = await generateWithFallback(prompt, { useCase: "extraction" });
  return JSON.parse(result);
}
