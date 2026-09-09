import { logger } from "../observability";
import { generateWithFallback } from "../ai";
import { REMATCH_TIMEOUT_MS } from "../timeout-config";
import { estimateInputTokens } from "../ai-preflight";
import { resolveActiveModelProfile } from "../ai-model-profiles";
import type { AiProviderName } from "../ai-provider-registry";
import { CANONICAL_AI_PROVIDER_ORDER } from "../ai-provider-catalog.cjs";
import {
  capabilityOverlapScore,
  classifyUniversalTender,
  isUnsafeSectorMismatch,
  sectorOverlapScore,
  universalProfileSummary,
  type UniversalTenderProfile,
} from "./universal-tender-taxonomy";

/** Hard upper bound for one provider request. */
export const MAX_CANDIDATES_PER_MATCHER_BATCH = 20;

/**
 * DIRECTIVE 15: Adaptive batch size by provider. Groq returned HTTP 413 with
 * 20 candidates — the payload exceeded the provider's request size limit. This
 * function returns a smaller batch size for providers known to have tighter
 * TPM/context limits, and the default 20 for providers with generous limits.
 *
 * A 413 must trigger deterministic rebatching, not repeated identical calls.
 */
export function adaptiveBatchSize(provider: string | null | undefined, requirementLength: number, profileLength: number): number {
  const max = MAX_CANDIDATES_PER_MATCHER_BATCH;
  if (!provider) return max;
  // Estimate total payload size: candidates × (requirement + profile) chars.
  // If the estimate exceeds 100KB, reduce the batch size.
  const estimatedPayloadChars = max * (requirementLength + profileLength);
  if (estimatedPayloadChars > 200_000) return 5;   // Very large requirements → small batches
  if (estimatedPayloadChars > 100_000) return 10;   // Large requirements → medium batches
  // Provider-specific limits (Groq is known to 413 on large payloads)
  if (provider === "groq") return Math.min(10, max);
  return max;
}

/**
 * The largest batch whose prompt every provider in the chain can accept.
 *
 * WHY THIS IS MEASURED RATHER THAN CONFIGURED
 * -------------------------------------------
 * assessBatches used to slice by MAX_CANDIDATES_PER_MATCHER_BATCH (20) and
 * nothing else. Measured against the owner's real vault that produces:
 *
 *   PROJECT prompt  fixed 2,069 tok + 283 tok/candidate -> batch 20 = 8,416
 *   EXPERT  prompt  fixed 2,567 tok + 481 tok/candidate -> batch 20 = 10,665
 *
 * and Groq's configured budget is 7,088 input tokens — its gpt-oss free tier
 * allows 8,000 TPM, less the 512-token minimum useful response and the 5%
 * margin lib/ai-preflight.ts reserves. So EVERY matcher batch was rejected by
 * preflight before it was sent, on every tender, for a reason entirely inside
 * this repository. The live log records it as
 * "Prompt exceeds the configured provider throughput budget (7358 input
 * tokens)" and "(9097 input tokens)".
 *
 * adaptiveBatchSize() above was written for exactly this and returns 10 for
 * Groq, which measurement confirms fits. It has never been called: its only
 * importer is lib/liveness.ts, which reports `adaptiveBatchSizeAvailable: true`
 * — a probe asserting the function exists while the code path it was written
 * for ignored it. Its 100KB/200KB thresholds could not have helped either;
 * they never fire on a ~30KB payload.
 *
 * Sizing to the TIGHTEST budget in the chain, rather than to the first
 * provider's, is the point of having a chain: a batch must never fail merely
 * because provider N has a smaller window than provider 1. Providers with
 * larger budgets are unaffected — they simply receive a smaller prompt.
 *
 * Nothing here reorders the chain, changes a model identifier, alters what a
 * candidate contributes, or drops a candidate. The same candidates are
 * assessed with the same fields; only how many share one request changes.
 */
