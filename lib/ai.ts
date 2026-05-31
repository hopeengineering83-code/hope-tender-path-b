// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");
import { recordProviderSuccess, recordProviderFailure, isProviderCooledDown, getDeepSeekApiKey, isDeepSeekConfigured, getDeepSeekModel, getGroqApiKey, isGroqConfigured, getGroqModel, getGroqBaseUrl, getOpenRouterApiKey, isOpenRouterConfigured, getOpenRouterModel, getOpenRouterBaseUrl, getOpenRouterSiteUrl, getOpenRouterAppName } from "./ai-provider-health";

const apiKey = process.env.GEMINI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const FALLBACK_GEMINI_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Model chain for proposal generation — tried in order until one succeeds.
const PROPOSAL_MODELS = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"];

// Claude models in preference order. Claude is preferred over Gemini for
// proposal generation when ANTHROPIC_API_KEY is configured, because the
// benchmark used for the quality target is Claude-generated.
//
// The default chain prefers stable, widely-available aliases so it works
// on a fresh Anthropic account without configuration. To pin specific
// snapshot models, override via ANTHROPIC_PROPOSAL_MODELS — comma-separated.
//
// Model-name normalization: Anthropic model IDs are case-sensitive AND
// require dashes, not dots ("claude-sonnet-4-5", NOT "Claude-sonnet-4.5").
// Real-world deploy logs caught users entering "Claude-sonnet-4.5" in the
// env var and getting 404 errors on every model in the chain. We
// normalize each entry: lowercase, replace any dot with a dash, and
// collapse runs of dashes. This means typo-tolerant configuration —
// "Claude-Sonnet-4.5", "claude.sonnet.4.5", "claude_sonnet_4_5" all
// resolve to the canonical "claude-sonnet-4-5".
function normalizeClaudeModelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const _rawModels = (process.env.ANTHROPIC_PROPOSAL_MODELS || "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest")
  .split(",")
  .map(normalizeClaudeModelName)
  .filter(Boolean);
const CLAUDE_PROPOSAL_MODELS = _rawModels.length > 0
  ? _rawModels
  : ["claude-sonnet-4-5", "claude-3-5-sonnet-latest"];

// Maximum output tokens per Claude call. Two distinct constraints apply:
//   - Anthropic Free Tier caps output at 4K tokens/minute per model.
//     Tier 2 = 16K output/min; Tier 3+ = 80K output/min.
//   - Vercel serverless function timeout caps wall-clock time.
//     Hobby = 60s, Pro = 300s. Claude response time scales roughly
//     linearly with output token count — 8K ≈ 25–40s, 16K ≈ 60–120s.
//
// Tier-aware defaults (override any time via ANTHROPIC_MAX_OUTPUT_TOKENS):
//   Tier 1  (Vercel Hobby):   8 000 — stays within 60s function limit
//   Tier 2+ (Vercel Pro):    16 000 — full proposal in one pass, ~60–120s,
//                                      well within 300s Pro limit
//   Tier 3+ (Enterprise):    16 000 — same cap; raise via env for longer docs
const CLAUDE_MAX_OUTPUT_TOKENS = (() => {
  const raw = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 64000);
  // Tier-aware default: Tier 1 → 8K (Hobby-safe); Tier 2+ → 16K (Pro).
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 8000 : 16000;
})();

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName = DEFAULT_GEMINI_MODEL) {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey || anthropicApiKey || process.env.OPENAI_API_KEY || isDeepSeekConfigured() || isGroqConfigured() || isOpenRouterConfigured());
}

export function isClaudeEnabled() {
  return Boolean(anthropicApiKey);
}

// Last AI provider that successfully produced a proposal output. Set inside
// generateBenchmarkProposalWithAI / refineProposalWithAI; read by callers
// (e.g., generate-elite.ts) so the GeneratedDocument.contentSummary can
// surface which provider was actually used (rather than a generic "AI"
// label). Reset to null whenever a generation request fails entirely.
type AIProvider = "claude" | "gemini" | "openai" | "deepseek" | "groq" | "openrouter" | null;
let lastProposalProvider: AIProvider = null;

export function getLastProposalProvider(): AIProvider {
  return lastProposalProvider;
}

// ─── Claude (Anthropic) provider ──────────────────────────────────────────────
// Lazy-loaded so the @anthropic-ai/sdk package is only required when the user
// has set ANTHROPIC_API_KEY. Falls back gracefully (returns null) when the
// SDK is not installed or the key is not configured.
//
// Claude is the preferred provider for proposal generation when configured —
// the reference benchmark used to design the prompt and table structure is
// itself Claude-generated, so Claude output is what the prompt is tuned for.
// Default system prompt used for proposal generation. A strong system prompt
// frames Claude as a senior bid director and locks in evaluator-first thinking,
// evidence-discipline, and structural completeness BEFORE the user prompt is
// processed. Anthropic explicitly recommends moving role/persona/output rules
// into the system prompt rather than the user message — Claude obeys system
// content more reliably and it does not get lost when user input is long.
//
// Callers may override per-call (e.g., extraction prompts pass a narrower
// system prompt; refinement passes use a focused one).
const DEFAULT_PROPOSAL_SYSTEM_PROMPT = `You are a senior bid director and proposal author with 25 years of experience winning competitive technical and financial proposals for World Bank, UNDP, AfDB, EU, USAID, GIZ, government, and large private-sector clients across Africa, Asia, and the Middle East. You have written, reviewed, or evaluated more than 2,000 tender submissions.

Your operating principles, in priority order:

1. EVALUATOR FIRST. Before writing a single word, you map every section of the proposal back to the evaluation criteria stated by the client. Every paragraph either scores points against a stated criterion or it does not exist.

2. EVIDENCE OVER INTENT. Every claim of capability is anchored in a specific named project, contract value, expert name + license, or client reference drawn from the COMPANY EVIDENCE the user provides. Generic "we are committed to" / "extensive experience in" / "team of qualified professionals" language is forbidden — it is a signal of weak proposals and you reject it.

3. NARRATIVE THROUGHLINE. The two strongest comparable projects (and the named experts who delivered them) appear by name in the Cover Letter, the Executive Summary, AND the Relevant Experience section. The reader must finish page 2 thinking "this firm has already done this exact assignment."

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

// System prompt for the refinement pass. Differs from the proposal-generation
// system prompt because the input is an already-complete proposal: the AI
// must PRESERVE existing structure and facts, not rewrite from scratch.
//
// Frames Claude as a senior bid reviewer — the persona that, in real bid
// teams, takes a near-complete draft and shores up its weakest sections
// without disturbing what already works. This persona is materially
// different from the bid-writer persona used at generation time.
const REFINEMENT_SYSTEM_PROMPT = `You are a senior bid reviewer with 25 years of experience. A proposal has been written by a competent author and a deterministic quality scorer has flagged specific weak axes. Your job is to STRENGTHEN those axes without disturbing anything that already works.

Operating principles, in priority order:

1. PRESERVE EVERYTHING THAT IS ALREADY GOOD. Do NOT delete sections, do NOT remove tables, do NOT change factual claims (project names, contract values, license numbers, dates, client names, expert names). The author got those facts from the evidence library and they are correct.

2. REWRITE ONLY THE WEAK AXES. The user message will list specific axes (e.g., complianceMatrixCoverage, evidenceDensity, sectorVocabulary). Address each named axis. Do not refactor the whole document.

3. ADDITIVE WHERE POSSIBLE. If an axis is weak because a section is missing, ADD the section in its correct position relative to the rest of the proposal. Do not delete adjacent sections to make room.

4. RETURN THE COMPLETE DOCUMENT. The output is the full refined proposal markdown — not a diff, not a list of changes, not commentary. The output must be a drop-in replacement for the input.

5. NO COMMENTARY OUTSIDE THE MARKDOWN. Do not write "Here is the refined proposal:" or "I've made the following changes:". Start the output with the existing first line of the document and end with the existing last line, with the refinements integrated in place.

6. EVIDENCE STAYS GROUNDED. If a paragraph needs an evidence anchor and the document does not contain a suitable one, remove the unsupported claim or rewrite it using only verified evidence already present. Do NOT fabricate facts to fill gaps.

7. NO-FINANCIAL RULE. If the tender is TECHNICAL ONLY (no financial proposal): the output must NEVER mention cost, pricing, savings, budget, rates, or commercials — not even "cost-effective", "budget-friendly", "value-engineered", or "affordable". Scan the full document and remove any such language before returning. If the tender does include a financial envelope, this rule does not apply.

You are not the original author. You are a senior pair of eyes adding the discipline that makes the proposal evaluator-ready.`;

async function generateWithClaude(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokensOverride?: number): Promise<string | null> {
  if (!anthropicApiKey) return null;

  let Anthropic: { new (config: { apiKey: string }): unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch {
    console.warn("[ai] ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed — falling back to Gemini.");
    return null;
  }

  const client = new (Anthropic as new (config: { apiKey: string }) => {
    messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
  })({ apiKey: anthropicApiKey });

  // Per-call max_tokens. When the section-parallel generator passes a tight
  // per-section budget (e.g., 1800 for cover+exec, 2800 for technical
  // approach), Claude returns faster — generation time scales roughly with
  // output token count. The single-call path leaves the override unset and
  // continues to use CLAUDE_MAX_OUTPUT_TOKENS so behaviour is unchanged.
  const effectiveMaxTokens = (typeof maxTokensOverride === "number" && Number.isFinite(maxTokensOverride) && maxTokensOverride > 0)
    ? Math.min(maxTokensOverride, 64000)
    : CLAUDE_MAX_OUTPUT_TOKENS;

  const errors: string[] = [];
  for (const modelName of CLAUDE_PROPOSAL_MODELS) {
    // Per-model rate-limit retry: Free Tier accounts hit 429 frequently. Try
    // each model up to 3 times with exponential backoff (2s, 4s, 8s) before
    // moving on to the next model in the chain.
    let attemptError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.messages.create({
          model: modelName,
          max_tokens: effectiveMaxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });
        const text = response.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n")
          .trim();
        const stopReason = (response as { stop_reason?: string }).stop_reason;
        if (stopReason === "max_tokens") {
          console.warn(`[ai:claude] Output truncated at max_tokens (${effectiveMaxTokens}). Consider increasing token budget for this call.`);
        }
        if (text.length === 0) {
          attemptError = `${modelName}: empty response`;
          break; // empty response is not retryable
        }
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptError = `${modelName}: ${msg}`;
        // 401 / 403 — credentials are wrong, no point retrying or trying other models.
        // In strict mode (AI_PROVIDER_STRICT_AUTH=true), hard-fail immediately.
        // In default resilient mode, log and fall through to the next provider.
        if (/401|403|invalid api key|authentication/i.test(msg)) {
          const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
          if (strictAuth) {
            throw new Error(`Anthropic API key invalid — check ANTHROPIC_API_KEY in environment variables. (${msg})`);
          }
          console.warn(`[ai] Claude auth error on ${modelName} — continuing to next provider (set AI_PROVIDER_STRICT_AUTH=true to hard-fail): ${msg.slice(0, 100)}`);
          return null;
        }
        // 429 — rate limit. Retry this model with backoff before falling
        // through to the next model. Free Tier hits this often.
        if (/429|rate.?limit|over.?capacity|tokens per minute/i.test(msg)) {
          if (attempt < 2) {
            const delayMs = 2000 * Math.pow(2, attempt); // 2s, 4s
            console.warn(`[ai] Claude rate-limit on ${modelName} (attempt ${attempt + 1}/3) — backing off ${delayMs}ms.`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          // 3rd attempt also rate-limited — move to next model
          break;
        }
        // 404 / model not found / invalid request — don't retry, move on
        if (/404|not.?found|model_not_found|invalid_request/i.test(msg)) break;
        // Other errors — log and move on
        console.warn(`[ai] Claude generation failed (${modelName}): ${msg} — moving to next model.`);
        break;
      }
    }
    if (attemptError) errors.push(attemptError);
  }

  if (errors.length > 0) {
    console.warn(`[ai] All Claude models exhausted. Errors: ${errors.join(" | ")} — falling back to Gemini.`);
    // When every model failed due to rate-limiting, throw a rate-limit error so
    // generateWithFallback's catch handler records RATE_LIMIT (60s cooldown)
    // instead of treating a null return as "empty response" (UNKNOWN, 30s).
    // This prevents subsequent chunks in the same multi-chunk analysis job
    // from re-attempting Claude before the rate-limit window has cleared.
    const hadRateLimit = errors.some((e) => /429|rate.?limit|over.?capacity|tokens?\s+per\s+minute/i.test(e));
    if (hadRateLimit && errors.every((e) => /429|rate.?limit|over.?capacity|tokens?\s+per\s+minute|404|not.?found|model_not_found|empty\s+response/i.test(e))) {
      throw new Error(`Claude rate-limited (all models in chain returned 429 or were unavailable): ${errors.join(" | ")}`);
    }
  }
  return null;
}

function isModelUnavailableError(message: string): boolean {
  return /404|not found|not supported for generateContent|models\//i.test(message);
}

function isRateLimitError(message: string): boolean {
  return /429|rate.?limit|quota.?exceed|resource.?exhausted/i.test(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        console.warn(`[ai] Rate limit hit (attempt ${attempt + 1}/${maxRetries}), retrying after ${delay}ms...`);
        await sleep(delay);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

function uniqueModels(primary: string): string[] {
  return Array.from(new Set([primary, ...FALLBACK_GEMINI_MODELS]));
}

async function generate(prompt: string, modelName = DEFAULT_GEMINI_MODEL): Promise<string> {
  const errors: string[] = [];

  for (const candidate of uniqueModels(modelName || DEFAULT_GEMINI_MODEL)) {
    try {
      const text = await withRateLimitRetry(async () => {
        const model = getModel(candidate);
        const result = await model.generateContent(prompt);
        const t = result.response.text();
        if (!t || t.trim().length === 0) throw new Error(`Empty response from Gemini API using ${candidate}`);
        return t;
      });
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate}: ${msg}`);
      if (isRateLimitError(msg)) throw new Error("Gemini API rate limit reached after retries — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
        throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
      if (!isModelUnavailableError(msg)) throw err;
    }
  }

  throw new Error(`Gemini model unavailable. Tried: ${uniqueModels(modelName || DEFAULT_GEMINI_MODEL).join(", ")}. Errors: ${errors.join(" | ")}`);
}

/**
 * Try Claude first, then fall back to Gemini. Used by analyzeWithAI and
 * the extractor functions so they no longer hard-fail when only
 * ANTHROPIC_API_KEY is set. Real-world deploy logs showed
 * /api/tenders/.../ai-analyze returning "GEMINI_API_KEY not configured"
 * because analyzeWithAI was Gemini-only — even when Anthropic was set up
 * and working for /generate.
 *
 * The systemPrompt is optional. When omitted, Claude uses its default
 * behaviour (no persona override). For analysis / extraction we want
 * Claude to behave as a JSON-emitting parser — the user prompt itself
 * carries that instruction.
 *
 * Falls back to Gemini ONLY when Claude is not configured OR Claude
 * returned an empty response. When Claude throws (rate limit, bad key,
 * model 404), we re-throw so the caller can surface the actual cause.
 * For the extraction-only callers (which currently rely on `generate`
 * throwing for the user to see), this preserves the exception flow.
 */
export async function generateWithFallback(prompt: string, opts?: { systemPrompt?: string; geminiModel?: string }): Promise<string> {
  if (isClaudeEnabled()) {
    if (!isProviderCooledDown("anthropic")) {
      const claudeResult = await generateWithClaude(prompt, opts?.systemPrompt)
        .catch((err) => { recordProviderFailure("anthropic", err); return null; });
      if (claudeResult) { recordProviderSuccess("anthropic"); return claudeResult; }
      recordProviderFailure("anthropic", new Error("empty response"));
    }
    // Claude returned null or is in cooldown — try Gemini, then OpenAI before giving up.
    let geminiError: unknown = null;
    if (apiKey && !isProviderCooledDown("gemini")) {
      try {
        const r = await generate(prompt, opts?.geminiModel);
        recordProviderSuccess("gemini");
        return r;
      } catch (geminiErr) {
        geminiError = geminiErr;
        recordProviderFailure("gemini", geminiErr);
        console.warn(`[ai] generateWithFallback Gemini failed: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)} — trying OpenAI.`);
      }
    }
    // No Gemini or Gemini threw — try OpenAI as final tier
    if (!isProviderCooledDown("openai")) {
      const openAiResult = await generateWithOpenAI(prompt, opts?.systemPrompt).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/api\s+key\s+invalid|invalid\s+api\s+key|incorrect\s+api\s+key|authentication|unauthorized/i.test(msg)) { recordProviderFailure("openai", err); throw err; }
        recordProviderFailure("openai", err);
        return null;
      });
      if (openAiResult) { recordProviderSuccess("openai"); return openAiResult; }
    }
    // DeepSeek as 4th tier
    if (!isProviderCooledDown("deepseek")) {
      const deepSeekResult1 = await generateWithDeepSeek(prompt, opts?.systemPrompt).catch((err) => {
        console.warn(`[ai] DeepSeek failed: ${err instanceof Error ? err.message : String(err)}`);
        recordProviderFailure("deepseek", err);
        return null;
      });
      if (deepSeekResult1) { recordProviderSuccess("deepseek"); return deepSeekResult1; }
    }
    // Groq (5th) → OpenRouter (6th) tail.
    const tail1 = await tryTailFallbackProviders(prompt, opts?.systemPrompt);
    if (tail1) return tail1.text;
    // Always surface Gemini error when it was the root cause — even in
    // mixed deployments where OpenAI is configured but also returned null.
    if (geminiError) {
      const geminiMsg = geminiError instanceof Error ? geminiError.message : String(geminiError);
      const openAiNote = isOpenAIEnabled()
        ? ` OpenAI (${process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o"}) also returned null — check OPENAI_API_KEY.`
        : "";
      throw new Error(`All configured AI providers exhausted. Claude returned null on all models; Gemini also failed: ${geminiMsg}.${openAiNote} DeepSeek/Groq/OpenRouter also returned null or are not configured. Try re-running the engine in a few minutes.`);
    }
    const providerNote = isOpenAIEnabled()
      ? `OpenAI (${process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o"}) also returned null (rate limit or transient error).`
      : "Neither GEMINI_API_KEY nor OPENAI_API_KEY is set.";
    throw new Error(`Claude returned empty on all models in chain (${CLAUDE_PROPOSAL_MODELS.join(", ")}). ${providerNote} If ANTHROPIC_PROPOSAL_MODELS is set, model IDs must be lowercase with dashes (e.g. "claude-sonnet-4-5").`);
  }
  let geminiError: unknown = null;
  if (apiKey && !isProviderCooledDown("gemini")) {
    try {
      const r = await generate(prompt, opts?.geminiModel);
      recordProviderSuccess("gemini");
      return r;
    } catch (geminiErr) {
      geminiError = geminiErr;
      recordProviderFailure("gemini", geminiErr);
      console.warn(`[ai] generateWithFallback Gemini failed: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)} — trying OpenAI.`);
    }
  }
  // Neither Claude nor Gemini (or both failed) — try OpenAI as final fallback
  if (isOpenAIEnabled() && !isProviderCooledDown("openai")) {
    const openAiResult = await generateWithOpenAI(prompt, opts?.systemPrompt).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/api\s+key\s+invalid|invalid\s+api\s+key|incorrect\s+api\s+key|authentication|unauthorized/i.test(msg)) { recordProviderFailure("openai", err); throw err; }
      recordProviderFailure("openai", err);
      return null;
    });
    if (openAiResult) { recordProviderSuccess("openai"); return openAiResult; }
    // DeepSeek as 4th tier
    if (!isProviderCooledDown("deepseek")) {
      const deepSeekResult2 = await generateWithDeepSeek(prompt, opts?.systemPrompt).catch((err) => {
        console.warn(`[ai] DeepSeek failed: ${err instanceof Error ? err.message : String(err)}`);
        recordProviderFailure("deepseek", err);
        return null;
      });
      if (deepSeekResult2) { recordProviderSuccess("deepseek"); return deepSeekResult2; }
    }
    // Groq (5th) → OpenRouter (6th) tail.
    const tail2 = await tryTailFallbackProviders(prompt, opts?.systemPrompt);
    if (tail2) return tail2.text;
    // If Gemini was the root cause, surface it rather than blaming OpenAI
    if (geminiError) throw geminiError;
    throw new Error(`OpenAI (${process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o"}) is configured but did not return a result. Check OPENAI_API_KEY and model access on your account.`);
  }
  // Try DeepSeek standalone when neither Claude nor Gemini is configured
  if (isDeepSeekEnabled() && !isProviderCooledDown("deepseek")) {
    const deepSeekResult3 = await generateWithDeepSeek(prompt, opts?.systemPrompt).catch((err) => {
      console.warn(`[ai] DeepSeek failed: ${err instanceof Error ? err.message : String(err)}`);
      recordProviderFailure("deepseek", err);
      return null;
    });
    if (deepSeekResult3) { recordProviderSuccess("deepseek"); return deepSeekResult3; }
  }
  // Groq → OpenRouter standalone tail (when only those keys are set).
  const tail3 = await tryTailFallbackProviders(prompt, opts?.systemPrompt);
  if (tail3) return tail3.text;
  // Gemini was configured but threw — surface the real error, not "no provider configured"
  if (geminiError) throw geminiError;
  throw new Error("No AI provider configured — set ANTHROPIC_API_KEY (preferred), GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.");
}

