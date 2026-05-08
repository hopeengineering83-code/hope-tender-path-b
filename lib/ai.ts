// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

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
//     Paid tiers go much higher (Tier 2 = 16K output / minute).
//   - Vercel serverless function timeout caps wall-clock time.
//     Hobby = 60s, Pro = 300s. Claude's response time scales roughly
//     linearly with output token count — 8K tokens ≈ 25–40s, 16K ≈
//     60–120s. On Vercel Hobby, requesting 16K output reliably blows
//     the 60s budget and the function dies before Claude responds.
//
// Default is set to 8000 — a Hobby-tier-compatible value that still
// produces a comprehensive proposal (≈ 6,000 words) in time. The
// deterministic backstops (Sections E/F/G/H from PR #230 + #231)
// guarantee the four mandatory evaluator-facing tables are present
// even when Claude's output is tighter, so the trade-off has minimal
// quality impact.
//
// Operators on Vercel Pro (300s function timeout) can raise this to
// 16000 via the ANTHROPIC_MAX_OUTPUT_TOKENS env var. Operators on
// Anthropic Tier 3+ AND Vercel Enterprise could go higher still
// (capped at 64000 for safety).
const CLAUDE_MAX_OUTPUT_TOKENS = (() => {
  const raw = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 64000);
  return 8000;
})();

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName = DEFAULT_GEMINI_MODEL) {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey || anthropicApiKey);
}

export function isClaudeEnabled() {
  return Boolean(anthropicApiKey);
}

// Last AI provider that successfully produced a proposal output. Set inside
// generateBenchmarkProposalWithAI / refineProposalWithAI; read by callers
// (e.g., generate-elite.ts) so the GeneratedDocument.contentSummary can
// surface which provider was actually used (rather than a generic "AI"
// label). Reset to null whenever a generation request fails entirely.
type AIProvider = "claude" | "gemini" | null;
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

6. STRUCTURAL COMPLETENESS. You write the FULL proposal in one pass: Cover Letter, Cover Page, Table of Contents, Executive Summary, Section A (Company Profile), Section B (Relevant Experience), Section C (Technical Approach with sector-specific methodology), Section D (Additional Information), Compliance Matrix, Evaluation Self-Score, Appendices Register. You do not truncate, summarize, or stop early.

7. MARKDOWN RIGOR. Tables are real Markdown tables. Headings are real Markdown headings (#, ##, ###). No "[INSERT]" placeholders, no square-bracket TODOs, no AI-trace phrases ("As an AI…", "Certainly!", "I'd be happy to…", "Please note…"), no apologies, no preamble before the Cover Letter, no commentary after the proposal.

8. HONESTY ABOUT GAPS. If the COMPANY EVIDENCE genuinely does not support a claim, you write a single short "Bid-Team Action: confirm X before submission." note in place of the missing fact. You do NOT fabricate project names, contract values, license numbers, or client references.

You output the proposal directly. You never explain what you are about to do, never ask clarifying questions, never repeat the user's instructions back. You start with the Cover Letter.`;

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

6. EVIDENCE STAYS GROUNDED. If a paragraph needs an evidence anchor and the document does not contain a suitable one, write a single short "Bid-Team Action: confirm X before submission." note in place of the missing fact. Do NOT fabricate facts to fill gaps.

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
        if (text.length === 0) {
          attemptError = `${modelName}: empty response`;
          break; // empty response is not retryable
        }
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptError = `${modelName}: ${msg}`;
        // 401 / 403 — credentials are wrong, no point retrying or trying other models
        if (/401|403|invalid api key|authentication/i.test(msg)) {
          throw new Error(`Anthropic API key invalid — check ANTHROPIC_API_KEY in environment variables. (${msg})`);
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
    const claudeResult = await generateWithClaude(prompt, opts?.systemPrompt);
    if (claudeResult) return claudeResult;
    // Claude returned null (all models failed) — try Gemini if available.
    if (apiKey) return generate(prompt, opts?.geminiModel);
    throw new Error(`Claude returned empty / 404 / rate-limited on all models in chain (${CLAUDE_PROPOSAL_MODELS.join(", ")}) and GEMINI_API_KEY is not set. If ANTHROPIC_PROPOSAL_MODELS is set, model IDs must be lowercase with dashes (e.g. "claude-sonnet-4-5").`);
  }
  if (apiKey) return generate(prompt, opts?.geminiModel);
  throw new Error("No AI provider configured — set ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY.");
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
  try {
    return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
  } catch {
    const allMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
    for (const m of allMatches) {
      try { return JSON.parse(m[0]) as AIAnalysisResult; } catch { /* continue */ }
    }
    throw new Error(`AI returned malformed JSON for tender analysis${chunkLabel}`);
  }
}