export function batchSizeForBudget(opts: {
  /** Tokens the prompt costs with zero candidates. */
  fixedTokens: number;
  /** Additional tokens one candidate costs. */
  perCandidateTokens: number;
  /** Smallest safe input budget across the configured chain. */
  budgetTokens: number;
  /** Upper bound, so a generous budget cannot produce an unbounded batch. */
  maxBatch?: number;
}): number {
  const max = opts.maxBatch ?? MAX_CANDIDATES_PER_MATCHER_BATCH;
  if (opts.perCandidateTokens <= 0) return max;
  const room = opts.budgetTokens - opts.fixedTokens;
  // A single candidate that cannot fit is still attempted alone: the chain's
  // larger-budget providers may serve it, and refusing to try would drop the
  // candidate from matching entirely.
  if (room <= 0) return 1;
  return Math.max(1, Math.min(max, Math.floor(room / opts.perCandidateTokens)));
}

/**
 * Smallest safe input budget across the configured provider chain.
 *
 * Read from the same model profiles preflight uses, so the batch size tracks a
 * model or TPM override instead of a constant written here.
 */
export function tightestChainInputBudget(env: NodeJS.ProcessEnv = process.env): number {
  let tightest = Number.POSITIVE_INFINITY;
  for (const provider of CANONICAL_AI_PROVIDER_ORDER as AiProviderName[]) {
    let profile;
    try {
      profile = resolveActiveModelProfile(provider, "proposal", env);
    } catch {
      continue;
    }
    const ceiling = profile.freeTierTpmLimit ?? profile.contextTokens;
    if (!Number.isFinite(ceiling) || ceiling <= 0) continue;
    // Mirror lib/ai-preflight.ts: a useful response and a 5% margin must fit
    // beside the input, or preflight rejects the request. Then keep operating
    // headroom below that, so an estimation error does not become a rejection.
    // The response reserve is NOT subtracted here any more. It scales with
    // batch size, so it is charged per candidate inside largestFittingBatch;
    // subtracting a flat 512 as well would reserve for the answer twice and
    // still be wrong for every batch larger than three candidates.
    const usable = Math.floor(
      (ceiling - Math.max(128, Math.ceil(ceiling * 0.05))) * (1 - BATCH_HEADROOM_FRACTION),
    );
    if (usable > 0) tightest = Math.min(tightest, usable);
  }
  return Number.isFinite(tightest) ? tightest : DEFAULT_BATCH_INPUT_BUDGET_TOKENS;
}

/** Mirrors MIN_USEFUL_OUTPUT_TOKENS in lib/ai-preflight.ts. */
const MIN_USEFUL_OUTPUT_TOKENS_FOR_BATCHING = 512;

/**
 * Output tokens one candidate's assessment costs in the response.
 *
 * The batch budget used to reserve a flat 512 output tokens however many
 * candidates it sent. But the response carries one object PER candidate, and
 * JSON_SHAPE requires each to hold candidateId, twelve perspective scores,
 * strength, concern and recommendSelection. Serialised, that object measures
 * 145 tokens compact and 161 pretty-printed, so a 13-candidate batch — exactly
 * what the input-only sizing produced — needs about 1,900 output tokens against
 * the 512 reserved.
 *
 * The provider is then asked for a response that cannot fit. Groq recorded the
 * outcome in production as `openai/gpt-oss-120b returned empty content`: a
 * reasoning model spends the short allowance on reasoning and emits nothing,
 * which costs a full attempt and reads like a provider fault rather than a
 * budget we set ourselves.
 *
 * 176 is the pretty-printed measurement plus ~10% slack, because a model may
 * indent more generously than JSON.stringify does.
 */
const RESPONSE_TOKENS_PER_CANDIDATE = 176;

/** Fixed response overhead beyond the per-candidate objects (brackets, commas). */
const RESPONSE_ENVELOPE_TOKENS = 16;

/**
 * Operating headroom below the provider's hard budget.
 *
 * Filling the budget exactly is not the objective — surviving it is. Token
 * estimation here is the same 4-chars-per-token heuristic preflight uses, which
 * under-counts dense text (tables, IDs, non-Latin script: this vault's project
 * records carry Amharic archive codes), and a provider's own tokenizer is the
 * one that decides. Fitting to the last token turns a small estimation error
 * into a rejected request.
 *
 * Measured without it, the worst project batch landed 4 tokens under a 7,270
 * budget. At 12% the same batches carry roughly 850 tokens of slack.
 */