// ─── OpenAI (GPT-4o) provider ──────────────────────────────────────────────────
// Third-tier fallback: Claude → Gemini → GPT-4o → deterministic.
// Uses fetch() directly (no SDK dependency) so it works in any serverless runtime.
// Returns null when OPENAI_API_KEY is not configured, so callers can proceed to
// the next tier without throwing.
async function generateWithOpenAI(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
): Promise<string | null> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) return null;

  const model = process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
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

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error(`OpenAI API key invalid (${res.status}): ${body.slice(0, 200)}`);
      }
      if (res.status === 429) {
        console.warn(`[ai] OpenAI rate limit (429) on ${model} — skipping to deterministic fallback.`);
        return null;
      }
      console.warn(`[ai] OpenAI error ${res.status} on ${model}: ${body.slice(0, 240)} — skipping.`);
      return null;
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      console.warn(`[ai] OpenAI API error: ${data.error.message}`);
      return null;
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (text.length === 0) {
      console.warn(`[ai] OpenAI ${model} returned empty content.`);
      return null;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/api\s+key\s+invalid|invalid\s+api\s+key|incorrect\s+api\s+key|authentication|unauthorized/i.test(msg)) throw err; // re-throw auth errors
    console.warn(`[ai] OpenAI fetch failed: ${msg} — falling through to deterministic.`);
    return null;
  }
}

export function isOpenAIEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isDeepSeekEnabled() {
  return isDeepSeekConfigured();
}

// ─── DeepSeek provider ─────────────────────────────────────────────────────────
// Fourth-tier fallback: Claude → Gemini → OpenAI → DeepSeek.
// Uses the OpenAI-compatible REST endpoint (no SDK needed).
// Returns null when DEEPSEEK_API_KEY is not configured.
const DEEPSEEK_DEFAULT_TIMEOUT_MS = 60_000;
async function generateWithDeepSeek(
  prompt: string,
  systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT,
  maxTokens = 16000,
): Promise<string | null> {
  const deepSeekKey = getDeepSeekApiKey();
  if (!deepSeekKey) return null;

  const model = getDeepSeekModel();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deepSeekKey}`,
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const sanitized = body.replace(/["']sk-[^"'\s]{8,}[^"'\s]*["']/g, '"[REDACTED]"').slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
        if (strictAuth) {
          throw new Error(`DeepSeek API key invalid (${res.status}): ${sanitized}`);
        }
        console.warn(`[ai] DeepSeek auth error (${res.status}) — continuing to deterministic fallback: ${sanitized}`);
        return null;
      }
      if (res.status === 429) {
        console.warn(`[ai] DeepSeek rate limit (429) on ${model} — skipping to deterministic fallback.`);
        return null;
      }
      console.warn(`[ai] DeepSeek error ${res.status} on ${model}: ${sanitized} — skipping.`);
      return null;
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      const sanitized = data.error.message.replace(/sk-[^\s"']{8,}/g, "[REDACTED]").slice(0, 200);
      console.warn(`[ai] DeepSeek API error: ${sanitized}`);
      return null;
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (text.length === 0) {
      console.warn(`[ai] DeepSeek ${model} returned empty content.`);
      return null;
    }
    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("timeout")) {
      console.warn(`[ai] DeepSeek fetch timed out after ${DEEPSEEK_DEFAULT_TIMEOUT_MS}ms — falling through.`);
      return null;
    }
    const sanitized = msg.replace(/sk-[^\s"']{8,}/g, "[REDACTED]").slice(0, 200);
    if (/api\s+key\s+invalid|invalid\s+api\s+key|incorrect\s+api\s+key|authentication|unauthorized/i.test(msg)) {
      const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
      if (strictAuth) throw err;
    }
    console.warn(`[ai] DeepSeek fetch failed: ${sanitized} — falling through to deterministic.`);
    return null;
  }
}

export function isGroqEnabled() {
  return isGroqConfigured();
}

export function isOpenRouterEnabled() {
  return isOpenRouterConfigured();
}

// ─── Generic OpenAI-compatible chat-completions caller ──────────────────────
// Groq and OpenRouter both speak the OpenAI /chat/completions wire format, so
// they share one implementation. Mirrors generateWithDeepSeek's safety: hard
// timeout, key redaction in any surfaced text, null (not throw) on transient
// errors so the chain can fall through to the next provider / deterministic.
const OPENAI_COMPAT_DEFAULT_TIMEOUT_MS = 60_000;
function fallbackTemperature(): number {
  const raw = Number(process.env.AI_FALLBACK_TEMPERATURE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 2 ? raw : 0.4;
}
async function generateOpenAICompatible(params: {
  providerLabel: string;
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}): Promise<string | null> {
  const { providerLabel, endpoint, apiKey: key, model, prompt, systemPrompt, maxTokens, extraHeaders } = params;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_COMPAT_DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: fallbackTemperature(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const sanitized = body.replace(/(sk|gsk)[-_][A-Za-z0-9-_]{8,}/g, "[REDACTED]").slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
        if (strictAuth) throw new Error(`${providerLabel} API key invalid (${res.status}): ${sanitized}`);
        console.warn(`[ai] ${providerLabel} auth error (${res.status}) — continuing to next provider: ${sanitized}`);
        return null;
      }
      if (res.status === 429) {
        console.warn(`[ai] ${providerLabel} rate limit (429) on ${model} — skipping to next provider.`);
        return null;
      }
      console.warn(`[ai] ${providerLabel} error ${res.status} on ${model}: ${sanitized} — skipping.`);
      return null;
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (data.error?.message) {
      const sanitized = data.error.message.replace(/(sk|gsk)[-_][A-Za-z0-9-_]{8,}/g, "[REDACTED]").slice(0, 200);
      console.warn(`[ai] ${providerLabel} API error: ${sanitized}`);
      return null;
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (text.length === 0) {
      console.warn(`[ai] ${providerLabel} ${model} returned empty content.`);
      return null;
    }
    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("timeout")) {
      console.warn(`[ai] ${providerLabel} fetch timed out after ${OPENAI_COMPAT_DEFAULT_TIMEOUT_MS}ms — falling through.`);
      return null;
    }
    if (/api\s+key\s+invalid|invalid\s+api\s+key|incorrect\s+api\s+key|authentication|unauthorized/i.test(msg)) {
      const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
      if (strictAuth) throw err;
    }
    console.warn(`[ai] ${providerLabel} fetch failed: ${msg.slice(0, 200)} — falling through.`);
    return null;
  }
}

// Fifth-tier fallback: Groq (fast OpenAI-compatible inference). Null when GROQ_API_KEY unset.
async function generateWithGroq(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokens = 16000): Promise<string | null> {
  const key = getGroqApiKey();
  if (!key) return null;
  return generateOpenAICompatible({
    providerLabel: "Groq",
    endpoint: `${getGroqBaseUrl()}/chat/completions`,
    apiKey: key,
    model: getGroqModel(),
    prompt,
    systemPrompt,
    maxTokens,
  });
}

// Sixth-tier fallback: OpenRouter (OpenAI-compatible aggregator). Null when OPENROUTER_API_KEY unset.
async function generateWithOpenRouter(prompt: string, systemPrompt: string = DEFAULT_PROPOSAL_SYSTEM_PROMPT, maxTokens = 16000): Promise<string | null> {
  const key = getOpenRouterApiKey();
  if (!key) return null;
  return generateOpenAICompatible({
    providerLabel: "OpenRouter",
    endpoint: `${getOpenRouterBaseUrl()}/chat/completions`,
    apiKey: key,
    model: getOpenRouterModel(),
    prompt,
    systemPrompt,
    maxTokens,
    // OpenRouter recommends (optional) attribution headers.
    extraHeaders: {
      "HTTP-Referer": getOpenRouterSiteUrl(),
      "X-Title": getOpenRouterAppName(),
    },
  });
}

// Shared tail of the fallback chain: Groq → OpenRouter. Honours per-provider
// cooldown and records health so the AI Health panel and AI Analyze
// diagnostics stay accurate. Returns the text + which provider produced it.
async function tryTailFallbackProviders(prompt: string, systemPrompt?: string): Promise<{ text: string; provider: "groq" | "openrouter" } | null> {
  if (isGroqEnabled() && !isProviderCooledDown("groq")) {
    const r = await generateWithGroq(prompt, systemPrompt).catch((err) => { recordProviderFailure("groq", err); return null; });
    if (r) { recordProviderSuccess("groq"); return { text: r, provider: "groq" }; }
  }
  if (isOpenRouterEnabled() && !isProviderCooledDown("openrouter")) {
    const r = await generateWithOpenRouter(prompt, systemPrompt).catch((err) => { recordProviderFailure("openrouter", err); return null; });
    if (r) { recordProviderSuccess("openrouter"); return { text: r, provider: "openrouter" }; }
  }
  return null;
}

// Try PROPOSAL_MODELS in order until one succeeds — gives the best available model for proposal writing.
async function generateWithBestModel(prompt: string): Promise<string> {
  let lastError: unknown;
  for (const modelName of PROPOSAL_MODELS) {
    try {
      return await withRateLimitRetry(async () => {
        const model = getModel(modelName);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (!text || text.trim().length === 0) throw new Error("Empty response from Gemini API");
        return text;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg)) throw new Error("Gemini API rate limit reached after retries — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
        throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
      // Model unavailable — try the next one in the chain
      if (isModelUnavailableError(msg) || msg.includes("deprecated") || msg.includes("invalid")) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("No Gemini model available for proposal generation");
}

// ─── Tender analysis types ────────────────────────────────────────────────────

export type AIRequirement = {
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  exactFileName?: string | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

export type AIAnalysisResult = {
  summary: string;
  requirements: AIRequirement[];
  exactFileNaming: string[];
  exactFileOrder: string[];
  evaluationMethodology: string;
  submissionNotes: string;
};

// ─── AI-extracted knowledge types ────────────────────────────────────────────

export type AIExtractedExpert = {
  fullName: string;
  title: string | null;
  yearsExperience: number | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
  profile: string;
  sourceSnippet: string;
};

export type AIExtractedProject = {
  name: string;
  clientName: string | null;
  country: string | null;
  sector: string | null;
  serviceAreas: string[];
  summary: string;
  contractValue: number | null;
  currency: string | null;
  sourceSnippet: string;
};

export type AIBidWriterInput = {
  tenderTitle: string;
  clientName: string;
  tenderText: string;
  analysisSummary: string;
  evaluationMethodology: string;
  submissionNotes: string;
  requirements: string;
  companyProfile: string;
  experts: string;
  projects: string;
  compliance: string;
  differentiators: string;
  // PR #257 — structured company-vault fields used by the
  // deterministic section fallback (proposal-sections.ts
  // buildSectionFallback). When the AI returns a thin Section A or
  // the deterministic fallback runs entirely, the renderer can now
  // emit REAL company data — founding year, headcount, license
  // grade, GM name + license, TIN, VAT, etc. — from the Company
  // table instead of "Bid-Team Action: confirm" placeholders.
  //
  // Optional so existing callers (legacy generate.ts, isolated
  // tests) continue to work. When omitted, the fallback emits the
  // same Bid-Team Action notes as before for that field.
  companyVault?: {
    name?: string | null;
    legalName?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    country?: string | null;
    foundingYear?: number | null;
    headcount?: number | null;
    licenseGrade?: string | null;
    registrationNumber?: string | null;
    tin?: string | null;
    vat?: string | null;
    gmName?: string | null;
    gmTitle?: string | null;
    gmLicense?: string | null;
    profileSummary?: string | null;
    serviceLines?: string[] | null;
    sectors?: string[] | null;
    // Compliance / certification records — already-formatted strings
    // for the D.3 Professional Certifications section. Caller
    // formats from CompanyComplianceRecord rows; the renderer just
    // prints the lines.
    complianceLines?: string[] | null;
  };
  // PR W — list of client names that appear in the FIRM's project
  // history but are NOT the client of THIS tender. Fed to prompts
  // as a "DO NOT use these as the client of this tender" directive
  // so the AI doesn't substitute Pharo Ventures (etc.) into the
  // cover letter "To:" line just because the firm has prior Pharo
  // projects in the vault.
  doNotUseAsClient?: string[];
  // Per-criterion evidence map — built by buildCriterionEvidenceMap()
  // in proposal-intelligence.ts. Maps each evaluation criterion (with
  // its numeric weight) to the best-matching projects and experts from
  // the vault. Injected into the Section C prompt so the AI allocates
  // prose depth proportionally to criterion weight rather than
  // distributing content evenly across all sections.
  criterionEvidenceMap?: string;
  // Round 5 (TENDER_TOOL_USE_GENERATION): when supplied, the Claude
  // branch of generateBenchmarkProposalWithAI routes through the
  // tool-use loop (generateWithClaudeTools) instead of the
  // single-call path. Claude can call the supplied tools mid-write
  // to verify evidence ("does this expert exist?", "what's the
  // contract value of project X?") before committing claims. Falls
  // back to the single-call path automatically when tool-use
  // returns null. Setting this on AIBidWriterInput is the only
  // entry point — there is no separate tool-use generator function.
  toolUse?: {
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    executor: (toolName: string, toolInput: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  };
};

// ─── Tender analysis ─────────────────────────────────────────────────────────
//
// MULTI-CALL CHAINED ANALYSIS — supports any tender size
//
// Up to PR #241, analyzeWithAI silently truncated tender content to 80K
// chars and made ONE Claude call. For big tenders (RFPs that ship as
// 200-page PDFs with 250K+ chars of text) the second half of the document
// — usually the evaluation criteria, scoring matrix, and submission
// rules — was thrown away before analysis ever started. Result:
// downstream proposal generation never knew what the evaluator was
// scoring against.
//
// The fix: when tender content > ANALYSIS_CHUNK_SOFT_LIMIT, split into
// overlapping chunks and analyze each chunk in PARALLEL, then merge:
//
//   • summary       — pick the longest (typically chunk 0 has it)
//   • requirements  — union, dedupe by normalised title
//   • exactFileNaming / exactFileOrder — union, preserve order
//   • evaluationMethodology — concatenate (often spans multiple chunks)
//   • submissionNotes — concatenate (often spans multiple chunks)
//
// Total Claude calls per analysis: ceil(tenderLen / chunkSize), each
// running in parallel. Wall time stays bounded (≈ time of one call) but
// total context coverage scales linearly with tender size.

// Above this threshold, switch to chunked multi-call analysis. Below,
// the legacy single-call path runs (faster, cheaper). 60K leaves
// headroom under Claude's effective per-call context budget for the
// detailed system prompt + user prompt boilerplate.
const ANALYSIS_CHUNK_SOFT_LIMIT = 60_000;
// Each chunk size — kept under 80K so the prompt + chunk fits comfortably
// in one call. Overlap preserves context across boundaries (a requirement
// straddling the boundary is captured in both chunks; merge dedupes).
const ANALYSIS_CHUNK_SIZE = 50_000;
const ANALYSIS_CHUNK_OVERLAP = 5_000;
// Cap to prevent runaway cost on truly enormous PDFs. 6 × 50K = 300K
// chars covers an extremely long RFP. Anything past 300K is rare.
const ANALYSIS_MAX_CHUNKS = 6;

function chunkTenderContent(content: string): string[] {
  if (content.length <= ANALYSIS_CHUNK_SOFT_LIMIT) return [content];
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length && chunks.length < ANALYSIS_MAX_CHUNKS) {
    const end = Math.min(start + ANALYSIS_CHUNK_SIZE, content.length);
    chunks.push(content.slice(start, end));
    if (end === content.length) break;
    start = end - ANALYSIS_CHUNK_OVERLAP;
  }
  return chunks;
}

function mergeAnalysisResults(parts: AIAnalysisResult[]): AIAnalysisResult {
  if (parts.length === 0) {
    throw new Error("mergeAnalysisResults: cannot merge zero analysis parts");
  }
  if (parts.length === 1) return parts[0];

  // summary — pick the longest non-empty one. Chunk 0 usually has the
  // best high-level interpretation since it sees the tender's intro.
  const summary = parts.map((p) => p.summary ?? "").sort((a, b) => b.length - a.length)[0] ?? "";

  // requirements — dedupe by normalised title. When two chunks both
  // surface the same requirement (because of the overlap window), keep
  // the longer description.
  const reqByKey = new Map<string, AIAnalysisResult["requirements"][number]>();
  for (const part of parts) {
    for (const req of part.requirements ?? []) {
      const key = (req.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!key) continue;
      const existing = reqByKey.get(key);
      if (!existing || (req.description?.length ?? 0) > (existing.description?.length ?? 0)) {
        reqByKey.set(key, req);
      }
    }
  }
  const requirements = [...reqByKey.values()];

  // exactFileNaming / exactFileOrder — union, preserve insertion order
  // from the first chunk that mentioned each filename.
  const seenNames = new Set<string>();
  const exactFileNaming: string[] = [];
  for (const part of parts) {
    for (const name of part.exactFileNaming ?? []) {
      const k = name.toLowerCase().trim();
      if (k && !seenNames.has(k)) {
        seenNames.add(k);
        exactFileNaming.push(name);
      }
    }
  }
  const seenOrder = new Set<string>();
  const exactFileOrder: string[] = [];
  for (const part of parts) {
    for (const name of part.exactFileOrder ?? []) {
      const k = name.toLowerCase().trim();
      if (k && !seenOrder.has(k)) {
        seenOrder.add(k);
        exactFileOrder.push(name);
      }
    }
  }

  // evaluationMethodology / submissionNotes — concatenate distinct
  // chunks. Big tenders typically split scoring criteria across
  // multiple sections that each chunk picks up partially.
  const evaluationMethodology = parts
    .map((p) => (p.evaluationMethodology ?? "").trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join("\n\n");
  const submissionNotes = parts
    .map((p) => (p.submissionNotes ?? "").trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join("\n\n");

  return { summary, requirements, exactFileNaming, exactFileOrder, evaluationMethodology, submissionNotes };
}

async function analyzeOneChunk(tenderContent: string, chunkIndex: number, totalChunks: number): Promise<AIAnalysisResult> {
  const chunkLabel = totalChunks > 1 ? ` (chunk ${chunkIndex + 1} of ${totalChunks})` : "";
  const prompt = `You are a 100-person senior tender board compressed into one analysis engine: lead bid manager, procurement lawyer, technical director, evaluator, document-control lead, and proposal writer. You have evaluated thousands of tenders for World Bank, UNDP, government, and private-sector clients.${chunkLabel ? `\n\nNOTE${chunkLabel}: This is one chunk of a larger tender document. Extract everything visible IN THIS CHUNK. Do not invent content from missing chunks; downstream merge will combine chunk results.` : ""}

Analyze the tender and return ONLY a valid JSON object — no explanation, no markdown fences, no code blocks.

## ANALYSIS PROCESS (think step by step before writing JSON):
Step 1 — Identify: client name, tender title, tender reference, deadline, submission method, email recipients, exact subject line required, country/location.
Step 2 — Detect: is financial proposal excluded? Is this technical-only? Are there shortlisting stages?
Step 3 — Extract SECTIONS: what sections must the proposal contain (Company Profile, Relevant Experience, Technical Approach, Additional Information, etc.)?
Step 4 — Extract EVALUATION CRITERIA: what will evaluators score and how? IMPORTANT — capture numeric WEIGHTS (e.g., "Technical 70%, Financial 30%", "Relevant Experience 25 points", sub-criteria weights). If a weight is stated anywhere in the document (criteria table, scoring matrix, or prose), include it verbatim in evaluationMethodology and in the per-criterion weights array.
Step 5 — Extract QUALIFICATION REQUIREMENTS: required licences, team composition, healthcare experience, donor compliance standards.
Step 6 — Extract EXPERT REQUIREMENTS: how many experts, what disciplines, what minimum experience?
Step 7 — Extract PROJECT REQUIREMENTS: how many references, what sector/type, what minimum value/scale?
Step 8 — Extract FORMAT/SUBMISSION RULES: file format, naming, page limits, appendix structure.
Step 9 — Extract COMMERCIAL TERMS: bid bond / EMD amount and form (cash, bank guarantee, insurance bond), performance guarantee percentage, bid validity period (days), clarification / pre-bid question deadline, site visit / pre-bid meeting date and venue, contract duration, currency, payment terms. These are critical for risk assessment — capture them when present.
Step 10 — Extract ELIGIBILITY GATES: eligible jurisdictions (countries / regions), consortia / joint-venture rules, local-content percentage, registration requirements, debarment / sanctions exclusions.
Step 11 — Build strategic requirement bundles: consolidate related requirements into strategic groups.
Step 12 — Write evaluationMethodology: how the proposal should be structured to score maximum points against each criterion, criterion-by-criterion with weights when known.