export async function analyzeWithAI(tenderContent: string): Promise<AIAnalysisResult> {
  // For tenders within the soft limit, run a single call (faster path).
  // For larger tenders, chunk into overlapping pieces and analyze in
  // parallel — this is the multi-call chained analysis the user asked
  // for. Each chunk is independently analyzed; results merge below.
  const chunks = chunkTenderContent(tenderContent);
  if (chunks.length === 1) {
    return analyzeOneChunk(chunks[0], 0, 1);
  }

  console.info(`[ai] tender content is ${tenderContent.length.toLocaleString()} chars — chunking into ${chunks.length} parallel analysis calls.`);
  // Promise.allSettled — if a single chunk fails (e.g., one model
  // returned malformed JSON), the others still produce results we can
  // merge. We reject only if EVERY chunk failed.
  const settled = await Promise.allSettled(chunks.map((chunk, i) => analyzeOneChunk(chunk, i, chunks.length)));
  const successes = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const failures = settled.flatMap((s) => (s.status === "rejected" ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : []));
  if (successes.length === 0) {
    throw new Error(`All ${chunks.length} chunked analysis calls failed. Errors: ${failures.join(" | ")}`);
  }
  if (failures.length > 0) {
    console.warn(`[ai] ${failures.length} of ${chunks.length} chunks failed during analysis — merging the ${successes.length} that succeeded. Errors: ${failures.join(" | ")}`);
  }
  return mergeAnalysisResults(successes);
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
  "sectors": ["e.g. Healthcare, Government, Infrastructure"],
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
  "sector": "primary sector (Healthcare/Infrastructure/Government/Education/Industrial/Commercial) or null",
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
      const geminiResult = await withRefinementTimeout(generateWithBestModel(prompt));
      lastProposalProvider = "gemini";
      return geminiResult;
    }
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

  // Combine all active sector guidance blocks for injection into Section C
  const allSectorGuidance = [
    healthcareGuidance, facilityGuidance, waterGuidance, roadBridgeGuidance,
    buildingGuidance, urbanGuidance, environmentalGuidance, ictGuidance,
    donorGuidance, educationGuidance,
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
${params.evaluationMethodology.slice(0, 4_000)}

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
    const geminiResult = await generateWithBestModel(prompt);
    lastProposalProvider = "gemini";
    return geminiResult;
  }
  lastProposalProvider = null;
  // Diagnostic error message: distinguishes between (a) no key at all,
  // (b) Anthropic key present but Claude failed, (c) both configured but
  // both failed. Real-world deploy logs showed users with ANTHROPIC_API_KEY
  // set seeing the "No AI provider configured" message and assuming the
  // key wasn't loaded — when in fact the model name was wrong.
  if (anthropicApiKey && !apiKey) {
    throw new Error(`Claude (Anthropic) is configured but did not produce a proposal: ${claudeError ?? "unknown error"}. Set GEMINI_API_KEY as a fallback, OR fix the Claude model chain.`);
  }
  if (!anthropicApiKey && !apiKey) {
    throw new Error("No AI provider configured — set ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY in environment variables.");
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
  source: "claude" | "gemini" | "fallback";
  error?: string;
  durationMs: number;
}

async function generateOneSection(spec: ProposalSectionSpec): Promise<SectionResult> {
  const t0 = Date.now();

  // Per-section timeout — independent from the orchestrator's overall
  // timeout. If THIS section runs long, only THIS section falls back to
  // deterministic; the other parallel calls keep running.
  const sectionTimeout = new Promise<null>((_, reject) =>
    setTimeout(
      () => reject(new Error(`section "${spec.id}" timed out after ${Math.round(PROPOSAL_SECTION_TIMEOUT_MS / 1000)}s`)),
      PROPOSAL_SECTION_TIMEOUT_MS,
    ),
  );

  // Try Claude first (preferred provider — system prompts in
  // proposal-sections.ts are tuned for Claude personas).
  if (isClaudeEnabled()) {
    try {
      const claudeResult = await Promise.race([
        generateWithClaude(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens),
        sectionTimeout,
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
        sectionTimeout,
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

  // Both providers failed (or unavailable). Use the deterministic
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
export async function generateProposalSectionsParallel(input: AIBidWriterInput): Promise<string> {
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
  const deepMode = (process.env.PROPOSAL_DEEP_MODE || "").toLowerCase() === "true";

  const specs = buildProposalSectionSpecs(input, { deep: deepMode });

  // Promise.allSettled — we never reject the whole batch even if every
  // section fails, because we want a shippable markdown either way.
  const results = await Promise.all(specs.map(generateOneSection));

  // Build per-section markdown, substituting deterministic fallback for
  // any section whose source is "fallback".
  const sections = results.map((r, i) => {
    if (r.source === "fallback") {
      return {
        ...r,
        markdown: buildSectionFallback(specs[i], input),
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
  if (deepMode) {
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
  const allFell = sections.every((s) => s.source === "fallback");
  if (allFell) {
    lastProposalProvider = null;
  } else if (usedClaude) {
    lastProposalProvider = "claude";
  } else if (usedGemini) {
    lastProposalProvider = "gemini";
  }

  // Diagnostic summary line — surfaces in Vercel runtime logs so
  // operators can see which sections completed via Claude vs Gemini vs
  // deterministic, and how long each took. This is the only feedback
  // signal once we're past the prompt-shrinking phase.
  const totalMs = Date.now() - t0;
  const summary = sections
    .map((s) => `${s.id}=${s.source}(${Math.round(s.durationMs / 100) / 10}s)`)
    .join(" ");
  const modeLabel = deepMode ? "deep" : "standard";
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