const BATCH_HEADROOM_FRACTION = 0.12;
/** Used only when no provider profile resolves at all. */
const DEFAULT_BATCH_INPUT_BUDGET_TOKENS = 7_000;
const MAX_REQUIREMENT_CHARS = 8_000;
const MAX_METHODOLOGY_CHARS = 2_000;
const MAX_PROFILE_CHARS = 800;
// BLOCKER 11: Reduced from 3 to 1. Running multiple complete provider chains
// inside one worker request can consume the whole serverless invocation.
// One pass per batch — if it fails, the durable retry state machine re-arms
// the job for the next invocation instead of looping inline.
const MAX_FALLBACK_PASSES = 1;

export type MatchPerspective =
  | "DISCIPLINE_FIT"
  | "SCOPE_COVERAGE"
  | "SENIORITY_OR_SCALE"
  | "SECTOR_FIT"
  | "ROLE_RECENCY"
  | "EVIDENCE_QUALITY"
  | "COMPLIANCE_CRITICALITY"
  | "PORTFOLIO_CONTRIBUTION"
  | "MANDATORY_ELIGIBILITY"
  | "DELIVERY_RISK"
  | "DIFFERENTIATION"
  | "COMMERCIAL_VALUE";

export interface CandidateAssessment {
  candidateId: string;
  overallScore: number;
  perspectives: Record<MatchPerspective, number>;
  strength: string;
  concern: string;
  recommendSelection: boolean;
}

export interface MatchAssessmentBatch {
  category: "EXPERT" | "PROJECT";
  assessments: CandidateAssessment[];
  durationMs: number;
}

export const PERSPECTIVE_KEYS: MatchPerspective[] = [
  "DISCIPLINE_FIT",
  "SCOPE_COVERAGE",
  "SENIORITY_OR_SCALE",
  "SECTOR_FIT",
  "ROLE_RECENCY",
  "EVIDENCE_QUALITY",
  "COMPLIANCE_CRITICALITY",
  "PORTFOLIO_CONTRIBUTION",
  "MANDATORY_ELIGIBILITY",
  "DELIVERY_RISK",
  "DIFFERENTIATION",
  "COMMERCIAL_VALUE",
];

export interface ExpertCandidateInput {
  id: string;
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
  profile?: string | null;
  trustLevel?: string | null;
}

export interface ProjectCandidateInput {
  id: string;
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas: string[];
  summary?: string | null;
  contractValue?: number | null;
  currency?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  trustLevel?: string | null;
}

const PERSPECTIVE_WEIGHTS: Record<MatchPerspective, number> = {
  DISCIPLINE_FIT: 0.16,
  SCOPE_COVERAGE: 0.13,
  SENIORITY_OR_SCALE: 0.09,
  SECTOR_FIT: 0.11,
  ROLE_RECENCY: 0.08,
  EVIDENCE_QUALITY: 0.09,
  COMPLIANCE_CRITICALITY: 0.10,
  PORTFOLIO_CONTRIBUTION: 0.07,
  MANDATORY_ELIGIBILITY: 0.07,
  DELIVERY_RISK: 0.04,
  DIFFERENTIATION: 0.04,
  COMMERCIAL_VALUE: 0.02,
};

const PERSPECTIVE_SPEC = `Score each candidate 0-10 for: DISCIPLINE_FIT, SCOPE_COVERAGE, SENIORITY_OR_SCALE, SECTOR_FIT, ROLE_RECENCY, EVIDENCE_QUALITY, COMPLIANCE_CRITICALITY, PORTFOLIO_CONTRIBUTION, MANDATORY_ELIGIBILITY, DELIVERY_RISK (10 means low risk), DIFFERENTIATION, and COMMERCIAL_VALUE.`;

const JSON_SHAPE = `Return JSON array only. Each object must contain candidateId, perspectives with all twelve keys, strength, concern, and recommendSelection.`;