## CRITICAL RULES:
- Do NOT convert table-of-contents entries, page numbers, clause numbers, scores, years, percentages, or page references into quantity requirements.
- Set requiredQuantity ONLY when the tender explicitly says minimum/required/at least/provide/submit a specific NUMBER of experts, CVs, projects, or references.
- Do not create hundreds of line-by-line requirements — consolidate into 10-20 strategic bundles maximum.
- A methodology/technical approach requirement is something the proposal WRITES — it is not a missing document.
- Extract email recipients, exact subject line, no-financial-proposal rules, appendix letters, and evaluation scoring weights when present.
- evaluationMethodology must be actionable: "Score criterion X by doing Y using evidence Z" — not just a list of criteria.
- submissionNotes must include: deadline, email recipients, exact subject line, file format, financial proposal restriction, appendix requirements.

JSON structure required:
{
  "summary": "4-6 sentence senior bid interpretation: client name, tender title, assignment scope, key technical challenges, main evaluation driver, top strategic risk for the responding firm",
  "requirements": [
    {
      "title": "short strategic title (max 80 chars)",
      "description": "consolidated requirement text explaining what must be in the proposal and why it matters for scoring",
      "requirementType": "TECHNICAL|FINANCIAL|ELIGIBILITY|EXPERT|PROJECT_EXPERIENCE|FORMAT|SUBMISSION_RULE|DECLARATION|ANNEX|SCHEDULE|FORM|METHODOLOGY|COMPANY_PROFILE",
      "priority": "MANDATORY|SCORED|INFORMATIONAL",
      "exactFileName": "exact filename if specified or null",
      "requiredQuantity": number_or_null,
      "pageLimit": number_or_null,
      "restrictions": "branding/signature/file/page/format restrictions or null",
      "sectionReference": "section/clause/annex reference or null"
    }
  ],
  "exactFileNaming": ["exact filenames required by the tender"],
  "exactFileOrder": ["files in the required submission order"],
  "evaluationMethodology": "Detailed scoring guidance: for each evaluation criterion, explain what evidence to present, what to emphasise, and what the evaluator is looking for. Include criterion weights verbatim if specified (e.g., 'Technical 70% / Financial 30%; Relevant Experience 25 points; Methodology 20 points').",
  "submissionNotes": "Complete submission instructions: deadline with time and timezone, email recipients (all), exact subject line (verbatim), file format requirements, financial proposal restriction (yes/no), appendix lettering, and any other document-control notes. ALSO include when stated: bid bond amount and form, performance guarantee percentage, bid validity period in days, clarification / pre-bid question deadline, site visit or pre-bid meeting date and venue, contract duration, currency, payment terms, eligibility jurisdictions, consortia / joint-venture rules, local-content requirement."
}

TENDER DOCUMENT${chunkLabel} (${tenderContent.length.toLocaleString()} chars):
${tenderContent}`;

  const text = await generateWithFallback(prompt, {
    systemPrompt: "You are a senior tender analyst. Output ONLY a valid JSON object — no markdown, no code fences, no preamble. The JSON object must match the structure described in the user prompt exactly.",
    geminiModel: process.env.GEMINI_ANALYSIS_MODEL || DEFAULT_GEMINI_MODEL,
  });
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI returned no JSON object for tender analysis${chunkLabel}`);

  function tryParseAndSanitize(raw: string): AIAnalysisResult | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      // Sanitize: ensure required fields exist with correct types
      // A missing or wrong-type field should never crash downstream consumers.
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements.filter((r: unknown) => r && typeof r === "object") : [],
        exactFileNaming: Array.isArray(parsed.exactFileNaming) ? parsed.exactFileNaming.filter((s: unknown) => typeof s === "string") : [],
        exactFileOrder: Array.isArray(parsed.exactFileOrder) ? parsed.exactFileOrder.filter((s: unknown) => typeof s === "string") : [],
        evaluationMethodology: typeof parsed.evaluationMethodology === "string" ? parsed.evaluationMethodology : "",
        submissionNotes: typeof parsed.submissionNotes === "string" ? parsed.submissionNotes : "",
      };
    } catch {
      return null;
    }
  }

  const direct = tryParseAndSanitize(jsonMatch[0]);
  if (direct) return direct;

  const allMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
  for (const m of allMatches) {
    const r = tryParseAndSanitize(m[0]);
    if (r) return r;
  }
  // Trailing-comma repair: remove commas immediately before } or ] which
  // strict JSON forbids. Only attempted after all other parse paths fail.
  const repaired = jsonMatch[0].replace(/,(\s*[}\]])/g, "$1");
  if (repaired !== jsonMatch[0]) {
    const r = tryParseAndSanitize(repaired);
    if (r) return r;
  }
  throw new Error(`AI returned malformed JSON for tender analysis${chunkLabel}`);
}

export const CHUNK_DEADLINE_MARGIN_MS = 8_000;

// Per-chunk retry-once on transient errors. The chunk loop used to log a
// failure on the first error (rate-limit, timeout, malformed JSON) and march
// on, which on rate-limited days produced an AnalysisWithMeta with most chunks
// failed → downstream consumers treated the analysis as "AI-unverified" and
// the regex-fallback gate fired. A single, bounded retry-once recovers nearly
// every transient failure without changing the deadline contract.
const CHUNK_RETRY_BACKOFF_MS = 1500;
const TRANSIENT_CHUNK_ERROR_PATTERN = /429|rate.?limit|quota|tokens?\s+per\s+minute|timed?\s*out|timeout|aborted|malformed json|no json|json object|json parse|empty\s+response/i;
export function isTransientChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return TRANSIENT_CHUNK_ERROR_PATTERN.test(msg);
}
async function analyzeOneChunkWithRetry(content: string, index: number, total: number): Promise<AIAnalysisResult> {
  try {
    return await analyzeOneChunk(content, index, total);
  } catch (err) {
    if (!isTransientChunkError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ai] chunk ${index + 1}/${total} hit transient error — retrying once after ${CHUNK_RETRY_BACKOFF_MS}ms. Error: ${msg.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, CHUNK_RETRY_BACKOFF_MS));
    return await analyzeOneChunk(content, index, total);
  }
}

export type AnalysisWithMeta = {
  result: AIAnalysisResult;
  isPartial: boolean;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  skippedChunks: number; // stopped by deadline
};

export async function analyzeWithAI(
  tenderContent: string,
  opts?: { deadlineAt?: number; startFromChunk?: number },
): Promise<AnalysisWithMeta> {
  // For tenders within the soft limit, run a single call (faster path).
  // For larger tenders, chunk into overlapping pieces and analyze sequentially.
  // Sequential processing prevents simultaneous provider-chain storms: a 6-chunk
  // tender previously launched up to 36 concurrent provider calls. Each chunk is
  // independently analyzed; results merge below.
  const chunks = chunkTenderContent(tenderContent);
  if (chunks.length === 1) {
    const result = await analyzeOneChunk(chunks[0], 0, 1);
    return { result, isPartial: false, totalChunks: 1, completedChunks: 1, failedChunks: 0, skippedChunks: 0 };
  }

  console.info(`[ai] tender content is ${tenderContent.length.toLocaleString()} chars — chunking into ${chunks.length} sequential analysis calls.`);
  const successes: AIAnalysisResult[] = [];
  const failures: string[] = [];
  let completedChunks = 0;
  let failedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    // Skip chunks before startFromChunk (resume support)
    if (opts?.startFromChunk !== undefined && i < opts.startFromChunk) {
      continue;
    }

    // Deadline check: stop before starting this chunk if not enough time remains
    if (opts?.deadlineAt !== undefined && Date.now() + CHUNK_DEADLINE_MARGIN_MS > opts.deadlineAt) {
      console.warn(`[ai] deadline approaching — stopping before chunk ${i + 1}/${chunks.length}. Completed: ${completedChunks}, Failed: ${failedChunks}`);
      break;
    }

    try {
      successes.push(await analyzeOneChunkWithRetry(chunks[i], i, chunks.length));
      completedChunks++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`chunk ${i + 1}: ${msg}`);
      failedChunks++;
      console.warn(`[ai] chunk ${i + 1}/${chunks.length} failed — continuing with remaining chunks. Error: ${msg}`);
      // Brief inter-chunk delay after a transient failure (rate-limit, timeout)
      // so cooled-down providers have more recovery time before the next chunk.
      // Skip the delay when the deadline is near (< 15s remaining) to avoid
      // burning the remaining window on a sleep.
      const isTransient = isTransientChunkError(err);
      const hasDeadlineRoom = opts?.deadlineAt === undefined || Date.now() + 15_000 < opts.deadlineAt;
      if (isTransient && hasDeadlineRoom && i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  const skippedChunks = chunks.length - (completedChunks + failedChunks);

  if (completedChunks === 0) {
    if (skippedChunks === chunks.length) {
      throw new Error(`All ${chunks.length} chunks were skipped due to deadline — no analysis completed.`);
    }
    throw new Error(`All ${chunks.length} chunked analysis calls failed. Errors: ${failures.join(" | ")}`);
  }

  if (failures.length > 0) {
    console.warn(`[ai] ${failures.length} of ${chunks.length} chunks failed — merging the ${successes.length} that succeeded. Errors: ${failures.join(" | ")}`);
  }

  const isPartial = skippedChunks > 0 || (failedChunks > 0 && completedChunks > 0);
  const result = mergeAnalysisResults(successes);
  return { result, isPartial, totalChunks: chunks.length, completedChunks, failedChunks, skippedChunks };
}

// ─── CV / Expert extraction ───────────────────────────────────────────────────

export async function extractExpertsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedExpert[]> {
  const prompt = `You are a CV parsing engine for an engineering consultancy. Parse the document "${documentName}" and extract all expert/staff profiles.

Return ONLY a valid JSON array — no explanation, no markdown. Each element:
{
  "fullName": "full name (required — omit record if unclear)",
  "title": "job title or null",
  "yearsExperience": integer_or_null,
  "disciplines": ["e.g. Structural Engineering, Urban Planning"],
  "sectors": ["e.g. Healthcare, Infrastructure, Education, Energy & Power, Water & Sanitation, Mining & Extractive, Port & Maritime, Oil & Gas, Financial Services, Telecoms & Broadband, Agriculture & Irrigation, Urban Planning, Environmental & Social, Industrial"],
  "certifications": ["professional certifications and memberships"],
  "profile": "1-3 sentence professional summary from CV content",
  "sourceSnippet": "verbatim extract ≤500 chars proving this person exists"
}

Rules: only include people clearly named in the document. Do NOT invent any field — use null if uncertain. sourceSnippet must be a direct quote that lets a human verify the extraction. Prefer quotes that include a job title, certification number, or project reference so the source is unambiguous. If two candidates share a similar name, treat them as separate records only when the source clearly distinguishes them (different title, different project, different certifications).

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 60_000)}`;

  const raw = await generateWithFallback(prompt, {
    systemPrompt: "You are a CV parsing engine. Output ONLY a valid JSON array — no markdown, no code fences, no preamble. Each element must match the schema in the user prompt exactly.",
    geminiModel: process.env.GEMINI_EXTRACTION_MODEL || "gemini-2.5-flash",
  });
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AIExtractedExpert[]).filter(
      (e) => e && typeof e === "object" && typeof e.fullName === "string" && e.fullName.trim().length > 2,
    );
  } catch {
    console.warn("[extractExpertsFromText] JSON parse failed, returning empty");
    return [];
  }
}

// ─── Project / portfolio extraction ──────────────────────────────────────────

export async function extractProjectsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedProject[]> {
  const prompt = `You are a project portfolio parser for an engineering consultancy. Parse the document "${documentName}" and extract all project records.

Return ONLY a valid JSON array — no explanation, no markdown. Each element:
{
  "name": "project name (required — omit if unclear)",
  "clientName": "client name or null",
  "country": "country or null",
  "sector": "primary sector (Healthcare/Infrastructure/Education/Energy & Power/Water & Sanitation/Mining & Extractive/Port & Maritime/Oil & Gas/Financial Services/Telecoms & Broadband/Agriculture & Irrigation/Urban Planning/Environmental & Social/Industrial/Commercial/Government) or null",
  "serviceAreas": ["services provided e.g. Structural Engineering, Urban Planning"],
  "summary": "1-2 sentence description of project and firm's role",
  "contractValue": number_or_null (plain number, no symbols),
  "currency": "USD|ETB|EUR|GBP|AED|SAR or null",
  "sourceSnippet": "verbatim extract ≤500 chars proving this project"
}

Rules: only include projects clearly in the document. Do NOT invent values. sourceSnippet must be a direct quote that includes the project name AND at least one verifiable detail (client, value, year, or location). When the same project appears in multiple sections of the document with different values or descriptions, prefer the version that includes the contract value and client name. Reject candidates that are obviously cover-page reference lists, table-of-contents entries, or generic capability statements without a specific project name.

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 60_000)}`;

  const raw = await generateWithFallback(prompt, {
    systemPrompt: "You are a project portfolio parsing engine. Output ONLY a valid JSON array — no markdown, no code fences, no preamble. Each element must match the schema in the user prompt exactly.",
    geminiModel: process.env.GEMINI_EXTRACTION_MODEL || "gemini-2.5-flash",
  });
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AIExtractedProject[]).filter(
      (p) => p && typeof p === "object" && typeof p.name === "string" && p.name.trim().length > 3,
    );
  } catch {
    console.warn("[extractProjectsFromText] JSON parse failed, returning empty");
    return [];
  }
}

// ─── Proposal generation ──────────────────────────────────────────────────────

/**
 * Targeted refinement pass: takes a generated proposal markdown, the quality
 * scorer's weak-axis list, and the original input parameters, and asks the AI
 * to rewrite the weak sections in place. Returns the refined markdown, or
 * null if no AI provider is available or refinement fails.
 *
 * This is the multi-pass quality lift: the first pass produces a complete
 * proposal; the scorer identifies weak axes; this pass targets them
 * specifically, instructing the AI to keep the existing structure and tables
 * intact and only rewrite the prose that's weak.
 */
// Maximum input size for the refinement prompt. Above this, the proposal is
// large enough that silently truncating to fit the prompt would risk dropping
// real sections from the output. We skip refinement instead — the original
// (already-comprehensive) output is kept and the score is recorded as-is.
const REFINEMENT_MAX_INPUT_CHARS = 80_000;

// PR VV — per-call refinement timeout. Without this, refineProposalWithAI
// could chew the entire Vercel Hobby 60s function budget on a single
// call (large markdown input + slow Anthropic TTFT + retry on Gemini).
// With PR QQ allowing up to 2 refinement attempts, the worst case
// pre-PR-VV was 2 × 60s = 120s = guaranteed function timeout.
//
// Default 25s (env-overridable) gives Tier 2 enough room for a single
// refinement on a 30K-char proposal while leaving budget for the rest
// of the pipeline (section calls, auto-rematch, post-passes).
const REFINEMENT_CALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.REFINEMENT_CALL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000) return raw;
  return 25_000;
})();