const SYSTEM_PROMPT = `You are a senior multidisciplinary tender evaluator. Use only supplied evidence. Never invent roles, clients, sectors, values, dates, certificates, or experience. Missing evidence scores 5 or lower and must be noted as INSUFFICIENT_INFO. Unsafe sector mismatches and mandatory-ineligible records must not be recommended. ${PERSPECTIVE_SPEC} ${JSON_SHAPE}`;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRematchTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`AI rematch timed out after ${Math.round(REMATCH_TIMEOUT_MS / 1000)}s`)),
          REMATCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * generateWithFallback has a per-request attempt budget. A second bounded pass
 * is required when that budget is consumed: providers attempted in pass one
 * enter cooldown, so the next pass advances to remaining configured providers.
 */
async function generateMatcherWithExpandedFallback(prompt: string): Promise<string> {
  const errors: string[] = [];
  for (let pass = 1; pass <= MAX_FALLBACK_PASSES; pass += 1) {
    try {
      return await withRematchTimeout(generateWithFallback(prompt, { systemPrompt: SYSTEM_PROMPT }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`pass ${pass}: ${message}`);
      const retryable = /ATTEMPT_BUDGET_EXHAUSTED|rate limit|429|413|timeout|timed out|fetch failed|network|cooldown/i.test(message);
      if (!retryable || pass === MAX_FALLBACK_PASSES) break;
      await sleep(250 * pass);
    }
  }
  throw new Error(`MATCHER_PROVIDER_FALLBACK_EXHAUSTED: ${errors.join(" | ").slice(0, 1_500)}`);
}

function tenderProfile(title: string, requirements: string, category?: string | null): UniversalTenderProfile {
  return classifyUniversalTender([title, category ?? "", requirements].join("\n"));
}

function expertText(candidate: ExpertCandidateInput): string {
  return [
    candidate.fullName,
    candidate.title,
    candidate.disciplines.join(" "),
    candidate.sectors.join(" "),
    candidate.certifications.join(" "),
    candidate.profile,
  ].filter(Boolean).join(" ");
}

function projectText(candidate: ProjectCandidateInput): string {
  return [
    candidate.name,
    candidate.clientName,
    candidate.country,
    candidate.sector,
    candidate.serviceAreas.join(" "),
    candidate.summary,
  ].filter(Boolean).join(" ");
}

export function buildExpertUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): string {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText);
  const candidates = opts.candidates.map((candidate) => {
    const profile = classifyUniversalTender(expertText(candidate));
    return [
      `id=${candidate.id}`,
      `name=${candidate.fullName}`,
      `title=${candidate.title ?? "unknown"}`,
      `years=${candidate.yearsExperience ?? "unknown"}`,
      `disciplines=${candidate.disciplines.join(", ") || "unknown"}`,
      `sectors=${candidate.sectors.join(", ") || "unknown"}`,
      `certifications=${candidate.certifications.join(", ") || "none"}`,
      `universalProfile=${universalProfileSummary(profile)}`,
      `profile=${(candidate.profile ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trust=${candidate.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `TENDER=${opts.tenderTitle}\nUNIVERSAL_PROFILE=${universalProfileSummary(required)}\nREQUIREMENTS:\n${opts.tenderRequirementsText.slice(0, 8_000)}\nMETHODOLOGY:\n${opts.evaluationMethodology.slice(0, MAX_METHODOLOGY_CHARS) || "not provided"}\nEXPERTS (${opts.candidates.length}):\n${candidates}`;
}

export function buildProjectUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): string {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText, opts.tenderCategory);
  const candidates = opts.candidates.map((candidate) => {
    const profile = classifyUniversalTender(projectText(candidate));
    const value = candidate.contractValue == null
      ? "unknown"
      : `${candidate.currency?.trim() || "currency unresolved"} ${candidate.contractValue}`;
    return [
      `id=${candidate.id}`,
      `name=${candidate.name}`,
      `client=${candidate.clientName ?? "unknown"}`,
      `country=${candidate.country ?? "unknown"}`,
      `sector=${candidate.sector ?? "unknown"}`,
      `services=${candidate.serviceAreas.join(", ") || "unknown"}`,
      `universalProfile=${universalProfileSummary(profile)}`,
      `value=${value}`,
      `period=${candidate.startDate ? new Date(candidate.startDate).getFullYear() : "?"}-${candidate.endDate ? new Date(candidate.endDate).getFullYear() : "ongoing"}`,
      `summary=${(candidate.summary ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trust=${candidate.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `TENDER=${opts.tenderTitle}\nCATEGORY=${opts.tenderCategory ?? "unknown"}\nUNIVERSAL_PROFILE=${universalProfileSummary(required)}\nREQUIREMENTS:\n${opts.tenderRequirementsText.slice(0, 8_000)}\nPROJECTS (${opts.candidates.length}):\n${candidates}`;
}

function balancedArrays(value: string): string[] {
  const out: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "[") { if (depth === 0) start = index; depth += 1; }
    if (char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(value.slice(start, index + 1)); start = -1; }
    }
  }
  return out;
}

function parseAssessmentArray(raw: string): Array<Record<string, unknown>> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned, ...balancedArrays(cleaned).sort((left, right) => right.length - left.length)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
      if (parsed && typeof parsed === "object") {
        for (const key of ["assessments", "results", "candidates", "items", "data"]) {
          const nested = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
        }
      }
    } catch {
      // Try next balanced candidate.
    }
  }
  return null;
}

function clampScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 5;
}

function legacyPerspectiveValue(values: Record<string, unknown>, key: MatchPerspective): unknown {
  if (key === "ROLE_RECENCY") return values.ROLE_RECENCY ?? values.RECENCY_OR_ROLE;
  if (key === "MANDATORY_ELIGIBILITY") return values.MANDATORY_ELIGIBILITY ?? values.COMPLIANCE_CRITICALITY;
  if (key === "DELIVERY_RISK") return values.DELIVERY_RISK ?? values.EVIDENCE_QUALITY;
  if (key === "DIFFERENTIATION") return values.DIFFERENTIATION ?? values.PORTFOLIO_CONTRIBUTION;
  if (key === "COMMERCIAL_VALUE") return values.COMMERCIAL_VALUE ?? values.SENIORITY_OR_SCALE;
  return values[key];
}

function computeOverallScore(perspectives: Record<MatchPerspective, number>): number {
  const weighted = PERSPECTIVE_KEYS.reduce(
    (total, key) => total + perspectives[key] * PERSPECTIVE_WEIGHTS[key],
    0,
  );
  const criticalFloor = Math.min(
    perspectives.DISCIPLINE_FIT,
    perspectives.SCOPE_COVERAGE,
    perspectives.EVIDENCE_QUALITY,
    perspectives.COMPLIANCE_CRITICALITY,
    perspectives.MANDATORY_ELIGIBILITY,
  );
  return Math.max(0, Math.min(1, weighted / 10 - (criticalFloor < 4 ? 0.07 : criticalFloor < 5 ? 0.035 : 0)));
}

function coerceAssessment(raw: Record<string, unknown>): CandidateAssessment | null {
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId : null;
  if (!candidateId) return null;
  const values = (raw.perspectives ?? {}) as Record<string, unknown>;
  const perspectives = Object.fromEntries(
    PERSPECTIVE_KEYS.map((key) => [key, clampScore(legacyPerspectiveValue(values, key))]),
  ) as Record<MatchPerspective, number>;
  const overallScore = computeOverallScore(perspectives);
  const criticalFloor = Math.min(
    perspectives.DISCIPLINE_FIT,
    perspectives.SCOPE_COVERAGE,
    perspectives.EVIDENCE_QUALITY,
    perspectives.COMPLIANCE_CRITICALITY,
    perspectives.MANDATORY_ELIGIBILITY,
  );
  return {
    candidateId,
    perspectives,
    overallScore,
    strength: typeof raw.strength === "string" ? raw.strength.slice(0, 360) : "",
    concern: typeof raw.concern === "string" ? raw.concern.slice(0, 360) : "",
    recommendSelection: raw.recommendSelection === true || (overallScore >= 0.60 && criticalFloor >= 3),
  };
}