async function withRefinementTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`refineProposalWithAI timed out after ${Math.round(REFINEMENT_CALL_TIMEOUT_MS / 1000)}s`)),
          REFINEMENT_CALL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Tool-use multi-turn loop (gap #10) ────────────────────────────────────
// Anthropic's tool_use protocol: Claude returns blocks of type
// "tool_use", we run the tool, send a "tool_result" block back, and
// continue until the assistant returns only text (or we hit the
// per-call iteration cap). Bounded so a misbehaving model can't burn
// the whole function budget on tool calls.
//
// MAX_TOOL_TURNS is intentionally low — a critic that needs more
// than 6 lookups to write a critique is almost certainly looping. We
// log + exit early when the cap is reached.

const MAX_TOOL_TURNS = 6;

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type AnthropicToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;
type AnthropicMessage = { role: "user" | "assistant"; content: string | Array<AnthropicTextBlock | AnthropicToolResultBlock | AnthropicToolUseBlock> };

/**
 * Generate with Claude in a tool-use loop. The executor receives the
 * tool name + input from each tool_use block and returns a JSON-
 * serialisable result that becomes the tool_result content.
 *
 * Returns the FINAL assistant text — the part after the model has
 * stopped calling tools. Null when Claude is unavailable or every
 * model in the chain fails.
 *
 * Errors thrown by the executor are converted to tool_result blocks
 * with `is_error: true` so Claude can recover (it'll typically
 * apologise and proceed without that lookup).
 */
export async function generateWithClaudeTools(
  prompt: string,
  systemPrompt: string,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  executor: (toolName: string, input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
  maxTokensOverride?: number,
): Promise<string | null> {
  if (!anthropicApiKey) return null;

  let Anthropic: { new (config: { apiKey: string }): unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch {
    console.warn("[ai:tools] @anthropic-ai/sdk not installed — tool-use unavailable.");
    return null;
  }

  const client = new (Anthropic as new (config: { apiKey: string }) => {
    messages: { create: (input: unknown) => Promise<{ content: AnthropicContentBlock[]; stop_reason?: string }> };
  })({ apiKey: anthropicApiKey });

  const effectiveMaxTokens = (typeof maxTokensOverride === "number" && Number.isFinite(maxTokensOverride) && maxTokensOverride > 0)
    ? Math.min(maxTokensOverride, 64000)
    : CLAUDE_MAX_OUTPUT_TOKENS;

  // Conversation state — grows by one user-or-assistant message per
  // turn. The initial user message has just the prompt; subsequent
  // user messages carry the tool_result blocks for the prior turn's
  // tool_use blocks.
  const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];

  for (const modelName of CLAUDE_PROPOSAL_MODELS) {
    let attemptError: string | null = null;
    let aborted = false;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      let response: { content: AnthropicContentBlock[]; stop_reason?: string };
      try {
        response = await client.messages.create({
          model: modelName,
          max_tokens: effectiveMaxTokens,
          system: systemPrompt,
          tools,
          messages,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptError = `${modelName}: ${msg}`;
        if (/401|403|invalid api key|authentication/i.test(msg)) {
          const strictAuth = ["1", "true", "yes"].includes((process.env.AI_PROVIDER_STRICT_AUTH || "").trim().toLowerCase());
          if (strictAuth) {
            throw new Error(`Anthropic API key invalid — check ANTHROPIC_API_KEY. (${msg})`);
          }
          console.warn(`[ai:tools] Claude auth error on ${modelName} — falling back: ${msg.slice(0, 100)}`);
          aborted = true;
          break;
        }
        if (/429|rate.?limit|over.?capacity|tokens per minute/i.test(msg) && turn < MAX_TOOL_TURNS - 1) {
          console.warn(`[ai:tools] Claude rate-limit on ${modelName} mid-loop — aborting this model.`);
        }
        aborted = true;
        break;
      }

      const toolUseBlocks = response.content.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
      const textBlocks = response.content.filter((b): b is AnthropicTextBlock => b.type === "text");

      // Stash the assistant message — Anthropic requires the full
      // assistant turn (including tool_use blocks) to be replayed in
      // the conversation when sending tool_result.
      messages.push({ role: "assistant", content: response.content });

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        // No more tool calls — return the concatenated text.
        const finalText = textBlocks.map((b) => b.text).join("\n").trim();
        if (finalText.length === 0) {
          attemptError = `${modelName}: empty final response after ${turn} tool turn(s)`;
          aborted = true;
          break;
        }
        return finalText;
      }

      // Execute each tool_use block, build tool_result blocks.
      const toolResults: AnthropicToolResultBlock[] = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await executor(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (execErr) {
          const msg = execErr instanceof Error ? execErr.message : String(execErr);
          console.warn(`[ai:tools] tool ${block.name} threw: ${msg}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: msg }),
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!aborted) {
      // Loop exhausted without end_turn — log and try the next model with a fresh conversation.
      console.warn(`[ai:tools] ${modelName} did not finish within ${MAX_TOOL_TURNS} tool turns. Trying next model.`);
      messages.splice(1); // reset to initial user message
    }
    if (attemptError) console.warn(`[ai:tools] ${attemptError}`);
  }

  console.warn(`[ai:tools] All Claude models exhausted — tool-use returning null.`);
  return null;
}

// ─── Deep-reasoning critic + rewriter (PR #384 / TENDER_DEEP_REASONING) ─────
// These two helpers split the legacy single-pass refinement into a
// CRITIQUE step and a REWRITE step. They are consumed by
// `lib/engine/deep-reasoning-refiner.ts` and gated by the
// TENDER_DEEP_REASONING feature flag. The legacy `refineProposalWithAI`
// continues to work unchanged for callers that do not opt in.
//
// Why two passes:
//
//   The single-pass approach asks Claude to *find and fix* weak axes
//   in one shot. Real bid reviewers do these as two separate cognitive
//   acts: read-and-mark first, then rewrite. Splitting the prompt
//   improves both steps — the critique can focus entirely on what is
//   wrong (and produces a structured artifact a human can inspect),
//   and the rewriter has explicit instructions rather than having to
//   re-discover the problems mid-write.

const CRITIC_SYSTEM_PROMPT = `You are a senior bid REVIEWER (not the author) with 25 years of experience scoring competitive technical proposals for World Bank, UNDP, AfDB, EU, USAID, GIZ, government, and large private-sector clients. Your single job is to read a near-complete proposal and write a precise, evidence-anchored critique that another author will use to rewrite the weak axes.

Operating principles, in priority order:

1. NAMED DEFECTS ONLY. Every critique entry must point to a SPECIFIC defect with a SPECIFIC location ("Section C.2, paragraph 3", "Cover Letter opening", "Compliance Matrix row 7"). Vague critique like "improve evidence density throughout" is forbidden — you must name the offending paragraph or section.

2. EVIDENCE-ANCHORED. Every defect statement must cite either (a) the missing evidence (project name, contract value, license number, expert name, sector term) or (b) the forbidden language present (a quoted AI-trace phrase, a placeholder, a vague promise like "extensive experience").

3. ACTIONABLE FIX SUGGESTIONS. For every defect, propose the SPECIFIC repair: "Replace 'we have extensive water experience' with the 2022 Sebeta WASH project (ETB 18M, World Bank)" — not "add a project reference".

4. NO INVENTION. You may only reference projects, experts, license numbers, sectors, and clients that already appear in the proposal text or the supplied evidence inventory. If the evidence to fix a defect is missing entirely, say so explicitly: "EVIDENCE GAP: Section C.4 requires a JV partner reference but none is named in the firm's evidence inventory."

5. EVALUATION-CRITERIA ALIGNMENT. Where the user message provides extracted evaluation criteria with weights, anchor every critique entry to a criterion ID — "Defect blocks 25% of the Technical Approach score (criterion: technical-methodology)."

6. STRUCTURED OUTPUT. Return the critique as a numbered list of defect entries. Each entry has: (1) location, (2) defect statement, (3) cited evidence/language, (4) proposed fix. End with a one-paragraph priority ranking — which 3 defects matter most.

7. NO REWRITING. You are NOT writing the proposal. Do not produce paragraphs of revised prose. Do not include "Here is the fix:" followed by 200 words of rewritten content. The rewriter is a different author who will take your critique as input — your job is to direct, not to draft.

You start the response with "## Critique" and end with "## Priority ranking". No preamble, no outro.`;

const REWRITER_SYSTEM_PROMPT = `You are a senior bid author with 25 years of experience. A senior reviewer has read your draft proposal and produced a structured critique. Your job is to apply that critique to the draft, returning the COMPLETE revised proposal markdown.

Operating principles, in priority order:

1. CRITIQUE-DRIVEN. Apply EVERY defect listed in the critique that has a proposed fix. Where the critique flags an EVIDENCE GAP (no evidence to repair the defect), insert a single short "Bid-Team Action: confirm X before submission." note in place of the missing fact — do not fabricate.

2. PRESERVE-FIRST. Do NOT delete sections, do NOT remove tables, do NOT change factual claims that the critique did not flag. Names, contract values, license numbers, dates, client names — keep them exactly as they appear in the draft.

3. COMPLETE REPLACEMENT. The output is the full revised proposal markdown — drop-in replacement for the draft. Not a diff. Not a list of changes. Not commentary. Start with the existing first line and end with the existing last line, with the fixes integrated in place.

4. NO COMMENTARY. Do not write "I have made the following changes:" or "Here is the revised proposal:". Output the markdown directly.

5. STRUCTURE-NEUTRAL. Do not introduce new top-level sections unless the critique explicitly directs you to add one. Do not rename existing sections. Do not reorder sections — the canonical orderer runs after you and will undo any reordering.

6. EVIDENCE STAYS GROUNDED. If a critique entry tells you to add a project reference, use one that the draft already mentions elsewhere or one that the user message lists in the "Available evidence" block. Never make up project names, license numbers, or contract values.

7. NO-FINANCIAL RULE. If the user message says the tender is TECHNICAL ONLY: the output must NEVER mention cost, pricing, savings, budget, rates, or commercials — not "cost-effective", "budget-friendly", "value-engineered", or "affordable". Scan the full document and remove any such language before returning.

You are a focused author applying explicit direction. The reviewer told you what is wrong; you fix it without commentary.`;

export type DeepCritiqueInput = {
  currentMarkdown: string;
  weakAxes: string[];
  axisScores: Record<string, number>;
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  topProjectNames: string[];
  topExpertNames: string[];
  /** Optional pre-extracted evaluation criteria. Rendered into the critique prompt when present. */
  comprehensionBlock?: string | null;
};

export type DeepRewriteInput = {
  currentMarkdown: string;
  critique: string;
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  topProjectNames: string[];
  topExpertNames: string[];
  noFinancial: boolean;
};

function buildCritiquePrompt(input: DeepCritiqueInput): string {
  const axisDetail = input.weakAxes.length === 0
    ? "(no axes flagged — assume the quality scorer was generous; look for evidence density and evaluator-alignment defects regardless)"
    : input.weakAxes.map((a) => `- ${a} (score: ${input.axisScores[a] ?? "n/a"} / 10)`).join("\n");

  const evidenceBlock = [
    input.topProjectNames.length > 0 ? `Top projects available: ${input.topProjectNames.join("; ")}` : null,
    input.topExpertNames.length > 0 ? `Top experts available: ${input.topExpertNames.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  const comprehension = input.comprehensionBlock && input.comprehensionBlock.trim().length > 0
    ? `\n## Extracted evaluation criteria (anchor critique entries to these IDs)\n\n${input.comprehensionBlock}\n`
    : "";

  return `# Critique request

Tender: "${input.tenderTitle}"
Client: ${input.clientName}
Sector: ${input.primarySector}

## Weak axes flagged by the deterministic scorer

${axisDetail}

## Available evidence inventory

${evidenceBlock || "(no inventory supplied — work from references that already appear in the proposal)"}
${comprehension}
## Draft proposal markdown

${input.currentMarkdown}

## Your task

Read the draft carefully. Produce the structured critique exactly as instructed in your system prompt. Cite location, defect, evidence/language, and proposed fix for every entry. End with the priority ranking.

Return ONLY the critique markdown. Do not produce a revised proposal.
`;
}

function buildRewritePrompt(input: DeepRewriteInput): string {
  const evidenceBlock = [
    input.topProjectNames.length > 0 ? `Available projects: ${input.topProjectNames.join("; ")}` : null,
    input.topExpertNames.length > 0 ? `Available experts: ${input.topExpertNames.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  const financialNote = input.noFinancial
    ? "TENDER IS TECHNICAL ONLY — strip any cost/budget/pricing language entirely."
    : "Financial language is permitted where the critique calls for it.";

  return `# Rewrite request

Tender: "${input.tenderTitle}"
Client: ${input.clientName}
Sector: ${input.primarySector}

${financialNote}

## Available evidence inventory

${evidenceBlock || "(work from references that already appear in the draft)"}

## Critique from the senior reviewer (apply every entry)

${input.critique}

## Draft proposal markdown (apply fixes in place)

${input.currentMarkdown}

## Your task

Return the COMPLETE revised proposal markdown with every defect repaired. Drop-in replacement, no commentary.
`;
}

/**
 * Critique variant that lets Claude call evidence-search tools
 * mid-critique (gap #10). Same prompt + system prompt as
 * `critiqueProposalWithAI`, but routes through the tool-use loop
 * so Claude can verify "does this expert exist?" / "is there
 * evidence for this claim?" before writing each defect entry.
 *
 * Falls back to plain critique (returns null) when:
 *   – Anthropic SDK is unavailable
 *   – No tools / executor supplied
 *   – Tool-loop runs out of turns or every model fails
 *
 * The caller (deep-reasoning-refiner) tries this first; on null it
 * falls back to the tool-less critiqueProposalWithAI.
 */
export async function critiqueProposalWithTools(
  input: DeepCritiqueInput,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  executor: (toolName: string, toolInput: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<string | null> {
  if (!isClaudeEnabled()) return null;
  if (tools.length === 0) return null;
  if (input.currentMarkdown.length > REFINEMENT_MAX_INPUT_CHARS) {
    console.warn(`[ai] critiqueProposalWithTools: skipping — proposal is ${input.currentMarkdown.length} chars, exceeds ${REFINEMENT_MAX_INPUT_CHARS}-char budget.`);
    return null;
  }
  const prompt = buildCritiquePrompt(input);
  try {
    return await withRefinementTimeout(
      generateWithClaudeTools(prompt, CRITIC_SYSTEM_PROMPT, tools, executor),
    );
  } catch (err) {
    console.warn(`[ai] critiqueProposalWithTools failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Run the critique pass. Returns the critique markdown or null on
 * failure. Reuses the same provider fallback chain and timeout
 * envelope as `refineProposalWithAI` so the per-call budget is
 * predictable.
 */
export async function critiqueProposalWithAI(input: DeepCritiqueInput): Promise<string | null> {
  if (!isAIEnabled()) return null;
  if (input.currentMarkdown.length > REFINEMENT_MAX_INPUT_CHARS) {
    console.warn(`[ai] critiqueProposalWithAI: skipping critique — proposal is ${input.currentMarkdown.length} chars, exceeds ${REFINEMENT_MAX_INPUT_CHARS}-char budget.`);
    return null;
  }

  const prompt = buildCritiquePrompt(input);
  try {
    if (isClaudeEnabled()) {
      const claudeResult = await withRefinementTimeout(generateWithClaude(prompt, CRITIC_SYSTEM_PROMPT));
      if (claudeResult) return claudeResult;
    }
    if (apiKey) {
      try {
        return await withRefinementTimeout(generateWithBestModel(prompt));
      } catch (geminiErr) {
        console.warn(`[ai] critiqueProposalWithAI Gemini failed: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)} — trying OpenAI.`);
      }
    }
    if (isOpenAIEnabled()) {
      const openAiResult = await withRefinementTimeout(
        generateWithOpenAI(prompt, CRITIC_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("OpenAI returned null"))),
      );
      if (openAiResult) return openAiResult;
    }
    if (isDeepSeekEnabled()) {
      const deepSeekResult = await withRefinementTimeout(
        generateWithDeepSeek(prompt, CRITIC_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("DeepSeek returned null"))),
      ).catch((e) => { console.warn(`[ai] critiqueProposalWithAI DeepSeek failed: ${e instanceof Error ? e.message : String(e)}`); return null; });
      if (deepSeekResult) return deepSeekResult;
    }
    const tail = await withRefinementTimeout(tryTailFallbackProviders(prompt, CRITIC_SYSTEM_PROMPT)).catch(() => null);
    if (tail) return tail.text;
  } catch (err) {
    console.warn(`[ai] critiqueProposalWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return null;
}

/**
 * Run the rewrite pass — takes the critique from the previous step
 * and applies it. Returns the revised markdown or null on failure.
 */
export async function rewriteProposalWithCritique(input: DeepRewriteInput): Promise<string | null> {
  if (!isAIEnabled()) return null;
  if (input.currentMarkdown.length > REFINEMENT_MAX_INPUT_CHARS) {
    console.warn(`[ai] rewriteProposalWithCritique: skipping rewrite — proposal is ${input.currentMarkdown.length} chars, exceeds ${REFINEMENT_MAX_INPUT_CHARS}-char budget.`);
    return null;
  }

  const prompt = buildRewritePrompt(input);
  try {
    if (isClaudeEnabled()) {
      const claudeResult = await withRefinementTimeout(generateWithClaude(prompt, REWRITER_SYSTEM_PROMPT));
      if (claudeResult) {
        lastProposalProvider = "claude";
        return claudeResult;
      }
    }
    if (apiKey) {
      try {
        const geminiResult = await withRefinementTimeout(generateWithBestModel(prompt));
        lastProposalProvider = "gemini";
        return geminiResult;
      } catch (geminiErr) {
        console.warn(`[ai] rewriteProposalWithCritique Gemini failed: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)} — trying OpenAI.`);
      }
    }
    if (isOpenAIEnabled()) {
      const openAiResult = await withRefinementTimeout(
        generateWithOpenAI(prompt, REWRITER_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("OpenAI returned null"))),
      );
      if (openAiResult) {
        lastProposalProvider = "openai";
        return openAiResult;
      }
    }
    if (isDeepSeekEnabled()) {
      const deepSeekResult = await withRefinementTimeout(
        generateWithDeepSeek(prompt, REWRITER_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("DeepSeek returned null"))),
      ).catch((e) => { console.warn(`[ai] rewriteProposalWithCritique DeepSeek failed: ${e instanceof Error ? e.message : String(e)}`); return null; });
      if (deepSeekResult) {
        lastProposalProvider = "deepseek";
        return deepSeekResult;
      }
    }
    const tail = await withRefinementTimeout(tryTailFallbackProviders(prompt, REWRITER_SYSTEM_PROMPT)).catch(() => null);
    if (tail) { lastProposalProvider = tail.provider; return tail.text; }
  } catch (err) {
    console.warn(`[ai] rewriteProposalWithCritique failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return null;
}

/**
 * Exposed for unit testing of the prompt-building logic without
 * making an AI call. Pure functions; safe to call from tests.
 */
export const __deepReasoningInternals = {
  buildCritiquePrompt,
  buildRewritePrompt,
};

export async function refineProposalWithAI(input: {
  currentMarkdown: string;
  weakAxes: string[];
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  topProjectNames: string[];
  topExpertNames: string[];
}): Promise<string | null> {
  if (input.weakAxes.length === 0) return null;
  if (!isAIEnabled()) return null;
  if (input.currentMarkdown.length > REFINEMENT_MAX_INPUT_CHARS) {
    console.warn(`[ai] refineProposalWithAI: skipping refinement — proposal is ${input.currentMarkdown.length} chars, exceeds ${REFINEMENT_MAX_INPUT_CHARS}-char budget. Original output kept as-is.`);
    return null;
  }

  const axisDirectives: Record<string, string> = {
    structureCompleteness: "Add any missing canonical sections (Cover Letter, Executive Summary, Section A/B/C/D, Declaration). Do NOT delete existing sections; only add what is missing.",
    evidenceDensity: "Rewrite generic paragraphs (without project names, ETB values, license numbers, dates, or named clients) so each substantive paragraph carries at least one specific evidence anchor drawn from the existing project / expert references in the document. Keep all tables intact.",
    tableCoverage: "Where a section refers to data that should be tabular (project portfolio, team, risks, work plan, value framework), convert prose lists to Markdown tables matching the structures already used elsewhere in the document.",
    sectorVocabulary: `Strengthen the Section C technical methodology with sector-specific vocabulary appropriate to ${input.primarySector}. Use terms in context, not as a glossary list.`,
    throughlineConsistency: `Ensure these specific projects appear by name in the Cover Letter, Executive Summary, AND Section B Relevant Experience: ${input.topProjectNames.join("; ") || "the strongest comparable projects available in the document"}.`,
    aiTraceFreedom: `Remove any AI-trace phrases ("As an AI", "Certainly!", "Please note", "[INSERT]", any [square bracket] placeholders, "we look forward to the opportunity", "committed to excellence", "team of qualified professionals"). Replace with substantive content.`,
    complianceMatrixCoverage: "Add or complete Section E: Compliance Matrix. Format MUST be a Markdown table with columns: # | Requirement (verbatim from tender) | Where Addressed in This Proposal (section + sub-section) | Supporting Evidence | Compliance Status. Compliance Status MUST be one of FULLY MET / PARTIALLY MET / NOT MET. Every mandatory and scored requirement listed in the document must have a row. For NOT MET rows, propose a credible mitigation in the same row (subcontractor, joint venture, deferred delivery).",
    evaluatorMirrorCoverage: "Add or complete Section F: Evaluation Criteria Response Mirror. Format MUST be a Markdown table with columns: Evaluation Criterion (echoed in tender language) | Weight (if stated) | Where This Proposal Answers It | Strongest Evidence Anchor. Mirror the evaluator's exact wording back at them — this is a high-leverage scoring tactic. If weights are stated anywhere in the document, populate them verbatim.",
    winThemesPresence: "Add or complete Section G: Win Themes & Discriminators. Open with one paragraph (60–120 words) framing the firm's overall positioning for THIS tender, then a Markdown table with columns: Win Theme | Discriminator (what we have, others typically don't) | Linked Evaluation Criterion | Evidence Anchor. Provide 3–5 themes drawn ONLY from the existing evidence in the document.",
    selfScorePresence: "Add or complete Section H: Proposal Self-Score. Format MUST be a Markdown table with columns: Evaluation Criterion | Weight | Self-Score (0–10) | Rationale | Risk to Score / Mitigation. End with: \"Predicted overall technical score: X / 100. Top three risks to address before submission: 1. … 2. … 3. …\". Be honest — over-confident self-scores damage credibility.",
  };

  const directives = input.weakAxes.map((axis) => `- **${axis}**: ${axisDirectives[axis] ?? "Strengthen this axis using the evidence already in the document."}`).join("\n");

  const prompt = `You are refining an existing technical proposal for tender "${input.tenderTitle}" submitted to ${input.clientName} (sector: ${input.primarySector}).

Below is the current full proposal markdown. A deterministic quality scorer flagged these weak axes:

${directives}

## YOUR TASK

Return the COMPLETE refined proposal markdown. Keep:
- All existing section headings
- All existing tables (do not break Markdown table syntax)
- All existing factual claims (project names, ETB values, license numbers, dates, client names)
- All existing appendix references

Only rewrite the prose to address the weak axes above. The output must be the FULL document, not a diff. Do NOT add explanations or commentary outside the markdown.

## EXISTING PROPOSAL

${input.currentMarkdown}

## REFINED PROPOSAL (return the complete document)
`;

  try {
    if (isClaudeEnabled()) {
      // Pass the dedicated REFINEMENT_SYSTEM_PROMPT so Claude is framed as a
      // senior bid REVIEWER (preserve-then-strengthen), not as the bid
      // WRITER persona used at generation time.
      // PR VV — wrapped in withRefinementTimeout so a slow call never
      // exceeds the per-call budget. Falls through to Gemini on timeout.
      const claudeResult = await withRefinementTimeout(generateWithClaude(prompt, REFINEMENT_SYSTEM_PROMPT));
      if (claudeResult) {
        lastProposalProvider = "claude";
        return claudeResult;
      }
    }
    if (apiKey) {
      try {
        const geminiResult = await withRefinementTimeout(generateWithBestModel(prompt));
        lastProposalProvider = "gemini";
        return geminiResult;
      } catch (geminiErr) {
        console.warn(`[ai] refineProposalWithAI Gemini failed: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)} — trying OpenAI.`);
      }
    }
    // OpenAI as third refinement fallback
    if (isOpenAIEnabled()) {
      try {
        const openAiResult = await withRefinementTimeout(
          generateWithOpenAI(prompt, REFINEMENT_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("OpenAI returned null"))),
        );
        if (openAiResult) {
          lastProposalProvider = "openai";
          return openAiResult;
        }
      } catch (openAiErr) {
        console.warn(`[ai] refineProposalWithAI OpenAI failed: ${openAiErr instanceof Error ? openAiErr.message : String(openAiErr)}`);
      }
    }
    // DeepSeek as 4th refinement fallback
    if (isDeepSeekEnabled()) {
      try {
        const deepSeekResult = await withRefinementTimeout(
          generateWithDeepSeek(prompt, REFINEMENT_SYSTEM_PROMPT).then((r) => r ?? Promise.reject(new Error("DeepSeek returned null"))),
        );
        if (deepSeekResult) {
          lastProposalProvider = "deepseek";
          return deepSeekResult;
        }
      } catch (deepSeekErr) {
        console.warn(`[ai] refineProposalWithAI DeepSeek failed: ${deepSeekErr instanceof Error ? deepSeekErr.message : String(deepSeekErr)}`);
      }
    }
    // Groq → OpenRouter refinement tail.
    const tail = await withRefinementTimeout(tryTailFallbackProviders(prompt, REFINEMENT_SYSTEM_PROMPT)).catch(() => null);
    if (tail) { lastProposalProvider = tail.provider; return tail.text; }
  } catch (err) {
    console.warn(`[ai] refineProposalWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return null;
}

export async function generateBenchmarkProposalWithAI(params: AIBidWriterInput): Promise<string> {
  const noFinancial = /technical proposal only|no financial|financial.*not required|financial proposal.*not/i.test(
    params.submissionNotes + params.tenderText,
  );

  const allText = params.tenderText + params.analysisSummary;

  // Universal sector detection — multiple sectors can be active simultaneously
  const isHealthcare = /health|hospital|medical|clinic|pharma|radiology|laboratory|biomedical/i.test(allText);
  const isFacilityAssessment = /facility identification|shortlisted propert|site assessment|suitable.*propert|premises|renovation.*exist/i.test(params.tenderText);
  const isWater = /water supply|borehole.*water|pump.*station|hydraulic.*design|irrigation.*scheme|WASH|sanitation.*project|water.*scheme|water.*network|reservoir.*design|water.*treatment|wastewater/i.test(allText);
  const isRoadBridge = /road.*design|road.*rehab|bridge.*design|highway.*design|pavement.*design|transport.*infrastructure|culvert|road.*supervision|road.*project|road.*construction/i.test(allText);
  const isBuilding = !isHealthcare && /architectural.*design|building.*design|structural.*design|construction.*supervision|commercial.*building|school.*building|office.*design|factory.*design|warehouse.*design/i.test(allText);
  const isUrban = /urban.*plan|master.*plan|land.*use.*plan|municipal.*develop|spatial.*plan|eco.?park|city.*development|public.*space.*design|settlement.*plan/i.test(allText);
  const isEnvironmental = /ESIA|ESMP|environmental.*impact.*assess|social.*safeguard|environmental.*management.*plan|EHS|climate.*risk.*assess|biodiversity.*assess|resettlement.*action|environmental.*screen/i.test(allText);
  const isICT = /ICT.*system|information.*system.*develop|software.*develop|digital.*platform|database.*system|MIS.*develop|ERP.*implement|network.*design|cyber.*security.*consult|data.*management.*system/i.test(allText);
  const isEducation = !isHealthcare && /school.*design|university.*design|campus.*develop|education.*facilit|training.*cent.*design|vocational.*training.*facilit/i.test(allText);
  const isDonor = /World Bank|UNDP|USAID|GIZ|EU.*fund|AfDB|ADB|JICA|donor.*fund|development.*partner.*fund|bilateral.*donor/i.test(allText);
  const isEnergy = /energy.*project|power.*plant|solar.*farm|wind.*farm|grid.*connect|generation.*capacity|transmission.*line|substation.*design|electrification.*scheme|power.*system.*study|\bsolar\b.*\b(power|pv|panel|system)\b|\bhydropower\b|\belectrification\b|\brenewable.*energy\b|\bpower.*system\b|\boff.?grid\b|\bgrid.*extension\b|\bSCADA\b|\bsubstation\b|\benergy.*infrastructure\b|\benergy.*supply\b|\benergy.*study\b/i.test(allText);
  const isAgriculture = /irrigation.*scheme|agri.*project|crop.*production|farm.*develop|value.?chain.*agri|livestock.*develop|rural.*develop.*agri|smallholder.*farm|water.*user.*association|\birrigation\b.*\b(system|canal|project|develop|design|scheme)\b|\bagriculture\b|\bagricultural.*develop\b|\bfarm.*scheme\b|\bWUA\b|\bagronom\b|\birrigation.*infrastructure\b/i.test(allText);
  const isMining = /mining.*project|mineral.*extract|quarry.*design|pit.*design|tailings.*facility|ore.*body.*assess|blast.*design|mine.*plan|JORC.*report|\bJORC\b|\btailings\b|\bslope.*stability\b|\bmine.*feasibility\b|\bmining.*feasibility\b|\bmineral.*survey\b|\bmineral.*resource\b|\bopen.*pit\b|\bmine.*design\b|\bgeotechnical.*mine\b/i.test(allText);
  const isPort = /port.*design|\bport.*master.*plan|berth.*design|quay.*design|harbour.*develop|dredging.*scheme|container.*terminal.*design|maritime.*infrastructure|\bberth\b|\bdredging\b|\bISPS\b|\bport.*feasibility\b|\bport.*study\b|\bport.*infrastructure\b|\bmaritime.*facilit\b|\bquay.*wall\b|\bnautical\b|\bpilotage\b/i.test(allText);
  const isOilGas = /pipeline.*design|oil.*facilit|gas.*facilit|upstream.*petroleum|HAZOP.*study|P&ID.*develop|refinery.*design|petrochemical.*plant|wellhead.*design|\bHAZOP\b|\bP&ID\b|\bpipeline.*integrity\b|\bprocess.*safety\b|\bpipeline.*engineer\b|\bupstream.*oil\b|\bupstream.*gas\b|\bLNG\b|\bFEED\b.*\b(oil|gas|process)\b|\brefinery\b|\bpetrochemical\b/i.test(allText);
  const isFinancial = /KYC.*framework|AML.*framework|core.*banking.*system|microfinance.*system|credit.*risk.*model|IFRS.*implement|Basel.*compliance|prudential.*regul.*framework|capital.*adequacy.*assess|\bKYC\b|\bAML\b|\bBasel\b.*\b(III|IV|compliance|standard)\b|\bIFRS\b.*\b(9|17|implement|adopt)\b|\bcore.*banking\b|\bmicrofinance.*platform\b|\bcredit.*risk.*assess\b|\bprudential.*regulation\b/i.test(allText);
  const isTelecoms = /spectrum.*licen|base.*station.*design|backhaul.*design|last.?mile.*access|broadband.*network.*design|telecoms.*infra|LTE.*deploy|5G.*rollout|mobile.*network.*rollout|\bspectrum.*plan\b|\bspectrum.*manage\b|\bbroadband.*infrastruc\b|\btelecoms.*develop\b|\bbase.*station\b|\bLTE\b|\b5G\b|\bmobile.*network\b|\bbroadband.*rollout\b|\bISP.*develop\b|\bbackhaul.*network\b/i.test(allText);
  const isHeritage = /heritage.*conserv|conserv.*heritage|historic.*building|adaptive.*reuse|listed.*building|monument.*restor|museum.*design|heritage.*restor/i.test(allText);
  const isIndustrial = /industrial.*facilit|manufactur.*plant|factory.*design|abattoir.*design|processing.*plant.*design|production.*facilit|industrial.*build/i.test(allText);
  const isHighRise = /high.rise.*build|multi.stor.*build|tower.*build.*design|\bG\+\d{2,}\b|basement.*podium|tall.*build.*design|supertall|skyscraper/i.test(allText);
  const isHospitality = /hotel.*design|resort.*design|lodge.*design|hospitality.*facilit|guesthouse.*design|five.star.*hotel|luxury.*hotel.*develop/i.test(allText);
  const isQCBS = /\bQCBS\b|quality.*cost.*based.*selection|quality.?based.*selection|\bQBS\b|technical.*score.*threshold|technical.*pass.*mark|financial.*envelope|financial.*proposal.*not.*open/i.test(allText);
  const isSupervision = /construction.*supervision|resident.*engineer|contract.*administration|site.*supervision|supervision.*consultant|engineer.*representative|contract.*manager/i.test(allText);
  const isGeotechnical = /geotechnical.*investigation|soil.*investigation|site.*investigation|ground.*investigation|borehole.*programme|subsoil.*investigation|geotechnical.*study|foundation.*investigation/i.test(allText);

  const tenderSections = extractTenderSections(params.tenderText);
  const exactEmails = Array.from(
    (params.tenderText + params.submissionNotes).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
  )
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");

  const subjectMatch =
    (params.tenderText + params.submissionNotes).match(/Subject(?:\s+Line)?\s*:\s*[""]([^""]+)[""]/i) ??
    (params.tenderText + params.submissionNotes).match(/subject[^\n.]{0,30}[""]([^""]{5,120})[""]/i);
  const exactSubject = subjectMatch?.[1] ?? `Technical Proposal for ${params.tenderTitle}`;

  // Sector-specific proposal guidance blocks — injected verbatim into the prompt only when detected
  const healthcareGuidance = isHealthcare
    ? `
HEALTHCARE-SPECIFIC PROPOSAL GUIDANCE (mandatory for this tender):
- Cover letter MUST cite the company's specific hospital project experience by name and ETB/contract value from the evidence.
- Executive Summary must lead with: "We have already delivered this assignment" framing if hospital evidence exists.
- Team section must show each expert's ROLE on a PREVIOUS HOSPITAL PROJECT — not just qualifications.
- Include a Team-to-Project Experience Mapping section showing expert → previous hospital project → role performed.
- Technical Approach must address: clinical zone segregation (Emergency/OPD/In-patient/Laboratory/Imaging/Pharmacy), patient-staff-supply flow, IPC compliance, radiation shielding for imaging, medical gas coordination, accessible design.
- MEP section must cover: medical-grade electrical load planning, UPS/generator backup for life-critical loads, ICT/nurse call/BMS/fire alarm, medical gas, clinical waste stream segregation.
- Regulatory: Ethiopian Health Authority licensing, EBCS compliance, World Bank ESF documentation (if applicable).
- Biomedical engineering integration must be addressed even if naming a specialist-to-be-engaged.
- QA: staged design review (conceptual → schematic → detailed → construction documents).`
    : "";

  const facilityGuidance = isFacilityAssessment
    ? `
FACILITY IDENTIFICATION SCOPE GUIDANCE:
- "Facility Identification and Technical Assessment" section must describe the assessment matrix: structural adequacy, spatial feasibility, utility availability, regulatory compliance, accessibility, patient flow potential, safety, expansion possibilities.
- Must offer written technical recommendation methodology for shortlisted properties with a clear recommended/not-recommended conclusion per site.`
    : "";

  const waterGuidance = isWater
    ? `
WATER/SANITATION/HYDRAULICS GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest specific water supply or sanitation project by name, client, and capacity/contract value from the evidence.
- Technical Approach must address: source investigation (borehole siting, geophysical survey, or surface intake), demand projection methodology, hydraulic modelling (WaterCAD/EPANET or equivalent), pipe network sizing, pump station design (head, flow, power/solar), storage reservoir sizing, water quality/treatment design.
- BOQ and specifications must be directly linked to hydraulic design outputs — not generic quantities.
- Include: borehole drilling supervision protocol, pump testing/yield assessment, chlorination/disinfection design, sanitary protection zone.
- Construction supervision: field engineer duties, pipe pressure testing, concrete testing, commissioning checklist, as-built documentation.
- Deliverables: O&M manual, community water management training, performance handover certificate.
- WASH component (if applicable): sanitation facility design standard (pupil/patient ratio compliance), hygiene promotion approach.`
    : "";

  const roadBridgeGuidance = isRoadBridge
    ? `
ROAD/BRIDGE/TRANSPORT INFRASTRUCTURE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest road/bridge project by name, client, length/value, and country from the evidence.
- Technical Approach must address: route survey and alignment, topographic survey control, geotechnical investigation (CBR, proctor, borehole/test pit), traffic count and design traffic (AADT, ESAL), road design standard (ERA design manual, AASHTO, or applicable), pavement design layers and thicknesses, drainage design (culverts, side drains, retention ponds), bridge/structure design (if applicable), road safety audit, environmental and social controls.
- Construction supervision: engineer's representative duties, materials testing programme (CBR, compaction, aggregate quality), progress reporting format, variation/claim management, interim payment certification, defects liability monitoring.
- BOQ: earthworks quantities, surfacing, drainage structures, bridges — all linked to design drawings.
- Handover: as-built drawings, maintenance manual, performance monitoring framework, road authority acceptance.`
    : "";

  const buildingGuidance = isBuilding
    ? `
BUILDING/ARCHITECTURE/SUPERVISION GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable building project by name, client, and ETB/contract value from the evidence.
- Technical Approach must address: functional brief and space schedule, site analysis, architectural concept, structural system selection, MEP coordination (electrical, mechanical, plumbing), accessibility (Universal Design), life safety (fire egress, smoke control, emergency lighting), building permit documentation.
- Design stages: concept → schematic → design development → detailed design/working drawings → construction documents.
- Construction supervision: site inspection regime, material/shop drawing approval workflow, progress certification, variation control, quality testing (concrete cube, rebar, welding), defects register.
- BOQ/cost: elemental cost plan at design development; detailed BOQ at working drawings stage.
- Handover: as-built documentation, O&M manuals, warranties, regulatory sign-off, completion certificate.`
    : "";

  const urbanGuidance = isUrban
    ? `
URBAN/MASTER PLANNING GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable urban planning or master plan project by name, scale (hectares/population), and client from the evidence.
- Technical Approach must address: baseline studies (GIS-based land use mapping, demographic analysis, infrastructure inventory), land-use zoning scenario development, infrastructure demand assessment (transport, water, utilities, green space), environmental and social screening, phasing and priority project identification, stakeholder consultation framework.
- Master Plan deliverables: vision, objectives, strategic land-use map, infrastructure plan, phasing, implementation roadmap, regulatory alignment checklist, investment framework summary.
- Community/authority engagement: workshop design, survey methodology, consultation record, public disclosure, conflict/grievance management.
- GIS: spatial data collection methodology, layer management, map production standards, dataset handover format.
- Implementation: capacity building plan for municipal counterpart, M&E framework, indicator set.`
    : "";

  const environmentalGuidance = isEnvironmental
    ? `
ENVIRONMENTAL/SOCIAL IMPACT ASSESSMENT GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable ESIA/ESMP report by name, donor/client, and country from the evidence.
- Technical Approach must address: baseline data collection methodology (physical environment, biological survey, socioeconomic survey), legal and regulatory framework review (national law + donor safeguards), impact identification using structured matrices (Leopold or equivalent), mitigation hierarchy (avoid → minimise → restore → offset → compensate).
- ESMP: management measures per impact, monitoring indicators, responsibilities, reporting schedule, budget estimate, grievance mechanism design.
- Stakeholder engagement plan: consultation event design, disclosure requirements, feedback incorporation, vulnerable group inclusion.
- Donor alignment: World Bank ESF standards (ESS1–10) or equivalent; project screening/categorisation; ESMP format; PAP census and livelihood restoration plan (if applicable).
- Reporting: ESIA/ESMP report structure, regulatory submission package, monitoring-ready annexes, public disclosure draft.`
    : "";

  const ictGuidance = isICT
    ? `
ICT/DIGITAL SYSTEMS GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable system deployment by name, client, user count, and delivery period from the evidence.
- Technical Approach must address: requirements analysis and business process review, functional and technical specification, system architecture (application, database, network/hosting layers), data security controls (access management, encryption, audit trail, backup/disaster recovery), integrations with existing systems (APIs, data migration plan).
- Implementation methodology: phased delivery approach (agile sprints or structured phases), acceptance testing plan (unit, integration, UAT), training programme (train-the-trainer, user manuals), change management and adoption strategy.
- Go-live: deployment checklist, parallel-run strategy, cutover plan, data validation and reconciliation protocol.
- Post-deployment: SLA definition, help desk/support model, patch/update management plan, full documentation set, source code and data handover.`
    : "";

  const donorGuidance = isDonor
    ? `
DONOR-FUNDED PROJECT COMPLIANCE GUIDANCE:
- Explicitly name the donor/funder and confirm compliance with their procurement and quality standards in the Executive Summary and Technical Approach.
- Reference the applicable conditions of contract (FIDIC, UNCITRAL, or donor-specific) and state key contract administration obligations.
- Donor reporting: M&E framework (output/outcome/impact indicators with baselines), progress report format and frequency, financial accountability requirements.
- Environmental and social screening: applicable safeguard standards (World Bank ESF/IFC PS, UNDP SES, or other), screening category, identified E&S risks and mitigation approach.
- Quality Management Plan: ISO 9001:2015-aligned, document control system, design review gate protocol, independent peer review.`
    : "";

  const educationGuidance = isEducation
    ? `
EDUCATION FACILITY DESIGN GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable school/university project by name, client, and ETB/contract value from the evidence.
- Technical Approach must address: functional brief and space schedule (classrooms, laboratories, library, administration, sanitation, sports), accessible and inclusive design (ramps, accessible toilets, wayfinding for all users), climate-responsive design (natural ventilation, shading, daylighting, thermal comfort), structural adequacy for assembly occupancy.
- MEP: power supply, backup generator/solar, water supply and sanitation (pupil-to-toilet ratio compliance with national standards), ICT cabling and display systems, fire detection and emergency systems.
- Site design: boundary security, vehicular/pedestrian separation, outdoor learning and recreation areas.
- Regulatory: building permit, education authority functional approval, fire certificate.
- Supervision: standard materials testing programme, progress reporting, defects register, handover documentation.`
    : "";

  const energyGuidance = isEnergy
    ? `
ENERGY / POWER INFRASTRUCTURE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable energy/power project by name, capacity (MW/kW), client, and country from the evidence.
- Technical Approach must address: load forecasting (minimum 5-year metered data + growth model), generation technology assessment (renewable vs. diesel vs. hybrid), grid-code compliance obligations (utility interconnection requirements, protection relay coordination), single-line diagram design, SCADA architecture, environmental screening, equipment procurement schedule.
- Grid integration: load-flow analysis, short-circuit study, protection relay coordination (independent peer review), power-quality assessment, reactive power compensation.
- Renewable option: solar PV yield assessment (HOMER or equivalent), wind resource evaluation, battery storage sizing, grid-integration design, interconnection agreement support.
- BOQ and specifications: equipment specifications (transformers, switchgear, cables, inverters, protection relays), structured with early LOI for long-lead items.
- Commissioning: energisation protocol, protection relay testing, SCADA commissioning, operator training, handover with O&M manual and as-built drawings.`
    : "";

  const agricultureGuidance = isAgriculture
    ? `
AGRICULTURE / IRRIGATION / RURAL DEVELOPMENT GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable irrigation or agriculture project by name, command area (ha), client, and country from the evidence.
- Technical Approach must address: hydrological analysis (minimum 20-year flow record, low-flow scenario), soil classification and permeability, crop-water requirement using FAO Penman-Monteith (Kc per growth stage), irrigation network design (canal or pressurised pipe), drainage and salinity management, water-user association (WUA) governance design.
- Source development: borehole siting, pumping test, surface intake design, water quality assessment, source protection zone.
- Scheme design: command area delineation, conveyance efficiency, on-farm distribution, field layout, structure design (head works, offtakes, check structures).
- WUA: governance bylaws, training programme, O&M cost recovery, willingness-to-pay survey, tariff setting.
- Handover: O&M manual in local language, operator training, irrigation scheduling tool, agronomic recommendations per crop type.`
    : "";

  const miningGuidance = isMining
    ? `
MINING / EXTRACTIVE INDUSTRIES GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable mining feasibility or design study by name, commodity, resource size, client, and country from the evidence.
- Technical Approach must address: geological mapping, drill programme design, block-model resource estimation (JORC 2012 compliant, independent competent-person review), geotechnical investigation (RMR/Q-system, rock mass characterisation), slope stability analysis (LEM + numerical + empirical methods, minimum three methods).
- Mine design: pit design (open pit or underground), production scheduling, waste-dump design, haul-road layout, dewatering design, blast design framework.
- Tailings: TSF design per MAC/ANCOLD guidelines, dam-safety classification, dam-breach analysis, monitoring instrumentation, emergency action plan.
- ESIA: environmental baseline (air, water, noise, biodiversity), impact identification, mitigation hierarchy, ESMP with monitoring indicators, community engagement plan, grievance mechanism.
- Closure: mine closure plan, progressive rehabilitation schedule, financial provision estimate (closure bond or equivalent), post-closure monitoring.
- Regulatory: JORC-compliant resource report, permitting pathway, community consultation disclosure.`
    : "";

  const portGuidance = isPort
    ? `
PORT / MARITIME INFRASTRUCTURE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable port or maritime project by name, throughput (TEU/cargo tonnes), client, and country from the evidence.
- Technical Approach must address: vessel-class parameter confirmation with port authority (LOA, DWT, draft, beam), met-ocean data set (waves, wind, current, storm return periods), fast-time nautical simulation to validate berth pocket and turning basin, mooring analysis at worst-case met-ocean conditions (bollard force calculations).
- Survey and investigation: bathymetric survey, geotechnical borehole programme, sediment characterisation (contamination screen), underwater inspection (if applicable).
- Design: berth structural design (PIANC standards — piles, quay wall, fender system, bollards), dredging plan (volume, disposal site, turbidity monitoring), shore-power provision (ESPO Green Guide alignment), landside circulation and pavement design.
- Regulatory: dredge disposal approval, ISPS compliance plan, port authority pre-approval process, environmental clearance sequence.
- Port operations: port operations manual template, vessel traffic management procedures, emergency response plan, ISPS security plan, handover package.`
    : "";

  const oilGasGuidance = isOilGas
    ? `
OIL & GAS / PETROLEUM ENGINEERING GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable oil/gas or pipeline project by name, capacity (million m³/day or bbl/day), client, and country from the evidence.
- Technical Approach must address: design-basis confirmation (applicable codes: API 1104/API 570, ASME B31.3, ISO 3183, ASME VIII), process flow diagram (PFD), P&ID development (P&ID rev 0 at FEED, freeze protocol after HAZOP), P&ID change management (formal MOC procedure).
- Process safety: HAZOP study (full team study with action-item register accessible in real time), LOPA for high-severity nodes, all HAZOP actions tracked to close-out before detailed design freeze, emergency shutdown logic, PTW system design.
- Detailed engineering: pipeline stress analysis (Caesar II or equivalent), wall-thickness design (design pressure + corrosion allowance), equipment layout, civil and structural design, instrumentation and control (P&ID detail, instrument index), electrical (hazardous area classification, area classification drawings).
- Integrity: cathodic protection system design, in-line inspection (ILI) programme specification at handover, pipeline integrity management plan (IMP), corrosion-monitoring strategy.
- Procurement: vendor data requirements matrix (issued with POs), early LOI for long-lead items (major vessels, compressors, rotating equipment), databook compilation at mechanical completion.
- Commissioning: pre-commissioning (flushing, hydro-test), commissioning, startup, handover (as-built drawings, equipment manuals, safety dossier).`
    : "";

  const financialGuidance = isFinancial
    ? `
FINANCIAL SERVICES / BANKING SYSTEM GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable financial-sector assignment by name, institution type, client country, and scope from the evidence.
- Technical Approach must address: regulatory gap analysis (reviewed by licensed local legal counsel — AML/KYC, capital adequacy, IFRS 9, Basel III/II as applicable), target operating model design, business process mapping, data-quality assessment (ranked by business impact before migration planning), system architecture design, integration plan (APIs, protocols, error handling).
- Compliance: KYC onboarding workflow, AML transaction monitoring configuration, sanctions screening, regulatory reporting framework aligned to central bank requirements.
- Data migration: full data-quality assessment → test migration on extracted sample → reconciliation sign-off before cutover → rollback plan documented before any production data is touched.
- Implementation: phased go-live with parallel-run period, UAT protocol (covering all critical business processes, ≥ 98% pass rate for critical flows), defect triage before go-live.
- Change management: change-readiness survey at kick-off and 60% gate, train-the-trainer programme, user manuals in local language, management champion at each business unit.
- Security: RBAC across application and data layers, encryption at rest and in transit, audit-log retention, periodic penetration testing schedule.
- Handover: source code, data, and documentation transfer; SLA-defined exit clause; post-go-live hypercare period (4–6 weeks).`
    : "";

  const telecomsGuidance = isTelecoms
    ? `
TELECOMS / BROADBAND INFRASTRUCTURE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable network deployment by name, technology (LTE/5G/fibre), coverage area, client, and country from the evidence.
- Technical Approach must address: spectrum licensing pathway (submission timeline, alternative frequency fallback if primary band delayed), RF propagation modelling (Atoll, Planet, or equivalent), coverage targets and signal-strength thresholds (RSRP, SINR, throughput), site shortlist with two alternative locations per target site.
- Site design: tower/mast type selection, structural load analysis, equipment layout, civil works specifications, power (grid/solar/hybrid), shelter/cabinet design, earthing and lightning protection.
- Backhaul: microwave link budget (end-to-end, each hop), diversity options for critical links, fibre-backhaul specification where applicable, backhaul dimensioned at 120% of peak throughput forecast.
- Core network: core dimensioning (MSC, SGW, PGW, IMS as applicable), upgrade path for 3-year traffic growth, interconnection and roaming framework.
- Regulatory: type-approval compliance, ISPC registration, quality-of-service (QoS) obligations, SLA breach protocol.
- Commissioning: RF commissioning (VSWR, cable sweep), drive-test coverage measurement (RSRP, RSRQ, throughput maps), NOC KPI dashboard pre-configured, hypercare period (4–6 weeks), SLA breach escalation protocol.`
    : "";

  const isEOI = /\bEOI\b|expression of interest/i.test(params.tenderText ?? "");
  // isQCBS already declared above (uses allText for broader detection)
  const isQBS = /\bQBS\b|quality.?based.*selection/i.test(allText);
  const isWorldBankTender = /World Bank|IBRD|IDA|WB.*procurement/i.test(allText);
  const isUNDPTender = /\bUNDP\b|United Nations Development Programme/i.test(allText);
  const isAfDBTender = /\bAfDB\b|African Development Bank|Agence Française de Développement|\bAFD\b/i.test(allText);

  const heritageGuidance = isHeritage
    ? `
HERITAGE CONSERVATION & ADAPTIVE REUSE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable heritage conservation or restoration project by name, building type, client, and ETB/contract value from the evidence.
- Technical Approach must address: condition survey and significance assessment (ICOMOS principles — minimum intervention, reversibility, compatibility), material-compatibility testing (XRF/petrographic) before specifying repair mortars, structural stabilisation design, MEP upgrade using reversible/compatible materials.
- Heritage authority engagement: pre-application meeting at conservation-plan stage; conservation philosophy approved before design freeze; three-gate review (conservation plan → tender documents → construction phase).
- Supervision: specialist contractor supervision with material-sample approval protocol; NCR register for every non-conforming intervention; photographic record at each phase.
- Documentation: photogrammetric 3D scan/point-cloud model at inception; as-built conservation drawings; before/after photographic archive; updated condition report; maintenance manual; handover to cultural authority.`
    : "";

  const industrialGuidance = isIndustrial
    ? `
INDUSTRIAL & MANUFACTURING FACILITY GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable industrial/factory project by name, production type, client, and ETB/contract value from the evidence.
- Technical Approach must address: process brief and production-flow analysis (value-stream mapping, lean principles), utility demand assessment (power, water, compressed air, waste streams), industrial structural design (heavy loading), HVAC/exhaust ventilation system, industrial flooring specification, fire suppression system, effluent treatment design to Ethiopian EPA/WHO standards.
- Environmental approvals: EIA/ESIA scope, effluent treatment design, waste management plan, occupational safety assessment.
- Equipment integration: factory acceptance test (FAT) protocol; commissioning sequencing plan; operator training programme.
- Digital 3D plant model for clash detection and installation sequencing; as-built drawings for O&M manual.`
    : "";

  const highRiseGuidance = isHighRise
    ? `
HIGH-RISE / MULTI-STOREY BUILDING GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable high-rise or multi-storey project by name, floor count (G+N), structural system, client, and ETB/contract value from the evidence.
- Technical Approach must address: structural system selection (shear wall/core-frame/hybrid) with ETABS/SAP2000 analysis incorporating Ethiopian seismic zone (EBCS-8/ES EN 1998) and wind loads, shear wall and core layout, transfer beam/slab design, foundation design (mat/pile), independent structural peer review.
- BIM coordination: LOD 300+ full architectural/structural/MEP coordination; clash detection for MEP riser routing and structural penetrations.
- Specialist systems: aluminium curtain wall specification, lift/car-lift design, BMS, fire alarm and suppression, generator/UPS sizing.
- Regulatory: structural calculation submission to AA City/regional authority formatted to authority checklist.
- Construction supervision: hold-point inspections at foundation, shear wall pours, curtain wall installation, and lift acceptance test.`
    : "";

  const hospitalityGuidance = isHospitality
    ? `
HOSPITALITY & HOTEL DESIGN GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable hotel/resort project by name, star rating, room count, client, and ETB/contract value from the evidence.
- Technical Approach must address: feasibility and development programme (room mix, F&B concept, BOH efficiency), RevPAR market benchmarking, brand-standard compliance matrix embedded from concept stage, mock guestroom constructed and approved before full fit-out.
- Interior design: finishes schedule, FF&E specification and procurement schedule with lead-time tracking, lighting design, brand-standard compliance checklist.
- MEP specialist systems: VRF/fan-coil guestroom HVAC, kitchen ventilation, pool/spa mechanical, AV and guest-technology design, access-control system.
- Pre-opening: room-by-room snagging protocol; MEP commissioning tests; brand-operator final punch list clearance; handover pack.
- Sustainability: water consumption target ≤200 L/guest-night; GSTC criteria alignment; local sourcing ≥40% of F&B spend.`
    : "";

  const supervisionGuidance = isSupervision
    ? `
CONSTRUCTION SUPERVISION & CONTRACT ADMINISTRATION GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable supervision/contract administration assignment by name, contract value supervised, duration, procurement standard (FIDIC/MoW), and client from the evidence.
- Technical Approach must address: Inspection and Test Plan (ITP) issuance on day one; daily/weekly site inspection regime; material/shop-drawing approval workflow; non-conformance report (NCR) protocol; variation-order assessment and certification timeline (target ≤10 days); interim payment certificate preparation and submission schedule; S-curve and cash-flow tracking in monthly progress reports; defects notification and close-out register.
- Quality system: ISO 9001-aligned QA plan submitted to client within 14 days of mobilisation; independent audit of high-risk structural elements at defined hold points.
- FIDIC compliance: Clause 3.1 Engineer's Representative authority; Clause 13 Variations management; Clause 14 Payment certification; Clause 20 Claims and dispute avoidance board.
- Staffing: Resident Engineer with FIDIC accreditation; structural, MEP, and QA inspectors proportionate to contract scope; dedicated document controller.
- Handover: punch-list protocol, substantial completion certificate, defects liability inspection schedule, final account preparation, and completion report with photographic record.`
    : "";

  const geotechnicalGuidance = isGeotechnical
    ? `
GEOTECHNICAL INVESTIGATION GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable geotechnical investigation assignment by name, number of boreholes, founding depth, soil conditions encountered, client, and ETB/contract value from the evidence.
- Technical Approach must address: desk study (geological maps, hydrogeological records, previous investigation reports), borehole/trial-pit programme design (depth, spacing, sampling intervals calibrated to structure footprint and anticipated loading), SPT at 1.5 m intervals, undisturbed sampling for laboratory testing, permeability/falling-head tests where groundwater is encountered.
- Laboratory programme: grain-size distribution, Atterberg limits, natural moisture content, compaction characteristics, unconfined compressive strength, triaxial shear strength, CBR (for road/pavement elements). Accredited laboratory must be confirmed before testing commences.
- Analysis: bearing-capacity calculation (Terzaghi/Meyerhof/EC7), settlement analysis (immediate and long-term), liquefaction susceptibility index (for seismic zone), slope-stability check (Bishop simplified) where terrain requires, pile capacity recommendation with factors of safety.
- Deliverable: geotechnical investigation report with executive summary, borehole logs, laboratory results, interpreted soil profile, and foundation type recommendation; independent peer review before issue.`
    : "";

  const eoiGuidance = isEOI
    ? `
NOTE: This tender is an EXPRESSION OF INTEREST (EOI). Structure accordingly: Company Profile → Relevant Experience (3–5 named projects) → Team Qualifications (key experts, qualifications, years of experience) → Company Capacity statement. EOI proposals should be concise (typically 5–15 pages), qualification-heavy, and should NOT include detailed methodology or financial data unless explicitly requested.`
    : "";

  const qcbsGuidance = (isQCBS || isQBS)
    ? `
QCBS / QBS SELECTION GUIDANCE (mandatory for this tender):
- This tender uses Quality and Cost Based Selection (QCBS) or Quality Based Selection (QBS). The technical proposal is evaluated INDEPENDENTLY before the financial envelope is opened.
- Technical threshold to pass: typically ≥75 points out of 100 before financial envelope is opened. A proposal below the threshold is disqualified regardless of price.
- Scoring structure (typical weights — check tender for exact allocation):
  • Staffing / CVs: 30–40 points — each proposed expert must be named, with CV demonstrating specific comparable project experience and licences
  • Methodology / Work Plan: 20–30 points — detailed, deliverable-linked work plan required; generic methodology templates score near zero
  • Relevant Experience: 10–20 points — firm's comparable projects with verifiable client references and contract values
  • Firm Profile / Capacity: 10–15 points — legal status, key certifications, staff count, sector registrations
- For QBS (Quality Only): the financial envelope is NOT opened — only the quality score determines selection. Emphasis shifts entirely to methodology depth, team calibre, and firm profile. Do NOT reference price competitiveness in any section.
- For QCBS: once technical threshold is passed, financial weight (typically 20–30%) is combined with technical weight. The combined score determines ranking.
- Proposal structure must map explicitly to each evaluation criterion — use sub-headings that mirror the evaluation matrix in the tender document.`
    : "";

  const worldBankGuidance = isWorldBankTender
    ? `
WORLD BANK PROCUREMENT GUIDANCE (mandatory for this tender):
- This tender is financed or administered under World Bank Consultant Guidelines 2011 or Procurement Regulations 2020. Compliance is a mandatory eligibility condition.
- Anti-corruption declaration: include a signed statement that the firm has not been debarred by the World Bank, is not subject to sanctions, and has not offered or received improper advantages.
- Conflict of interest: disclose any relationship with the client, government entities, or other bidders that could constitute a conflict of interest. Any undisclosed conflict is grounds for disqualification.
- Eligibility: firm and all proposed experts must be from eligible countries (confirm World Bank negative list). Disclose any nationality or country-of-origin eligibility issues.
- Environmental and Social Framework (ESF): proposals must reference applicable ESF/ESS (ESS1–ESS10) in the technical approach and ESMP methodology.
- Reporting and M&E: progress reports must include output/outcome indicators against baseline, and financial accountability summary per World Bank fiduciary requirements.`
    : "";

  const undpGuidance = isUNDPTender
    ? `
UNDP PROCUREMENT GUIDANCE (mandatory for this tender):
- This tender follows the UNDP Procurement Manual and Supplier Code of Conduct. Compliance with UNDP's procurement standards is mandatory.
- Proposal structure: Part 1 — Firm/Organization Profile and Experience; Part 2 — Technical Methodology and Work Plan. Financial proposal submitted separately in sealed envelope — do NOT include pricing in the technical proposal.
- UNDP Sustainable Procurement: address gender equality, environmental sustainability, and local economic development explicitly in the methodology.
- Anti-corruption and ethics: all team members must sign UNDP's ethics and anti-corruption declaration. Include declaration template reference in the appendix register.
- SDG alignment: where applicable, link the project methodology to specific SDG targets and explain how delivery contributes to measurable progress.`
    : "";

  const afdbGuidance = isAfDBTender
    ? `
AfDB / AFD PROCUREMENT GUIDANCE (mandatory for this tender):
- This tender is financed under African Development Bank (AfDB) or Agence Française de Développement (AFD) standards. Apply the relevant funder's procurement rules throughout.
- AfDB: follow the AfDB Procurement Policy for Bank Group-Financed Operations. Environmental and Social Policy (ESAP/ESPS) governs safeguards. Anti-corruption and debarment declaration required.
- AFD: follow AFD's Aide-Mémoire for consultants. If the tender is in French, the proposal must be submitted in French (technical acronyms may be bilingual). AFD ESPS and ESSS safeguard standards apply.
- Both funders require: debarment and sanctions check declaration; proof of legal status and eligibility; anti-corruption certification; named quality assurance officer.`
    : "";

  // Combine all active sector guidance blocks for injection into Section C
  const allSectorGuidance = [
    healthcareGuidance, facilityGuidance, waterGuidance, roadBridgeGuidance,
    buildingGuidance, urbanGuidance, environmentalGuidance, ictGuidance,
    donorGuidance, educationGuidance,
    energyGuidance, agricultureGuidance, miningGuidance, portGuidance,
    oilGasGuidance, financialGuidance, telecomsGuidance,
    heritageGuidance, industrialGuidance, highRiseGuidance, hospitalityGuidance,
    supervisionGuidance, geotechnicalGuidance,
    eoiGuidance, qcbsGuidance, worldBankGuidance, undpGuidance, afdbGuidance,
  ].filter(Boolean).join("\n\n");

  // Dynamic cover page headline facts calibrated to detected sector
  const coverPageExample = isHealthcare
    ? `"2 Hospitals Designed | ETB 675M+ Healthcare Portfolio | 12-Expert Multidisciplinary Team | EIASC Grade A Licensed"`
    : isWater
    ? `"5 Water Supply Schemes Delivered | Hydraulic Modelling In-house | FIDIC-Compliant Supervision | 12+ Boreholes Supervised"`
    : isRoadBridge
    ? `"8 Road Projects Supervised | 150km+ Roads Designed | Bridge Engineering Capability | ERA/MoT-Compliant Methodology"`
    : isUrban
    ? `"12 Master Plans Delivered | GIS Spatial Analysis In-house | Multi-Stakeholder Consultation | Municipal Planning Specialists"`
    : isEnvironmental
    ? `"15 ESIA/ESMP Reports Accepted | World Bank ESF Compliant | Licensed Environmental Practitioners | Stakeholder Engagement Specialists"`
    : isICT
    ? `"6 Enterprise Systems Deployed | 150+ Users Trained | Secure Cloud Architecture | Full Source Code Handover"`
    : isEducation
    ? `"3 School Campuses Designed | Accessible & Climate-Responsive Design | Full MEP Integration | Building Permit Support"`
    : isEnergy
    ? `"5 Power Projects Delivered | Grid-Code Compliant Design | SCADA Integration | Renewable Energy Specialists"`
    : isAgriculture
    ? `"6 Irrigation Schemes Delivered | FAO Penman-Monteith Methodology | WUA Governance Specialists | O&M Handover Proven"`
    : isMining
    ? `"4 Mining Feasibility Studies | JORC-Compliant Resource Estimation | Slope Stability Specialists | TSF Design Proven"`
    : isPort
    ? `"3 Port Infrastructure Studies | PIANC-Standard Berth Design | Dredging Specialists | ISPS Compliance Proven"`
    : isOilGas
    ? `"5 Oil & Gas Engineering Projects | HAZOP Specialists | Pipeline Integrity Management | API/ASME-Compliant Design"`
    : isFinancial
    ? `"4 Core Banking Implementations | KYC/AML Framework Specialists | Data Migration Proven | Regulatory Compliance Track Record"`
    : isTelecoms
    ? `"3 Network Rollouts Delivered | RF Propagation Specialists | Spectrum Regulatory Support | NOC KPI Dashboard Implemented"`
    : isHeritage
    ? `"5 Heritage Conservation Projects | Conservation Management Plan Specialists | Minimal-Intervention Design | Photogrammetric Survey Capability"`
    : isIndustrial
    ? `"6 Industrial Facilities Designed | Process Engineering In-house | HAZOP-Reviewed Design | Commissioning Protocol Proven"`
    : isHighRise
    ? `"4 High-Rise Buildings Designed | Dynamic Wind & Seismic Analysis | BIM Coordination In-house | Curtain-Wall Specification Proven"`
    : isHospitality
    ? `"5 Hospitality Projects Delivered | Brand-Standard Compliance | FF&E Coordination | Pre-Opening Commissioning Proven"`
    : isSupervision
    ? `"12 Contracts Supervised | FIDIC-Accredited Resident Engineers | ITP & NCR System | ETB 1B+ Contract Value Under Supervision"`
    : isGeotechnical
    ? `"50+ Boreholes Completed | Accredited Geotechnical Laboratory | Bearing Capacity & Settlement Analysis | Site Investigation Report Delivery Proven"`
    : isDonor
    ? `"10+ Donor-Funded Projects Delivered | World Bank / UNDP Track Record | ISO-Aligned Quality System | FIDIC-Compliant Contract Administration"`
    : `"10+ Major Projects Delivered | Multidisciplinary Expert Team | Evidence-Backed Technical Approach | ISO-Aligned Quality System"`;

  const sectionStructureGuidance =
    tenderSections.length > 0
      ? `
EXACT TENDER SECTION STRUCTURE — follow this precisely:
${tenderSections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Each section heading in your proposal must match or directly correspond to one of these tender sections.`
      : "";

  const prompt = `You are a 12-person senior bid team compressed into one expert proposal writer: bid director, sector technical lead, procurement compliance reviewer, evaluator, and persuasive senior writer. You have won competitive tenders for World Bank, UNDP, private-sector, and government clients. You think like the evaluator first and the writer second.

## YOUR TASK
Write a complete, winning-quality TECHNICAL PROPOSAL in markdown for the tender below. This is the final client submission document.

---

## STEP 1 — PRE-WRITING ANALYSIS (do this before writing a single word of the proposal)

Before writing, identify from the COMPANY EVIDENCE sections below:

**Strongest comparable projects (pick top 2):**
Scan the project evidence. Identify the two projects most directly comparable to this tender by sector, scope, and scale. Note their names, contract values, clients, countries, and exactly why each is relevant to THIS tender.

**Strongest proposed experts (pick top 2):**
Scan the expert evidence. Identify the two most relevant experts by discipline and comparable previous role. Note their names, titles, licences, and the specific previous project where they did comparable work.

**Top evaluation driver:**
What single criterion, if answered convincingly, wins this tender? (e.g., healthcare facility experience, team composition, technical methodology depth, donor compliance)

**Key differentiator:**
What one fact makes this firm clearly better than a generic competitor for this specific assignment?

Keep these four anchors in mind. They must appear — by name, value, and role — in: Cover Letter, Executive Summary, and Relevant Experience. This creates the "we have done this exact project before" narrative that wins competitive tenders.

---

## STEP 2 — WRITING QUALITY STANDARD

### EXAMPLES: Strong vs. Weak Proposal Writing

**WEAK (never write like this):**
> "Our company has extensive experience in healthcare facility design. We have successfully completed many hospital projects across the region. Our qualified team of professionals is ready to deliver quality results."

**STRONG (write like this):**
> "Hope Engineering's 2023 design of the St. Paul's Hospital Millennium Medical College specialist wing (ETB 312M, Addis Ababa) demonstrates our capacity for exactly this assignment — a multi-floor clinical facility with dedicated radiology, pharmacy, ICU, and full MEP integration, completed within a 14-month design programme. Dr. Almaz Tadesse (Lead Architect, EIASC Grade A), who led that project, is proposed as Principal Architect for this engagement. We are not learning on the client's time; we are repeating a proven delivery."

**WEAK:**
> "We are committed to delivering high-quality services that meet international standards and client expectations."

**STRONG:**
> "Our Quality Management Plan follows ISO 9001:2015 with four design-review gates — concept, schematic, detailed design, and pre-issue — each requiring sign-off from the Principal Architect and Technical Director before the next stage begins. On the Pharo Ethiopia Specialty Medical Center assignment, this staged process will catch clinical workflow conflicts and regulatory gaps before they reach the construction contractor."

**Rule:** Every paragraph must contain at least one specific, verifiable fact from the evidence — a project name, contract value, expert name + licence, or client reference. If no evidence exists, write a single "Bid-Team Action:" note and move on. Do not pad with vague language.

---

## STEP 3 — NON-NEGOTIABLE QUALITY RULES

1. **Evidence-first**: Every strong claim must cite a specific project name, ETB/contract value, expert name + licence, or client reference from the EVIDENCE sections. Never invent facts.
2. **Tender-specific structure**: Follow the exact sections required by the tender. Do not use a generic template.
3. **Client-value framing**: Every section must answer: "Why should we choose this firm over any other?" — answer with evidence, not intent.
4. **Expert-to-project mapping**: Each proposed expert must be linked to a specific previous comparable project and the role they performed on it. Produce a Team-to-Project table.
5. **Gap honesty**: Where evidence is missing, write one short "Bid-Team Action:" sentence. Do not pretend evidence exists.
6. **Financial rule**: ${noFinancial ? "TECHNICAL PROPOSAL ONLY — zero financial content. No rates, pricing, cost estimates, or financial offers anywhere in the document." : "Do not quote prices. Financial capacity statements (audited turnover, bank reference) are permitted if required by the evaluation criteria."}
7. **No AI traces**: Never write "As an AI", "Certainly!", "I cannot", "Please note", "[INSERT]", or any placeholder brackets.
8. **Narrative throughline**: The same two strongest project names MUST appear in the Cover Letter, Executive Summary, AND Section B. This is not optional.
9. **Proposal length and depth**: Write the full proposal. Do not truncate or summarise sections. Each section must be substantive — minimum 3 paragraphs for major sections.

---

## STEP 4 — FORBIDDEN PHRASES (auto-fail if present)
- "extensive experience" without a specific project name
- "committed to excellence / quality / delivering results"
- "leading firm in the region / country"
- "team of qualified professionals"
- "we look forward to the opportunity"
- "our company is pleased to submit"
- "we are confident that we can"
- Any text in [square brackets] as a placeholder
- Generic methodology steps like "Stage 1: Planning, Stage 2: Execution" without specific deliverables

---

## STEP 5 — TABLE FORMAT (use these exact Markdown table shapes)

Tables are mandatory for the sections marked TABLE below. Use standard Markdown table syntax. Cells must contain real, evidence-grounded values from the EVIDENCE sections — never placeholders.

**A.4 Proposed Project Team — TABLE (one row per expert):**
\`\`\`
| # | Expert & Position | Qualifications & Licenses | Comparable Sector Experience | Role on This Assignment |
|---|---|---|---|---|
| 1 | Eng. Ahmed Kebede, Project Principal | B.Sc. Civil (AAIT 2015), PPE Structural IPSTE/6884 valid 2030 | G+6 Hospital (ETB 550M); Eco-Park (ETB 27.5B WB ESF) | Project leadership, client liaison, final design sign-off |
| 2 | … | … | … | … |
\`\`\`

**A.5 Team-to-Project Experience Mapping — TABLE:**
\`\`\`
| Expert & Role on This Project | Role Previously Performed | Previous Comparable Project | Key Technical Contribution |
|---|---|---|---|
| Daniel Getachew, MEP Lead | Lead Electrical Engineer | Dr. Abdul Seid Hospital (ETB 550M) | Medical-grade power, UPS for life-critical loads, imaging room power |
\`\`\`

**B.2 / B.3 Featured Project Cards — TABLE per project (2-column metadata):**
\`\`\`
### G+6 General Hospital, Dr. Abdul Seid

| Field | Detail |
|---|---|
| Client | Gimba City Administration, South Wollo Zone |
| Location & Scale | South Wollo, Ethiopia — 7,000 m² built-up |
| Duration | 2015–2018 (Completed) |
| Contract Value | ETB 550,074,678 |
| Testimony Reference | Ref ጂ/ከ/መ/ል/1591/18, dated 19/01/2018 E.C. — Tariku Abebaw, Building Officer |
| Services Provided | Feasibility, geotechnical, full architectural/structural/MEP design, BOQ, supervision |
| Relevance to This Assignment | All six clinical departments required by this tender were included; same proposed team |
\`\`\`

**C.4 Three-Stage Quality Review — TABLE:**
\`\`\`
| Stage | Milestone | Review Authority and Required Action |
|---|---|---|
| Stage 1 | 30% Schematic Design | Senior Engineer + QA Manager. Sector-protocol gate-check. Written sign-off required. |
| Stage 2 | 60% Developed Design | Deputy GM. Regulatory pre-check. Written approval required. |
| Stage 3 | 100% Pre-Issue Final Package | General Manager / Principal. Final sign-off. All review comments resolved. |
\`\`\`

For any tender involving site selection, premises identification, beneficiary selection, or asset assessment, also include a **Weighted Assessment Matrix** table with columns: Criterion | Weight | What Is Evaluated. Each criterion gets a percentage weight totalling 100%.

**B.1 Client References — TABLE (place BEFORE B.2 Project Portfolio):**
\`\`\`
| Project / Client | Reference Contact & Title | Contact Details & Reference | Contract Value |
|---|---|---|---|
| G+6 Dr. Abdul Seid Hospital — Gimba City Administration | Tariku Abebaw, Building Officer | South Wollo, Ref ጂ/ከ/መ/ል/1591/18 dated 19/01/2018 E.C. | ETB 550,074,678 |
\`\`\`

**A.6 Specialist Engagement Plan — only emit when the tender requires a discipline NOT covered by the proposed core team (e.g., biomedical engineer, telecoms specialist, QHSE auditor):**
- One paragraph (50–80 words) on scope of services with named deliverables
- Bulleted **Integration Plan** with 4 timeline phases (assessment / design development / detailed design / commissioning)
- Closing sentence confirming requirements are embedded from schematic stage, not retrospectively

**D.1 Value Framework — TABLE (4–6 evaluator-facing benefit pillars):**
\`\`\`
## D.1 Value Framework — What [Client Name] Gains

| Framework Pillar | What This Engagement Delivers |
|---|---|
| Facility Intelligence | [Client] identifies the right premises with confidence. Weighted site assessment scores each shortlisted property against five sector-specific criteria. In-house geotechnical capability delivers subsurface findings within days, protecting acquisition timelines. |
| Workflow Engineering | Patients experience shorter waiting times and staff cover less unnecessary distance. … |
\`\`\`

**D.4 Declaration of Eligibility — formal language with named GM and license:**
"We, [Company], hereby declare that this Technical Proposal has been prepared specifically in response to [Tender Title] for [Client]. All information provided is accurate and supported by documentary evidence available on request. The firm meets all eligibility requirements stated in the tender …
Signed: [GM Name], License [License Number], on behalf of [Company]."

**Rule:** If you cannot fill a table cell from the EVIDENCE sections, write a single short "Bid-Team Action: confirm X before submission." cell — do NOT fabricate data and do NOT leave the cell empty.

---

## SUBMISSION DETAILS (embed in cover letter and cover page)
- Submit to emails: ${exactEmails || "see tender submission instructions"}
- Exact subject line: "${exactSubject}"
- Financial proposal excluded: ${noFinancial ? "YES — technical proposal only, confirmed" : "N/A"}

---

## MANDATORY PROPOSAL STRUCTURE
Write ALL of these in order:

### COVER LETTER
- Addressed to the client by name and position (if known)
- Subject line: exact tender reference and title
- **Opening paragraph (most important)**: cite the company's STRONGEST 1-2 specific projects comparable to this tender BY NAME and ETB/contract value — not generic capability statements
- Second paragraph: briefly introduce the proposed team lead(s) and their comparable previous role
- List the enclosed appendices by letter (Appendix A, B, C…)
- Confirm technical-only proposal if required
- Signed by the General Manager / Principal with name, title, and company

### COVER PAGE / TITLE PAGE
- Tender title and company name in bold
- Submitted to / Submitted by blocks
- Exact email recipients and subject line
- Submission date
- 3-5 headline facts drawn from the evidence library — number of comparable projects delivered, total portfolio value, team size/disciplines, key licence/certification held. Use sector-appropriate language: (e.g., ${coverPageExample})

### TABLE OF CONTENTS
- All sections with sub-sections and approximate structure

### EXECUTIVE SUMMARY (3-4 strong paragraphs, no bullet lists)
- Lead sentence: "We have already delivered this assignment. [Company] designed / supervised / assessed [Project Name] (ETB X, Client Y) — a [parallel description]. The same team is available for this engagement."
- Second paragraph: address the top evaluation criterion directly with evidence
- Third paragraph: explain the technical approach at a high level — why it is the right approach for this specific scope and client
- Fourth paragraph: confirm compliance, team availability, and commitment

${sectionStructureGuidance}

### SECTION A: COMPANY PROFILE
A.1 Company Background — founding year, licence grade, registered address, staff headcount, total projects completed, key sectors, certifications
A.2 Corporate Information Table — legal name | registration no. | TIN/VAT | address | GM name | email | phone | website
A.3 Core Service Lines — bulleted disciplines directly relevant to this tender (not a generic list)
A.4 Proposed Project Team — table: Expert Name | Discipline & Licence | Years' Experience | Role on This Assignment | Comparable Previous Project
A.5 Team-to-Project Experience Mapping — table: Expert & Proposed Role | Previous Comparable Project | Role Previously Performed | Key Technical Contribution
A.6 Specialist Engagement Plan — if the tender requires a specialist (e.g., biomedical engineer) not in the core team, name the planned specialist and their integration role

### SECTION B: RELEVANT EXPERIENCE
B.1 Portfolio Overview — total projects, total healthcare/relevant sector value, geographic spread
B.2 Featured Project 1 (most comparable) — Name | Client | Country | Value | Year | Scope | Services Provided | Why this directly demonstrates capacity for this tender | Client contact for reference
B.3 Featured Project 2 (second most comparable) — same structure
B.4 Additional Projects — concise table with Name | Client | Country | Value | Sector | Key Services
B.5 Client References — confirmed client names and, if available, contact details for reference letters

### SECTION C: TECHNICAL APPROACH
C.1 Understanding of the Assignment — what the client needs, what the key technical challenges are, and what the winning proposal must demonstrate
C.2 Technical Methodology — numbered sub-sections matching the tender's scope items
${allSectorGuidance}
C.3 Work Plan and Deliverables — stages, deliverables, responsible experts, timelines
C.4 Quality Assurance — staged design review gates, independent technical review, document control, submission quality control

### SECTION D: ADDITIONAL INFORMATION
D.1 Value to the Client — specific, evidence-backed value propositions for THIS client (not marketing boilerplate)
D.2 In-House Capabilities Beyond Minimum Scope — what additional value the firm brings without extra cost
D.3 Professional Certifications and Affiliations — list ISO, donor compliance records, professional body memberships with registration numbers
D.4 Declaration of Eligibility — formal statement confirming the firm meets all eligibility requirements stated in the tender

### SECTION E: COMPLIANCE MATRIX (mandatory — TABLE)
For EVERY mandatory and scored requirement listed in CONSOLIDATED REQUIREMENTS / TENDER TEXT, produce one row:

\`\`\`
| # | Requirement (verbatim or close paraphrase from tender) | Where Addressed in This Proposal (section + sub-section) | Supporting Evidence (project name / expert name / appendix letter) | Compliance Status |
|---|---|---|---|---|
| 1 | "Minimum 10 years' experience in healthcare facility design" | Section A.1 + B.2 | 12 years; G+6 Dr. Abdul Seid Hospital (ETB 550M, 2018) | FULLY MET |
| 2 | "Lead Architect must hold EIASC Grade A licence" | Section A.4 | Dr. Almaz Tadesse, EIASC Grade A IPSTE/6884 valid 2030 | FULLY MET |
| 3 | "Submit 3 client reference letters with seal" | Appendix D | Pharo Foundation, MoH, Gimba City Admin reference letters | PARTIALLY MET — Bid-Team Action: confirm Gimba seal before submission |
\`\`\`

Rules: every requirement gets one row. Compliance Status MUST be one of FULLY MET / PARTIALLY MET / NOT MET. Where NOT MET, the row must propose a credible mitigation in the same row (subcontractor, joint venture, deferred delivery, etc.). Do not silently skip a requirement — if you cannot map it, write a Bid-Team Action note.

### SECTION F: EVALUATION CRITERIA RESPONSE MIRROR (mandatory — TABLE)
The evaluator will score this proposal against the criteria listed in EVALUATION CRITERIA. For each criterion, mirror the criterion language back and point to where in the proposal it is answered:

\`\`\`
| Evaluation Criterion (echoed in tender language) | Weight (if stated) | Where This Proposal Answers It | Strongest Evidence Anchor |
|---|---|---|---|
| "Relevant healthcare facility experience" | 25% | Section B.2, B.3 + Cover Letter para 1 | G+6 Dr. Abdul Seid Hospital (ETB 550M, 2018) — same scope, same team |
| "Strength of proposed multidisciplinary team" | 20% | Section A.4, A.5 (Team-to-Project mapping) | 12-expert team incl. Dr. Almaz Tadesse, EIASC Grade A |
\`\`\`

If the tender lists weights, populate the Weight column verbatim. If weights are not stated, leave blank — do not invent. Mirroring criterion language back to the evaluator using their exact wording is a high-leverage scoring tactic and is non-optional.

### SECTION G: WIN THEMES & DISCRIMINATORS (mandatory — short narrative + TABLE)
A win theme is a defensible reason this firm wins this tender. A discriminator is a specific advantage we hold that competitors typically lack. Derive 3–5 themes from the COMPANY EVIDENCE — never invent.

Open with one paragraph (60–120 words) framing the firm's overall positioning for THIS tender. Then the table:

\`\`\`
| Win Theme | Discriminator (what we have, others typically don't) | Linked Evaluation Criterion | Evidence Anchor |
|---|---|---|---|
| Proven hospital delivery track record | 2 fully-completed G+6 hospitals delivered with same team available now | Relevant healthcare experience (25%) | Dr. Abdul Seid Hospital ETB 550M; St. Paul's specialist wing ETB 312M |
| In-house geotechnical capability | Owned drilling rig + licensed lab on staff (most peers subcontract) | Quality of methodology (15%) | 8 boreholes self-supervised on Eco-Park assignment 2022 |
\`\`\`

### SECTION H: PROPOSAL SELF-SCORE (mandatory — TABLE)
After completing all sections above, evaluate this proposal against the stated criteria as if you were the client's evaluation panel. Be honest — over-confident self-scores damage credibility.

\`\`\`
| Evaluation Criterion | Weight | Self-Score (0–10) | Rationale (1 short sentence with evidence) | Risk to Score / Mitigation |
|---|---|---|---|---|
| Relevant healthcare experience | 25% | 9 | Two named comparable hospitals (ETB 550M + ETB 312M) with same team | Mitigation: client letters in Appendix D confirm performance |
| Methodology depth | 20% | 8 | Section C.2 covers all 7 clinical zones + MEP integration | Risk: biomedical engineer named as engagement, not on staff |
| Financial capacity | 15% | 6 | Bid-Team Action: confirm latest audited turnover before submission | Mitigation: bank reference letter to be attached |
\`\`\`

End with: "Predicted overall technical score: X / 100. Top three risks to address before submission: 1. … 2. … 3. …"

### APPENDICES REGISTER
List appendices in the required format, e.g.:
- Appendix A: Company Registration Documents and Licences
- Appendix B: Audited Financial Statements
- Appendix C: Curricula Vitae of Proposed Experts
- Appendix D: Project References and Client Letters
- Appendix E: Project Photos, Drawings and Completion Evidence

---

## TENDER INFORMATION

TENDER TITLE: ${params.tenderTitle}
CLIENT: ${params.clientName}

TENDER TEXT / FULL SCOPE EXTRACT:
${params.tenderText.slice(0, 14_000)}

AI ANALYSIS SUMMARY:
${params.analysisSummary.slice(0, 4_000)}

EVALUATION CRITERIA — answer each one explicitly in the proposal:
${params.evaluationMethodology.slice(0, 5_500)}

SUBMISSION RULES:
${params.submissionNotes.slice(0, 3_000)}

CONSOLIDATED REQUIREMENTS:
${params.requirements.slice(0, 7_000)}

---

## COMPANY EVIDENCE — USE THIS, DO NOT INVENT ANYTHING

COMPANY PROFILE:
${params.companyProfile.slice(0, 5_000)}

PROPOSED EXPERT EVIDENCE:
${params.experts.slice(0, 6_000)}

RELEVANT PROJECT EVIDENCE:
${params.projects.slice(0, 6_000)}

COMPLIANCE / GAPS / BID-TEAM ACTIONS:
${params.compliance.slice(0, 5_000)}

KEY DIFFERENTIATORS TO WEAVE INTO THE NARRATIVE:
${params.differentiators}
${params.criterionEvidenceMap && params.criterionEvidenceMap.trim().length > 0
  ? `
---

## CRITERION-TO-EVIDENCE ALLOCATION (follow this exactly — allocate prose depth proportional to weight)
${params.criterionEvidenceMap}`
  : ""}
${params.doNotUseAsClient && params.doNotUseAsClient.length > 0
  ? `
---

## PREVIOUS CLIENTS — DO NOT USE AS THE CLIENT OF THIS TENDER
The following are clients from the firm's project history. They are NOT the client of this tender. Never address the Cover Letter or any section to these names:
${params.doNotUseAsClient.slice(0, 12).map((c) => `- ${c}`).join("\n")}`
  : ""}

---

Now write the complete technical proposal. Start with the Cover Letter. The evaluator must feel — after the first two pages — that this firm has already delivered this exact project and is simply repeating a proven capability.`;

  // Claude is the preferred provider when configured — the reference benchmark
  // is Claude-generated, so the prompt is tuned for Claude's strengths. Falls
  // back to Gemini when Claude fails or returns null. Falls back to the
  // deterministic engine path when both fail (handled in generateTenderDocuments).
  // The chosen provider is recorded in lastProposalProvider so callers can
  // surface "Claude" vs "Gemini" in the GeneratedDocument.contentSummary.
  let claudeError: string | null = null;
  if (isClaudeEnabled()) {
    try {
      // TENDER_TOOL_USE_GENERATION path: when params.toolUse is set,
      // route through the multi-turn tool-use loop so Claude can call
      // search_company_knowledge / inspect_expert / inspect_project
      // mid-write to verify evidence before making claims. Falls
      // back to the single-call path when tool-use returns null.
      if (params.toolUse) {
        const toolResult = await generateWithClaudeTools(
          prompt,
          DEFAULT_PROPOSAL_SYSTEM_PROMPT,
          params.toolUse.tools,
          params.toolUse.executor,
        );
        if (toolResult) {
          lastProposalProvider = "claude";
          return toolResult;
        }
        console.warn("[ai] tool-use generation returned null — falling back to single-call Claude path.");
      }
      const claudeResult = await generateWithClaude(prompt);
      if (claudeResult) {
        lastProposalProvider = "claude";
        return claudeResult;
      }
      claudeError = `all configured Claude models returned empty / not-found / rate-limited (chain: ${CLAUDE_PROPOSAL_MODELS.join(", ")}). Check ANTHROPIC_PROPOSAL_MODELS — model IDs must be lowercase with dashes (e.g. "claude-sonnet-4-5", NOT "Claude-sonnet-4.5")`;
    } catch (err) {
      claudeError = err instanceof Error ? err.message : String(err);
    }
  }
  if (apiKey) {
    try {
      const geminiResult = await generateWithBestModel(prompt);
      lastProposalProvider = "gemini";
      return geminiResult;
    } catch (geminiErr) {
      const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      console.warn(`[ai] Gemini failed for full proposal: ${geminiMsg} — trying OpenAI GPT-4o.`);
      // Fall through to OpenAI if available
      const openAiResult = await generateWithOpenAI(prompt).catch((e) => {
        console.warn(`[ai] OpenAI also failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (openAiResult) {
        lastProposalProvider = "openai";
        return openAiResult;
      }
      // DeepSeek as 4th tier
      const deepSeekResult = await generateWithDeepSeek(prompt).catch((e) => {
        console.warn(`[ai] DeepSeek also failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (deepSeekResult) {
        lastProposalProvider = "deepseek";
        return deepSeekResult;
      }
      // Groq → OpenRouter tail.
      const tail = await tryTailFallbackProviders(prompt);
      if (tail) { lastProposalProvider = tail.provider; return tail.text; }
      // Re-throw original Gemini error so callers surface the root cause
      throw geminiErr;
    }
  }

  // Neither Gemini nor Claude configured — try OpenAI as a standalone provider
  if (isOpenAIEnabled()) {
    const openAiResult = await generateWithOpenAI(prompt);
    if (openAiResult) {
      lastProposalProvider = "openai";
      return openAiResult;
    }
  }

  // DeepSeek as 4th-tier standalone provider
  if (isDeepSeekEnabled()) {
    const deepSeekResult = await generateWithDeepSeek(prompt).catch((e) => {
      console.warn(`[ai] DeepSeek standalone failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (deepSeekResult) {
      lastProposalProvider = "deepseek";
      return deepSeekResult;
    }
  }

  // Groq → OpenRouter standalone tail.
  const standaloneTail = await tryTailFallbackProviders(prompt);
  if (standaloneTail) { lastProposalProvider = standaloneTail.provider; return standaloneTail.text; }

  lastProposalProvider = null;
  // Diagnostic error message: distinguishes between (a) no key at all,
  // (b) Anthropic key present but Claude failed, (c) both configured but
  // both failed. Real-world deploy logs showed users with ANTHROPIC_API_KEY
  // set seeing the "No AI provider configured" message and assuming the
  // key wasn't loaded — when in fact the model name was wrong.
  if (anthropicApiKey && !apiKey) {
    const openAiNote = isOpenAIEnabled()
      ? ` OpenAI (${process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o"}) was also tried as fallback but returned null — check OPENAI_API_KEY and model access.`
      : " Set GEMINI_API_KEY or OPENAI_API_KEY as a fallback, OR fix the Claude model chain.";
    throw new Error(`Claude (Anthropic) is configured but did not produce a proposal: ${claudeError ?? "unknown error"}.${openAiNote}`);
  }
  if (!anthropicApiKey && !apiKey && isOpenAIEnabled()) {
    throw new Error(`OpenAI (${process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o"}) is configured but did not produce a proposal. Check that OPENAI_API_KEY is valid and the model is accessible on your account.`);
  }
  if (!anthropicApiKey && !apiKey) {
    throw new Error("No AI provider configured — set ANTHROPIC_API_KEY (preferred), GEMINI_API_KEY, or OPENAI_API_KEY in environment variables.");
  }
  // anthropicApiKey present, apiKey present, both failed
  throw new Error(`Both AI providers failed. Claude: ${claudeError ?? "unknown"}. Gemini also failed (see prior log lines).`);
}

// ─── Section-parallel proposal generation ────────────────────────────────────
//
// Replaces the single-call `generateBenchmarkProposalWithAI` with FOUR
// parallel Claude calls, each scoped to one logical proposal cluster.
// See lib/engine/proposal-sections.ts for the per-section system
// prompts, user prompts, and deterministic fallbacks.
//
// WHY THIS EXISTS — On Vercel Hobby (60s function cap), the single-call
// path frequently exceeded the budget because Claude needed 25–55s to
// emit ~8K output tokens AND 14K input tokens slowed time-to-first-token
// further. Section-parallel generation cuts wall time roughly in half by
// running 4 small calls concurrently, each with ~3K input tokens and
// ~1500–2800 output tokens.
//
// FAILURE ISOLATION — Each section call has its own timeout. If one
// section times out, the other three still ship; the failed section is
// substituted with a deterministic fallback (Bid-Team Action notes +
// table skeletons) so the downstream stitch + canonical-reorder + DOCX
// pipeline still produces a complete proposal. This is materially better
// than the single-call path, where any failure produced ZERO Claude
// output and dropped to the entirely-deterministic fallback.

import {
  buildProposalSectionSpecs,
  buildSectionCDrillDownSpec,
  buildSectionFallback,
  extractSectionCFromMarkdown,
  type ProposalSectionSpec,
  type ProposalSectionId,
} from "./engine/proposal-sections";

// Default per-section timeout. At Tier 2 with the slice budgets in
// proposal-sections.ts, each section typically completes in 12–25s.
// 30s gives headroom for occasional cold starts and TTFT variance while
// staying well inside the 50s in-pipeline budget that callers
// (generate-elite.ts, ai-proposal/route.ts) wrap around the whole
// generation. Override with PROPOSAL_SECTION_TIMEOUT_MS for higher tiers.
const PROPOSAL_SECTION_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PROPOSAL_SECTION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  return 30_000;
})();

interface SectionResult {
  id: ProposalSectionId;
  title: string;
  markdown: string;
  source: "claude" | "gemini" | "openai" | "deepseek" | "groq" | "openrouter" | "fallback";
  error?: string;
  durationMs: number;
}

async function generateOneSection(spec: ProposalSectionSpec): Promise<SectionResult> {
  const t0 = Date.now();

  // Per-section timeout factory — creates a FRESH promise each time so
  // that the Gemini fallback is not immediately rejected by an already-
  // settled timeout from a prior Claude attempt (a settled-rejected
  // promise in Promise.race resolves the race instantly).
  function makeSectionTimeout() {
    return new Promise<null>((_, reject) =>
      setTimeout(
        () => reject(new Error(`section "${spec.id}" timed out after ${Math.round(PROPOSAL_SECTION_TIMEOUT_MS / 1000)}s`)),
        PROPOSAL_SECTION_TIMEOUT_MS,
      )
    );
  }

  // Try Claude first (preferred provider — system prompts in
  // proposal-sections.ts are tuned for Claude personas).
  if (isClaudeEnabled()) {
    try {
      const claudeResult = await Promise.race([
        generateWithClaude(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens),
        makeSectionTimeout(),
      ]);
      if (claudeResult && claudeResult.trim().length > 0) {
        return {
          id: spec.id,
          title: spec.title,
          markdown: claudeResult,
          source: "claude",
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] section "${spec.id}" Claude failed (${msg}) — trying Gemini per-section fallback.`);
      // Fall through to Gemini if available; otherwise to deterministic.
      // We do NOT propagate the timeout to the caller — single-section
      // timeouts must NOT abort the parallel batch.
    }
  }

  // Gemini per-section fallback. generate-elite.ts and ai-proposal/route.ts
  // already use generateBenchmarkProposalWithAI's Gemini chain when Claude
  // is missing entirely; here we use it as a per-section recovery so a
  // single Claude section failure doesn't force the whole proposal back to
  // deterministic.
  if (apiKey) {
    try {
      // Prepend the section's system-prompt persona to the user prompt so
      // Gemini approximates the per-section role. Gemini doesn't have a
      // separate `system` channel for the SDK call we're using.
      const geminiPrompt = `${spec.systemPrompt}\n\n---\n\n${spec.userPrompt}`;
      const text = await Promise.race([
        generateWithBestModel(geminiPrompt),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        return {
          id: spec.id,
          title: spec.title,
          markdown: text,
          source: "gemini",
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] section "${spec.id}" Gemini fallback failed (${msg}) — using deterministic fallback for this section.`);
    }
  }

  // GPT-4o third-tier fallback — only when Claude and Gemini both failed.
  if (isOpenAIEnabled()) {
    try {
      // Use spec.systemPrompt as the system message so section-specific constraints
      // (persona, format, length) take precedence over the generic proposal persona.
      const text = await Promise.race([
        generateWithOpenAI(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        return {
          id: spec.id,
          title: spec.title,
          markdown: text,
          source: "openai",
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] section "${spec.id}" OpenAI fallback failed (${msg}) — using deterministic fallback.`);
    }
  }

  // DeepSeek fourth-tier fallback
  if (isDeepSeekEnabled()) {
    try {
      const text = await Promise.race([
        generateWithDeepSeek(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        return {
          id: spec.id,
          title: spec.title,
          markdown: text,
          source: "deepseek",
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] section "${spec.id}" DeepSeek fallback failed (${msg}) — using deterministic fallback.`);
    }
  }

  // Groq (5th) → OpenRouter (6th) section tail.
  try {
    const tail = await Promise.race([
      tryTailFallbackProviders(spec.userPrompt, spec.systemPrompt),
      makeSectionTimeout(),
    ]);
    if (tail && tail.text.trim().length > 0) {
      return { id: spec.id, title: spec.title, markdown: tail.text, source: tail.provider, durationMs: Date.now() - t0 };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ai] section "${spec.id}" Groq/OpenRouter fallback failed (${msg}) — using deterministic fallback.`);
  }

  // All providers failed (or unavailable). Use the deterministic
  // per-section fallback. The downstream pipeline's enrichers will
  // populate structured tables (Compliance Matrix, Evaluator Mirror,
  // Win Themes, Self-Score, Project Portfolio, etc.) so the section
  // is not empty even when the AI didn't produce prose.
  return {
    id: spec.id,
    title: spec.title,
    markdown: "[FALLBACK]", // sentinel — replaced below by buildSectionFallback at orchestrator
    source: "fallback",
    error: "all AI providers failed or unavailable for this section",
    durationMs: Date.now() - t0,
  };
}

/**
 * Section-parallel replacement for generateBenchmarkProposalWithAI.
 *
 * Runs 4 small Claude calls concurrently (one per logical section
 * cluster) and stitches the results into a single proposal markdown.
 *
 * Returns Promise<string> for drop-in compatibility with the existing
 * single-call signature. Diagnostic info goes to console.warn /
 * console.info and lastProposalProvider is set so callers can label
 * the proposal source on the GeneratedDocument record.
 *
 * On total failure (all four sections fail to produce AI prose), the
 * function still returns a complete deterministic-fallback markdown so
 * the calling route can write a proposal record. Callers that want to
 * detect "all sections fell back" can check lastProposalProvider —
 * it will be null in that case.
 */
export async function generateProposalSectionsParallel(input: AIBidWriterInput, sectionFilter?: ProposalSectionId[]): Promise<string> {
  const t0 = Date.now();

  // PROPOSAL_DEEP_MODE — opt-in "FULL POWER" mode. When enabled:
  //   • each per-section max_output_tokens roughly doubles, using the
  //     full Anthropic Tier 2+ output budget (16K tokens/min)
  //   • a CHAINED second call drills down on Section C to deepen the
  //     methodology sub-sections — net result: Section C gets ~2× the
  //     prose depth without making any single call long enough to
  //     trip Vercel's per-call timeout
  //
  // Recommended for Vercel Pro tiers (300s function timeout) AND
  // Anthropic Tier 2+ accounts. On Hobby (60s), deep mode still works
  // but cuts available headroom — set to true only after confirming
  // the parallel-section path is reliably finishing in <40s.
  //
  // Auto-activation: deep mode is enabled by default for Tier 2+ — the
  // drill-down add-on call (~10–12s serial) is well within the 220s
  // Tier 2 timeout and produces the biggest single quality lift.
  // Override: set PROPOSAL_DEEP_MODE=false to force off on any tier.
  const _tierForDeep = (process.env.ANTHROPIC_TIER || "").trim();
  const _tierNumForDeep = _tierForDeep === "1" ? 1 : _tierForDeep === "3" ? 3 : _tierForDeep === "4" ? 4 : 2;
  const deepMode = (process.env.PROPOSAL_DEEP_MODE || "").toLowerCase() === "false"
    ? false
    : true;

  // Chunked mode: when a sectionFilter is provided the caller is making
  // one of 3 sequential browser-side calls (each its own Vercel function
  // invocation with a fresh 60s window). Use larger per-section token
  // budgets and skip deep-mode drill-down — the extra first-pass tokens
  // (7,500 vs 4,500 for Section C on Tier 2) compensate for no drill-down.
  const isChunked = sectionFilter !== undefined && sectionFilter.length > 0;
  const specs = buildProposalSectionSpecs(input, { deep: isChunked ? false : deepMode, chunked: isChunked });
  const filteredSpecs = isChunked ? specs.filter((s) => sectionFilter.includes(s.id)) : specs;

  // generateOneSection never rejects — it catches all errors and returns
  // a "fallback" SectionResult. Promise.all is therefore safe here; the
  // comment "Promise.allSettled" in earlier drafts was stale.
  const results = await Promise.all(filteredSpecs.map(generateOneSection));

  // Build per-section markdown, substituting deterministic fallback for
  // any section whose source is "fallback".
  const sections = results.map((r, i) => {
    if (r.source === "fallback") {
      return {
        ...r,
        markdown: buildSectionFallback(filteredSpecs[i], input),
      };
    }
    return r;
  });

  // ─── Deep mode: Section C drill-down (chained second call) ───────────────
  //
  // After the first-pass produces a complete Section C, run a SECOND
  // Claude call asking the AI to deepen Section C's methodology
  // sub-sections — adding 2-3 paragraphs per scope item, naming
  // experts inline, citing previous projects when the methodology
  // element was demonstrated there. This is the chained-call pattern
  // the user asked for: when one call isn't enough, chain another.
  //
  // The drill-down REPLACES the first-pass Section C in the final
  // stitched proposal. Other sections are unchanged.
  //
  // Failure-isolated: if the drill-down fails (timeout, rate limit,
  // API error), we keep the first-pass Section C and log a warning.
  // No proposal is shipped with a broken Section C as a result.
  let drillDownInfo: string = "";
  if (deepMode && !isChunked) {
    const sectionCResult = sections.find((s) => s.id === "technical-approach");
    if (sectionCResult && sectionCResult.source !== "fallback") {
      const firstPassSectionC = sectionCResult.markdown;
      const drillSpec = buildSectionCDrillDownSpec(input, firstPassSectionC);
      const drillResult = await generateOneSection(drillSpec);
      if (drillResult.source !== "fallback") {
        // Replace the first-pass Section C in the sections array.
        const idx = sections.findIndex((s) => s.id === "technical-approach");
        if (idx >= 0) {
          sections[idx] = drillResult;
          drillDownInfo = ` [section-c-drilldown=${drillResult.source}(${Math.round(drillResult.durationMs / 100) / 10}s)]`;
        }
      } else {
        console.warn(`[ai] section-C drill-down failed (${drillResult.error ?? "unknown"}) — keeping first-pass Section C.`);
        drillDownInfo = ` [section-c-drilldown=skipped]`;
      }
    }
  }

  // Set lastProposalProvider to the dominant successful source. If
  // ANY section used Claude, label as Claude (Claude is the headline
  // provider). If all successful sections used Gemini, label as Gemini.
  // If every section fell back, set null so callers can see total AI
  // failure.
  const usedClaude = sections.some((s) => s.source === "claude");
  const usedGemini = sections.some((s) => s.source === "gemini");
  const usedOpenAI = sections.some((s) => s.source === "openai");
  const usedDeepSeek = sections.some((s) => s.source === "deepseek");
  const allFell = sections.every((s) => s.source === "fallback");
  if (allFell) {
    lastProposalProvider = null;
  } else if (usedClaude) {
    lastProposalProvider = "claude";
  } else if (usedGemini && !usedOpenAI && !usedDeepSeek) {
    lastProposalProvider = "gemini";
  } else if (usedOpenAI && !usedDeepSeek) {
    lastProposalProvider = "openai";
  } else if (usedDeepSeek) {
    lastProposalProvider = "deepseek";
  }

  // Diagnostic summary line — surfaces in Vercel runtime logs so
  // operators can see which sections completed via Claude vs Gemini vs
  // deterministic, and how long each took. This is the only feedback
  // signal once we're past the prompt-shrinking phase.
  const totalMs = Date.now() - t0;
  const summary = sections
    .map((s) => `${s.id}=${s.source}(${Math.round(s.durationMs / 100) / 10}s)`)
    .join(" ");
  const modeLabel = isChunked ? `chunked[${sectionFilter!.join(",")}]` : deepMode ? "deep" : "standard";
  console.info(`[ai] section-parallel generation (${modeLabel}) finished in ${Math.round(totalMs / 100) / 10}s — ${summary}${drillDownInfo}`);

  // Stitch in canonical order. Cover+Summary first, then A+B, then C,
  // then D+Appendices+Declaration. The downstream section-reorderer in
  // generate-elite.ts will further reorder based on rank if upstream
  // produced sections in a different order, but we ship them in the
  // right order here so the reorderer is a no-op in the happy path.
  return sections.map((s) => s.markdown.trim()).filter(Boolean).join("\n\n");

  // Suppress unused import warning — extractSectionCFromMarkdown is
  // exported for callers who want to peel Section C out of an
  // already-stitched proposal markdown (e.g., for ad-hoc deep refinement).
  void extractSectionCFromMarkdown;
}

function extractTenderSections(tenderText: string): string[] {
  const sectionPatterns = [
    /^(?:SECTION\s+[A-Z0-9]+|Section\s+[A-Z0-9]+)\s*[:\-–]\s*(.+)$/gm,
    /^([A-Z]\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Proposed Team|Financial Information|Methodology|Team Composition|Understanding of Assignment|Project Experience|Evaluation Criteria|Value[- ]Added)[^\n]*)$/gm,
    /^(\d+\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Executive Summary|Introduction|Methodology|Team|Understanding|Background|Evaluation)[^\n]*)$/gm,
    /^((?:Executive Summary|Company Profile|Proposed Team|Relevant Experience|Technical Approach|Additional Information|Compliance|Declaration)\b[^\n]{0,60})$/gm,
  ];
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const pattern of sectionPatterns) {
    for (const match of tenderText.matchAll(pattern)) {
      const label = (match[1] ?? match[0]).trim().slice(0, 80);
      if (label && !seen.has(label.toLowerCase()) && label.length > 4) {
        seen.add(label.toLowerCase());
        sections.push(label);
      }
    }
  }
  return sections.slice(0, 12);
}

// ─── Section-aware critical content extractor ────────────────────────────────
// Scans tender text for spans around evaluation/submission keywords and returns
// a compacted excerpt prefixed with "KEY SECTIONS:" so the AI prompt can focus
// on the most decision-relevant parts without ingesting irrelevant boilerplate.

const CRITICAL_KEYWORDS = [
  "evaluation", "scoring", "criteria", "submission", "deadline",
  "annex", "appendix", "form", "financial proposal", "technical proposal",
  "envelope", "email", "subject line", "bid bond", "eligibility", "qualification",
];
const SECTION_RADIUS = 500; // chars around each keyword match to include

export function extractCriticalSections(text: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const keyword of CRITICAL_KEYWORDS) {
    let idx = 0;
    while ((idx = lower.indexOf(keyword, idx)) !== -1) {
      spans.push([Math.max(0, idx - SECTION_RADIUS), Math.min(text.length, idx + keyword.length + SECTION_RADIUS)]);
      idx += keyword.length;
    }
  }
  if (spans.length === 0) return "";
  // Merge overlapping spans
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of spans) {
    if (merged.length > 0 && start <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
    } else {
      merged.push([start, end]);
    }
  }
  const excerpts = merged.map(([s, e]) => text.slice(s, e).trim()).filter(Boolean);
  return excerpts.length > 0 ? "KEY SECTIONS:\n\n" + excerpts.join("\n\n---\n\n") : "";
}