function calibrate(
  required: UniversalTenderProfile,
  candidate: UniversalTenderProfile,
  assessment: CandidateAssessment,
): CandidateAssessment {
  const capability = capabilityOverlapScore(required.serviceCapabilities, candidate.serviceCapabilities);
  const sector = sectorOverlapScore(required.sectorDomains, candidate.sectorDomains);
  let perspectives = { ...assessment.perspectives };

  if (capability >= 0.5) {
    perspectives.DISCIPLINE_FIT = Math.max(perspectives.DISCIPLINE_FIT, Math.min(10, 6 + Math.round(capability * 4)));
    perspectives.SCOPE_COVERAGE = Math.max(perspectives.SCOPE_COVERAGE, Math.min(10, 6 + Math.round(capability * 4)));
    if (sector > 0) perspectives.SECTOR_FIT = Math.max(perspectives.SECTOR_FIT, Math.min(10, 6 + Math.round(sector * 4)));
  } else if (required.serviceCapabilities.length > 0) {
    perspectives.DISCIPLINE_FIT = Math.min(perspectives.DISCIPLINE_FIT, 5);
    perspectives.SCOPE_COVERAGE = Math.min(perspectives.SCOPE_COVERAGE, 5);
  }

  let concern = assessment.concern;
  let recommendSelection = assessment.recommendSelection;
  if (isUnsafeSectorMismatch(required, candidate)) {
    perspectives = {
      ...perspectives,
      DISCIPLINE_FIT: Math.min(perspectives.DISCIPLINE_FIT, 4),
      SCOPE_COVERAGE: Math.min(perspectives.SCOPE_COVERAGE, 4),
      SECTOR_FIT: Math.min(perspectives.SECTOR_FIT, 2),
      COMPLIANCE_CRITICALITY: Math.min(perspectives.COMPLIANCE_CRITICALITY, 4),
      MANDATORY_ELIGIBILITY: Math.min(perspectives.MANDATORY_ELIGIBILITY, 4),
      DELIVERY_RISK: Math.min(perspectives.DELIVERY_RISK, 3),
    };
    concern = `UNSAFE_SECTOR_MISMATCH: ${concern || "candidate sector and service capability do not support this tender"}`.slice(0, 360);
    recommendSelection = false;
  }

  const overallScore = computeOverallScore(perspectives);
  return { ...assessment, perspectives, overallScore, concern, recommendSelection };
}

/**
 * The longest prefix of `candidates` whose built prompt fits `budgetTokens`.
 *
 * Seeded from the caller's per-candidate estimate, then measured and shrunk,
 * because candidates are not uniform: one project summary can cost several
 * times another, and extrapolating from the first alone produced an
 * 18-candidate batch measuring 7,747 tokens against a 7,270 budget.
 *
 * Always returns at least one candidate. A single candidate too large for the
 * tightest provider is still attempted: the chain's larger-budget providers may
 * serve it, and refusing would drop it from matching altogether.
 */
/** Output tokens a response covering `size` candidates needs. */
export function expectedResponseTokens(size: number): number {
  return RESPONSE_ENVELOPE_TOKENS + (RESPONSE_TOKENS_PER_CANDIDATE * Math.max(0, size));
}

export function largestFittingBatch<T>(
  candidates: readonly T[],
  buildPrompt: (batch: T[]) => string,
  budgetTokens: number,
  estimate: { fixedTokens: number; perCandidateTokens: number },
): T[] {
  if (candidates.length === 0) return [];
  // The budget has to cover the answer as well as the question, and the answer
  // grows with the batch: every extra candidate adds both prompt tokens and a
  // response object. Charging both to each candidate keeps the seed honest, so
  // the shrink loop below starts near the answer instead of walking down from a
  // size that was never going to fit.
  let size = batchSizeForBudget({
    fixedTokens: estimate.fixedTokens + RESPONSE_ENVELOPE_TOKENS,
    perCandidateTokens: estimate.perCandidateTokens + RESPONSE_TOKENS_PER_CANDIDATE,
    budgetTokens,
    maxBatch: Math.min(MAX_CANDIDATES_PER_MATCHER_BATCH, candidates.length),
  });
  // Candidates are not uniform, so the estimate only seeds the guess: the built
  // prompt is measured and the batch shrunk until prompt AND response together
  // fit the budget.
  while (
    size > 1
    && estimateInputTokens(buildPrompt(candidates.slice(0, size) as T[])) + expectedResponseTokens(size) > budgetTokens
  ) {
    size -= 1;
  }
  return candidates.slice(0, Math.max(1, size)) as T[];
}

/**
 * Price a matcher batch against the budget the request will actually be judged
 * against.
 *
 * Two things were wrong before. The system prompt travels with every matcher
 * call and preflight counts it, but the sizing measured only the user prompt,
 * so every batch was priced ~191 tokens light. And only one of the three batch
 * drivers consulted a budget at all — aiRematchExperts and aiRematchProjects,
 * the two that the engine actually calls, sliced by a fixed 20 regardless of
 * what that produced. The live log recorded the result on the exact head:
 * "PROJECT batch failed ... groq: Prompt exceeds the configured provider
 * throughput budget (7358 input tokens)" and the same for EXPERT at 9,097,
 * against a 6,397-token budget.
 *
 * That is not only a lost re-rank. Groq's ceiling is a per-minute throughput
 * budget, so the oversized matcher calls that Groq refuses still leave the
 * section writers — which run seconds later in the same minute — colliding with
 * the same 8,000 TPM window, and they were answered 429 after the payload work
 * had already made them small enough to send.
 */
function matcherBatchSizing<T>(
  buildPrompt: (batch: T[]) => string,
  candidates: readonly T[],
): { budgetTokens: number; fixedTokens: number; perCandidateTokens: number } {
  // Everything below is measured in USER-prompt tokens, and the system prompt
  // is reserved out of the budget rather than added to each measurement. The
  // batch builder and the shrink loop both see the user prompt only, so keeping
  // one unit throughout is what makes the comparison mean what it says.
  const systemTokens = estimateInputTokens(SYSTEM_PROMPT);
  const budgetTokens = Math.max(1, tightestChainInputBudget() - systemTokens);
  const fixedTokens = estimateInputTokens(buildPrompt([]));
  const perCandidateTokens = Math.max(
    1,
    estimateInputTokens(buildPrompt(candidates.slice(0, 1) as T[])) - fixedTokens,
  );
  return { budgetTokens, fixedTokens, perCandidateTokens };
}

async function assessBatches<T>(
  category: "EXPERT" | "PROJECT",
  candidates: T[],
  buildPrompt: (batch: T[]) => string,
  calibrateCandidate: (candidate: T, assessment: CandidateAssessment) => CandidateAssessment,
): Promise<MatchAssessmentBatch | null> {
  if (candidates.length === 0) return null;
  const startedAt = Date.now();
  const assessments: CandidateAssessment[] = [];

  // Size the batch from the prompt this category actually produces, against the
  // tightest budget in the chain. Measured here rather than assumed: the same
  // builder that will send the request is used to price a zero-candidate and a
  // one-candidate prompt, so a change to any field a candidate contributes is
  // reflected without touching this code.
  const { budgetTokens, fixedTokens, perCandidateTokens } = matcherBatchSizing(buildPrompt, candidates);
  logger.info(
    `[ai-multi-perspective-matcher] ${category} batching: budget ${budgetTokens} tok, fixed ${fixedTokens} tok, `
    + `~${perCandidateTokens} tok/candidate, ${candidates.length} candidate(s).`,
  );

  let batchCount = 0;
  for (let index = 0; index < candidates.length; ) {
    // Candidates are not uniform — one project summary can cost several times
    // another — so the estimate only seeds the guess and the built prompt is
    // then measured and shrunk until it genuinely fits. Extrapolating from the
    // first candidate alone produced an 18-candidate project batch measuring
    // 7,747 tokens against a 7,270 budget.
    const batch = largestFittingBatch(candidates.slice(index), buildPrompt, budgetTokens, {
      fixedTokens,
      perCandidateTokens,
    });
    index += batch.length;
    batchCount += 1;
    try {
      const raw = await generateMatcherWithExpandedFallback(buildPrompt(batch));
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((candidate) => [(candidate as { id: string }).id, candidate]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) assessments.push(calibrateCandidate(candidate, assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] ${category} batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (assessments.length > 0) break;
      return null;
    }
  }

  return assessments.length > 0
    ? { category, assessments, durationMs: Date.now() - startedAt }
    : null;
}

export async function aiRematchExperts(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText);
  if (opts.candidates.length === 0) return null;
  const startedAt = Date.now();
  const allAssessments: CandidateAssessment[] = [];

  const buildExpertPrompt = (batch: ExpertCandidateInput[]) => buildExpertUserPrompt({ ...opts, candidates: batch });
  const expertSizing = matcherBatchSizing(buildExpertPrompt, opts.candidates);

  for (let i = 0; i < opts.candidates.length; ) {
    const batch = largestFittingBatch(
      opts.candidates.slice(i),
      buildExpertPrompt,
      expertSizing.budgetTokens,
      { fixedTokens: expertSizing.fixedTokens, perCandidateTokens: expertSizing.perCandidateTokens },
    );
    i += batch.length;
    try {
      const raw = await generateWithFallback(buildExpertPrompt(batch), { systemPrompt: SYSTEM_PROMPT });
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((c) => [c.id, c]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) allAssessments.push(calibrate(required, classifyUniversalTender(expertText(candidate)), assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] EXPERT batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (allAssessments.length > 0) break;
      return null;
    }
  }

  return allAssessments.length > 0
    ? { category: "EXPERT", assessments: allAssessments, durationMs: Date.now() - startedAt }
    : null;
}

export async function aiRematchProjects(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText, opts.tenderCategory);
  if (opts.candidates.length === 0) return null;
  const startedAt = Date.now();
  const allAssessments: CandidateAssessment[] = [];

  const buildProjectPrompt = (batch: ProjectCandidateInput[]) => buildProjectUserPrompt({ ...opts, candidates: batch });
  const projectSizing = matcherBatchSizing(buildProjectPrompt, opts.candidates);

  for (let i = 0; i < opts.candidates.length; ) {
    const batch = largestFittingBatch(
      opts.candidates.slice(i),
      buildProjectPrompt,
      projectSizing.budgetTokens,
      { fixedTokens: projectSizing.fixedTokens, perCandidateTokens: projectSizing.perCandidateTokens },
    );
    i += batch.length;
    try {
      const raw = await generateWithFallback(buildProjectPrompt(batch), { systemPrompt: SYSTEM_PROMPT });
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((c) => [c.id, c]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) allAssessments.push(calibrate(required, classifyUniversalTender(projectText(candidate)), assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] PROJECT batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (allAssessments.length > 0) break;
      return null;
    }
  }

  return allAssessments.length > 0
    ? { category: "PROJECT", assessments: allAssessments, durationMs: Date.now() - startedAt }
    : null;
}

export function formatAssessmentRationale(assessment: CandidateAssessment): string {
  const perspectives = assessment.perspectives;
  const breakdown = [
    `Discipline ${perspectives.DISCIPLINE_FIT}/10`,
    `Scope ${perspectives.SCOPE_COVERAGE}/10`,
    `Scale ${perspectives.SENIORITY_OR_SCALE}/10`,
    `Sector ${perspectives.SECTOR_FIT}/10`,
    `Role/Recency ${perspectives.ROLE_RECENCY}/10`,
    `Evidence ${perspectives.EVIDENCE_QUALITY}/10`,
    `Compliance ${perspectives.COMPLIANCE_CRITICALITY}/10`,
    `Portfolio ${perspectives.PORTFOLIO_CONTRIBUTION}/10`,
    `Eligibility ${perspectives.MANDATORY_ELIGIBILITY}/10`,
    `Low-risk delivery ${perspectives.DELIVERY_RISK}/10`,
    `Differentiation ${perspectives.DIFFERENTIATION}/10`,
    `Commercial value ${perspectives.COMMERCIAL_VALUE}/10`,
  ].join(", ");
  const parts = [`[AI Multi-Perspective v6 Bounded] Score ${Math.round(assessment.overallScore * 100)}% — ${breakdown}.`];
  if (assessment.strength) parts.push(`Strength: ${assessment.strength}`);
  if (assessment.concern) parts.push(`Concern: ${assessment.concern}`);
  if (assessment.recommendSelection) parts.push("Selected by bounded best-available portfolio evaluation.");
  return parts.join(" ");
}
