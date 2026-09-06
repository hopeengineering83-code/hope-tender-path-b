// ─── Live provider capability testing ────────────────────────────────────────
//
// Answers the only question that matters before AI Analyze runs: can THIS
// provider, with THIS model, actually do the work?
//
// Three things make this a real answer rather than the ping it replaces.
//
// 1. IT USES THE RUNTIME ADAPTER. Every request goes through callProvider() in
//    lib/ai.ts — the same function AI Analyze and proposal generation call, with
//    the same model resolution, request shape, token caps and timeouts. The
//    previous diagnostic built its own fetch calls with its own model defaults
//    (Gemini via `process.env.GEMINI_MODEL || "gemini-2.5-flash"`, Anthropic via
//    a hardcoded haiku alias), so it could report a provider healthy on a model
//    the workload never touches. Nothing forced the two to agree, and they
//    didn't.
//
// 2. IT TESTS THE CAPABILITY, NOT THE CONNECTION. Connectivity proves the key
//    and the route. The analysis test requires a real structured-JSON extraction
//    with the fields the workflow depends on; the generation test requires real
//    prose. A provider is only "usable for AI Analyze" once the ANALYSIS test
//    passes — passing connectivity alone is explicitly not enough.
//
// 3. IT CANNOT POISON ROUTING. Every call runs inside runAsDiagnostic(), so
//    outcomes are captured for the report instead of being written to the health
//    state that governs provider selection. One exception, and it is deliberate:
//    a BILLING result is promoted into the workload path, because acting on
//    "this provider wants money" prevents a charge rather than causing an outage.
//
// Model identity is DISCOVERED, not asserted. listAccountModels() asks the
// provider which models this account may call, and the resolved model is checked
// against that list before anything is sent. A local list of a third party's
// model names is a second authority on a question only they can answer, and it
// goes stale the moment they retire a snapshot.

import {
  getProviderEntry,
  getProviderBaseUrl,
  getProviderModel,
  readProviderKey,
  providerAutomaticEligibility,
  getAutomaticProviderOrder,
  type AiProviderName,
  type AiUseCase,
} from "./ai-provider-registry";
import {
  recordDiagnosticObservation,
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderSuccess,
  isBillingLockedOut,
} from "./ai-provider-health";
import { classifyProviderError, isBillingBlocked, type AiProviderFailureCategory } from "./ai-provider-classification";
import { redactSecrets } from "./sanitize-error";

export type CapabilityName = "connectivity" | "analysis" | "generation";
type EffectiveModelUseCase = "proposal" | "extraction" | "fast";

export type CapabilityTestResult = {
  provider: AiProviderName;
  capability: CapabilityName;
  /**
   * "skipped"    — deliberately not contacted (ineligible, cooling down, no model).
   * "not_tested" — WOULD have been contacted, but the request deadline arrived
   *                first. It is not a verdict on the provider and must never be
   *                rendered as one.
   */
  status: "ok" | "failed" | "skipped" | "not_tested";
  /** The EXACT model used — resolved through the same accessor the adapter uses. */
  model: string | null;
  /** Whether the provider's own model list confirms the account can call it. */
  modelConfirmedByProvider: boolean | null;
  durationMs: number;
  category: AiProviderFailureCategory | null;
  safeMessage: string | null;
};

export type ProviderCapabilityReport = {
  provider: AiProviderName;
  displayName: string;
  rank: number;
  access: string;
  /** In the active automatic chain and permitted to be contacted. */
  eligible: boolean;
  eligibilityReason: string;
  results: CapabilityTestResult[];
  /** True ONLY when the analysis capability test passed. */
  usableForAiAnalyze: boolean;
  usableForGeneration: boolean;
  availableModels: string[] | null;
  /** Exact per-capability resolutions; analysis remains `resolvedModel` for compatibility. */
  resolvedModels: Record<EffectiveModelUseCase, string | null>;
  resolvedModel: string | null;
  /** Orthogonal configuration facts; none is inferred from another. */
  keyPresent: boolean;
  configuredModels: Record<EffectiveModelUseCase, string | null>;
  modelConfigured: boolean;
  modelVisible: boolean | null;
  diagnosticState:
    | "KEY_MISSING" | "CONFIGURATION_INVALID"
    | "MODEL_UNAVAILABLE" | "BILLING_BLOCKED" | "RATE_LIMITED"
    | "CONNECTIVITY_VERIFIED" | "ANALYSIS_VERIFIED" | "GENERATION_VERIFIED"
    // Nothing was measured for this provider because the request ran out of
    // time. Distinct from CONFIGURED, which means "contacted, nothing proven".
    | "NOT_TESTED"
    | "CONFIGURED";
};

function configuredModelFacts(provider: AiProviderName, env: NodeJS.ProcessEnv) {
  const configuredModels = {
    proposal: getProviderModel(provider, "proposal", env) || null,
    extraction: getProviderModel(provider, "extraction", env) || null,
    fast: getProviderModel(provider, "fast", env) || null,
  } satisfies Record<EffectiveModelUseCase, string | null>;
  return {
    keyPresent: Boolean(readProviderKey(provider, env)),
    configuredModels,
    modelConfigured: Object.values(configuredModels).every(Boolean),
  };
}

function safeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return redactSecrets(raw).replace(/\s+/g, " ").trim().slice(0, 300);
}

// ─── Request-bounded diagnostics ─────────────────────────────────────────────
//
// This chain drives up to ten REAL provider round-trips, serially, inside a
// serverless route with a hard execution limit. Nothing bounded it to that
// limit: the loop simply ran until the platform killed the worker, which
// returns a 504 with no body — so an operator who ran the diagnostic to find
// out why AI Analyze was failing learned nothing at all, including nothing
// about the providers that HAD already answered before the axe fell.
//
// The fix is one absolute deadline for the whole request, checked before each
// provider is started and carried into the adapters so an in-flight socket is
// cancelled on the request's clock rather than its own static timeout. When the
// budget runs out the chain stops cooperatively and returns what it actually
// measured, plus the explicit list of providers it never contacted.
//
// Deliberately NOT done here:
//   - No parallel burst to beat the clock. These are real provider requests and
//     firing ten at once trips the very rate limits the test measures.
//   - No resume cursor. The route already accepts a single `provider`, so an
//     operator continues by re-testing the named untested providers — which
//     also guarantees no provider is attempted twice for one answer.

/**
 * Wall-clock a provider test needs before starting it is worth anything. Below
 * this, the request would only buy a TIMEOUT that says nothing about the
 * provider, so the provider is reported untested instead.
 */
export const MIN_PROVIDER_TEST_BUDGET_MS = 4_000;

/**
 * Reserved at the tail of the route's execution limit for summarising, writing
 * the audit record and serialising the response — the work that turns a killed
 * worker into a useful partial answer.
 */
export const DIAGNOSTIC_RESPONSE_RESERVE_MS = 8_000;

/**
 * Absolute deadline for a diagnostic request, derived from the route's own
 * `maxDuration` so the two cannot drift apart.
 */
export function diagnosticDeadlineFrom(maxDurationSeconds: number, startedAt: number = Date.now()): number {
  const budget = maxDurationSeconds * 1_000 - DIAGNOSTIC_RESPONSE_RESERVE_MS;
  return startedAt + Math.max(MIN_PROVIDER_TEST_BUDGET_MS, budget);
}

/** Time left before `deadlineAt`; Infinity when no deadline is armed. */
function remainingMs(deadlineAt: number | undefined, now: number = Date.now()): number {
  return typeof deadlineAt === "number" && Number.isFinite(deadlineAt) ? deadlineAt - now : Infinity;
}

/** True when there is not enough budget left to learn anything from a request. */
function outOfBudget(deadlineAt: number | undefined, now: number = Date.now()): boolean {
  return remainingMs(deadlineAt, now) < MIN_PROVIDER_TEST_BUDGET_MS;
}

const DEADLINE_REACHED_MESSAGE =
  "Not tested — the diagnostic reached its request time limit before this provider was contacted. This is not a provider result; re-run the test for this provider on its own.";

function notTestedResult(provider: AiProviderName, capability: CapabilityName): CapabilityTestResult {
  return {
    provider,
    capability,
    status: "not_tested",
    model: null,
    modelConfirmedByProvider: null,
    durationMs: 0,
    category: null,
    safeMessage: DEADLINE_REACHED_MESSAGE,
  };
}

// ─── Live model discovery ────────────────────────────────────────────────────

const MODEL_LIST_TIMEOUT_MS = 12_000;

/**
 * Ask the provider which models this account may call.
 *
 * Returns null when the provider exposes no listable endpoint (Anthropic) or the
 * request fails — null means "unknown", never "none", so an unreachable listing
 * endpoint can never be read as "this model does not exist".
 */
export async function listAccountModels(
  provider: AiProviderName,
  env: NodeJS.ProcessEnv = process.env,
  deadlineAt?: number,
): Promise<string[] | null> {
  const entry = getProviderEntry(provider);
  if (!entry.modelsEndpoint) return null;
  const key = readProviderKey(provider, env);
  if (!key) return null;

  // Model discovery is a real network call too, and ten of them at the static
  // timeout would exhaust the route's budget before a single capability was
  // tested. Clamp it to whatever the request actually has left.
  const timeoutMs = Math.max(
    1_000,
    Math.min(MODEL_LIST_TIMEOUT_MS, remainingMs(deadlineAt)),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (provider === "gemini") {
      // Key travels in the x-goog-api-key HEADER, not the `?key=` query
      // parameter Google also accepts. Both authenticate identically, but a
      // credential in a URL is a credential in every error string, log line,
      // proxy access record and browser referrer that URL ever touches — and
      // fetch failures routinely quote the URL they attempted. The header form
      // removes the exposure rather than relying on a redactor to catch it.
      // Response returns `models[].name` as "models/<id>".
      const res = await fetch(
        `https://generativelanguage.googleapis.com${entry.modelsEndpoint}?pageSize=200`,
        { headers: { "x-goog-api-key": key }, signal: controller.signal },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      return (data.models ?? [])
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter(Boolean);
    }

    const baseUrl = getProviderBaseUrl(provider, env);
    if (!baseUrl) return null;
    const res = await fetch(`${baseUrl}${entry.modelsEndpoint}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ResolvedModel = {
  model: string | null;
  /**
   * true  — the provider's list contains it.
   * false — the provider's list does not contain it (it will 404).
   * null  — the list could not be obtained, so this is unverified.
   */
  confirmedByProvider: boolean | null;
  source: "configured" | "free-tier-preference" | "no-proven-free-model";
};

/**
 * Resolve the model to use, preferring what is CONFIGURED, then the app-owned
 * free-tier preference policy when the provider confirms that exact model.
 *
 * The preference list is a set of hints checked against the live listing — never
 * an assertion that a name exists. An arbitrary provider listing is never a
 * pricing authority and is therefore never selected as a fallback.
 */
export async function resolveVerifiedModel(
  provider: AiProviderName,
  useCase: AiUseCase = "extraction",
  availableModels?: string[] | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedModel> {
  const entry = getProviderEntry(provider);
  const configured = getProviderModel(provider, useCase, env);
  const models = availableModels === undefined ? await listAccountModels(provider, env) : availableModels;

  if (models === null) {
    return { model: configured, confirmedByProvider: null, source: "configured" };
  }
  const listed = new Set(models);
  if (listed.has(configured)) {
    return { model: configured, confirmedByProvider: true, source: "configured" };
  }
  return { model: configured, confirmedByProvider: false, source: "configured" };
}

// ─── Capability probes ───────────────────────────────────────────────────────

const CONNECTIVITY_PROMPT = "Reply with the single word: OK";

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

const ANALYSIS_PROMPT = `Analyze the following synthetic tender text and return a JSON object with:
- tenderType (e.g. RFP, EOI)
- oneRequirement (an object with title, description, requirementType, priority, sourcePage, sourceQuote)
- submissionInstruction (string)

Synthetic Tender Text:
${SYNTHETIC_TENDER_TEXT}

Respond ONLY with valid JSON.`;

const GENERATION_PROMPT =
  "Write a two-paragraph professional introduction for a proposal responding to the Alpha Bridge Construction project. Mention twenty-five years of experience.";

/**
 * Validate that an analysis response really carries the structure AI Analyze
 * depends on. Anything less is a failure: a provider that returns prose where
 * JSON was demanded cannot serve the workflow, and calling it healthy is what
 * made diagnostics and runtime disagree.
 */
function assertAnalysisShape(text: string): void {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Invalid JSON in response: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const field of ["tenderType", "oneRequirement", "submissionInstruction"]) {
    if (parsed[field] === undefined) throw new Error(`Structured output missing required field: ${field}`);
  }
  const requirement = parsed.oneRequirement;
  if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
    throw new Error("Structured output missing required field: oneRequirement must be an object");
  }
  for (const field of ["title", "description", "requirementType", "priority", "sourcePage", "sourceQuote"]) {
    if ((requirement as Record<string, unknown>)[field] === undefined) {
      throw new Error(`Structured output missing required field: oneRequirement.${field}`);
    }
  }
}

const CAPABILITY_SPEC: Record<CapabilityName, { prompt: string; useCase: AiUseCase; validate?: (text: string) => void }> = {
  connectivity: { prompt: CONNECTIVITY_PROMPT, useCase: "fast" },
  analysis: { prompt: ANALYSIS_PROMPT, useCase: "extraction", validate: assertAnalysisShape },
  generation: { prompt: GENERATION_PROMPT, useCase: "proposal" },
};

/**
 * Run ONE capability test against ONE provider, through the real adapter, with
 * the routing health state left untouched.
 */
export async function runCapabilityTest(
  provider: AiProviderName,
  capability: CapabilityName,
  opts?: {
    model?: string;
    modelConfirmedByProvider?: boolean | null;
    env?: NodeJS.ProcessEnv;
    /** Absolute epoch-ms deadline for the whole request. */
    deadlineAt?: number;
  },
): Promise<CapabilityTestResult> {
  const env = opts?.env ?? process.env;
  const spec = CAPABILITY_SPEC[capability];
  const eligibility = providerAutomaticEligibility(provider, env);

  // Before eligibility, before the key read, before anything: if the request has
  // no budget left, say so honestly rather than starting a call whose only
  // possible outcome is a TIMEOUT that would be blamed on the provider.
  if (outOfBudget(opts?.deadlineAt)) return notTestedResult(provider, capability);

  // Refuse before any request is built. An ineligible provider is not "failing"
  // — it is deliberately not being asked, and asking it is the thing that could
  // cost money. Testing it would defeat the point of excluding it.
  if (!eligibility.eligible) {
    return {
      provider,
      capability,
      status: "skipped",
      model: null,
      modelConfirmedByProvider: null,
      durationMs: 0,
      category: null,
      safeMessage: eligibility.safeMessage,
    };
  }
  if (isBillingLockedOut(provider)) {
    return {
      provider,
      capability,
      status: "skipped",
      model: null,
      modelConfirmedByProvider: null,
      durationMs: 0,
      category: "BILLING",
      safeMessage: "Provider refused payment recently and is cooling down; it will be retried when the cooldown expires.",
    };
  }

  const model = opts?.model ?? getProviderModel(provider, spec.useCase, env);
  if (!model) {
    return {
      provider, capability, status: "skipped", model: null,
      modelConfirmedByProvider: opts?.modelConfirmedByProvider ?? null,
      durationMs: 0, category: "CONFIGURATION_INVALID",
      safeMessage: "No effective configured model is available; provider was not contacted.",
    };
  }
  const startedAt = Date.now();

  // Imported lazily: lib/ai.ts is a large module and pulling it in at load time
  // would drag the whole generation stack into anything that merely wants the
  // capability types.
  const { callProvider, runAsDiagnostic, withProviderDeadline } = await import("./ai");

  let text: string | null = null;
  let thrown: unknown = null;
  // withProviderDeadline binds the request deadline to the async context the
  // adapters read, so every existing AbortController fires at
  // min(staticProviderTimeout, timeLeftInThisRequest). Without it the pre-flight
  // check above only decides whether to START a call — a call begun with 6s left
  // could still hold its socket for a 28s static timeout and be killed mid-write.
  const { capture } = await withProviderDeadline(opts?.deadlineAt, () => runAsDiagnostic(async () => {
    try {
      text = await callProvider(provider, spec.prompt, {
        useCase: spec.useCase,
        modelOverride: model,
      });
    } catch (err) {
      thrown = err;
    }
    return null;
  }));

  const durationMs = Date.now() - startedAt;
  const record = (status: "ok" | "failed", category: AiProviderFailureCategory | null, message: string | null) => {
    recordDiagnosticObservation({
      provider,
      capability,
      ok: status === "ok",
      category,
      safeMessage: message,
      model,
      latencyMs: durationMs,
    });
    return {
      provider,
      capability,
      status,
      model,
      modelConfirmedByProvider: opts?.modelConfirmedByProvider ?? null,
      durationMs,
      category,
      safeMessage: message,
    } satisfies CapabilityTestResult;
  };

  const failure = thrown ?? capture.error;
  if (failure) {
    return record("failed", classifyProviderError(failure), safeMessage(failure));
  }
  if (!text || String(text).trim().length === 0) {
    const category = (capture.category as AiProviderFailureCategory | null) ?? "MALFORMED_RESPONSE";
    return record("failed", category, "Provider returned an empty response.");
  }

  if (spec.validate) {
    try {
      spec.validate(text);
    } catch (err) {
      return record("failed", "MALFORMED_RESPONSE", safeMessage(err));
    }
  }

  // The one crossing back into workload state: a capability PROVEN by a real
  // call is exactly the evidence deriveProviderStatus() needs to report
  // CONNECTIVITY_VERIFIED / ANALYSIS_VERIFIED / GENERATION_VERIFIED honestly.
  // Promoting a success can only widen what routing will attempt; it cannot
  // impose a cooldown, which is the harm the isolation exists to prevent.
  if (capability === "connectivity") recordProviderPingSuccess(provider);
  else if (capability === "analysis") recordProviderAnalysisSuccess(provider);
  else recordProviderSuccess(provider);

  return record("ok", null, null);
}

/**
 * Full capability report for one provider: discover its models, resolve the
 * model that will really be used, then run connectivity → analysis →
 * generation, stopping as soon as one of them fails.
 */
export async function testProviderCapabilities(
  provider: AiProviderName,
  opts?: {
    capabilities?: readonly CapabilityName[];
    env?: NodeJS.ProcessEnv;
    /** Absolute epoch-ms deadline for the whole request. */
    deadlineAt?: number;
  },
): Promise<ProviderCapabilityReport> {
  const env = opts?.env ?? process.env;
  const entry = getProviderEntry(provider);
  const eligibility = providerAutomaticEligibility(provider, env);
  const capabilities = opts?.capabilities ?? (["connectivity", "analysis", "generation"] as const);

  const base = {
    provider,
    displayName: entry.displayName,
    rank: entry.rank,
    access: entry.access,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.safeMessage,
    ...configuredModelFacts(provider, env),
  };

  if (!eligibility.eligible) {
    return {
      ...base,
      results: capabilities.map((capability) => ({
        provider,
        capability,
        status: "skipped" as const,
        model: null,
        modelConfirmedByProvider: null,
        durationMs: 0,
        category: null,
        safeMessage: eligibility.safeMessage,
      })),
      usableForAiAnalyze: false,
      usableForGeneration: false,
      availableModels: null,
      resolvedModels: { proposal: null, extraction: null, fast: null },
      resolvedModel: null,
      modelVisible: null,
      diagnosticState: !base.keyPresent
        ? "KEY_MISSING" as const
        : "CONFIGURATION_INVALID" as const,
    };
  }

  const availableModels = await listAccountModels(provider, env, opts?.deadlineAt);
  const resolvedByUseCase = {
    proposal: await resolveVerifiedModel(provider, "proposal", availableModels, env),
    extraction: await resolveVerifiedModel(provider, "extraction", availableModels, env),
    fast: await resolveVerifiedModel(provider, "fast", availableModels, env),
  };
  const resolved = resolvedByUseCase.extraction;
  const resolvedModels = {
    proposal: resolvedByUseCase.proposal.model,
    extraction: resolvedByUseCase.extraction.model,
    fast: resolvedByUseCase.fast.model,
  };

  if (Object.values(resolvedModels).some((model) => !model)) {
    return {
      ...base,
      eligible: false,
      eligibilityReason: "No effective configured model is available.",
      results: capabilities.map((capability) => ({
        provider, capability, status: "skipped" as const, model: null,
        modelConfirmedByProvider: resolved.confirmedByProvider, durationMs: 0,
        category: "CONFIGURATION_INVALID" as const,
        safeMessage: "No effective configured model is available; provider was not contacted.",
      })),
      usableForAiAnalyze: false, usableForGeneration: false,
      availableModels, resolvedModels, resolvedModel: null,
      modelVisible: resolved.confirmedByProvider,
      diagnosticState: resolved.confirmedByProvider === false ? "MODEL_UNAVAILABLE" : "CONFIGURATION_INVALID",
    };
  }

  const results: CapabilityTestResult[] = [];
  for (const [index, capability] of capabilities.entries()) {
    const useCase = CAPABILITY_SPEC[capability].useCase as EffectiveModelUseCase;
    const capabilityResolution = resolvedByUseCase[useCase];
    const result = await runCapabilityTest(provider, capability, {
      model: capabilityResolution.model ?? undefined,
      modelConfirmedByProvider: capabilityResolution.confirmedByProvider,
      env,
      deadlineAt: opts?.deadlineAt,
    });
    results.push(result);
    // Out of time: record the capabilities still owed as explicitly untested,
    // so a half-finished provider never reads as a finished one.
    if (result.status === "not_tested") {
      for (const remaining of capabilities.slice(index + 1)) {
        results.push(notTestedResult(provider, remaining));
      }
      break;
    }
    // No point testing generation once analysis has failed — the later tests
    // would report the same fault again and spend more of the provider's quota.
    if (result.status === "failed") break;
  }

  const passed = (name: CapabilityName) => results.some((r) => r.capability === name && r.status === "ok");
  const nothingMeasured = results.length > 0 && results.every((r) => r.status === "not_tested");

  return {
    ...base,
    results,
    // "Usable for AI Analyze" means the ANALYSIS test passed. Connectivity is
    // deliberately not sufficient.
    usableForAiAnalyze: passed("analysis"),
    usableForGeneration: passed("generation"),
    availableModels,
    resolvedModels,
    resolvedModel: resolved.model,
    modelVisible: resolved.confirmedByProvider,
    diagnosticState: passed("generation") ? "GENERATION_VERIFIED"
      : passed("analysis") ? "ANALYSIS_VERIFIED"
        : passed("connectivity") ? "CONNECTIVITY_VERIFIED"
          : nothingMeasured ? "NOT_TESTED"
            : results.some((result) => result.category === "RATE_LIMIT") ? "RATE_LIMITED"
              : results.some((result) => result.category === "MODEL_UNAVAILABLE") ? "MODEL_UNAVAILABLE"
                : "CONFIGURED",
  };
}

/** A provider the diagnostic never contacted, and why. */
export type UntestedProvider = {
  provider: AiProviderName;
  reason: string;
};

export type ChainCapabilityRun = {
  /** Providers actually contacted, in canonical order. */
  reports: ProviderCapabilityReport[];
  /**
   * Providers left in the chain when the request budget ran out. Empty on a
   * complete run. Never inferred — only populated when the deadline stopped us.
   */
  notTested: UntestedProvider[];
  /** True when the run stopped early because the request deadline arrived. */
  deadlineExceeded: boolean;
  /** Every provider in the active chain, so a caller can show N of M honestly. */
  chainLength: number;
};

/**
 * Test every provider in the active automatic chain in canonical order, within
 * one bounded request deadline.
 *
 * Omitting the deadline restores the previous unbounded behaviour exactly. It
 * never shortens or reorders the chain that real AI routing uses, which is
 * computed independently in lib/ai.ts.
 */
export async function testAutomaticChainCapabilities(opts?: {
  capabilities?: readonly CapabilityName[];
  env?: NodeJS.ProcessEnv;
  includePaid?: boolean;
  /** Absolute epoch-ms deadline for the whole request. */
  deadlineAt?: number;
}): Promise<ChainCapabilityRun> {
  const env = opts?.env ?? process.env;
  const providers = getAutomaticProviderOrder(env);

  const reports: ProviderCapabilityReport[] = [];
  const notTested: UntestedProvider[] = [];
  let deadlineExceeded = false;

  // Serial, not parallel: these are real provider requests, and firing them
  // concurrently is a good way to trip the very rate limits the test is meant
  // to measure. Running out of time is not a reason to change that — it is a
  // reason to stop and say so.
  for (const provider of providers) {
    // An ineligible provider costs no network time — testProviderCapabilities
    // returns before any request is built. Keep reporting those even after the
    // budget is gone: "not configured" is a real, actionable answer, and
    // downgrading it to "not tested" would send an operator hunting for a
    // timeout that never happened.
    const wouldBeContacted = providerAutomaticEligibility(provider, env).eligible;
    if (wouldBeContacted && (deadlineExceeded || outOfBudget(opts?.deadlineAt))) {
      deadlineExceeded = true;
      notTested.push({ provider, reason: DEADLINE_REACHED_MESSAGE });
      continue;
    }

    const report = await testProviderCapabilities(provider, {
      capabilities: opts?.capabilities,
      env,
      deadlineAt: opts?.deadlineAt,
    });
    reports.push(report);
    // The budget can also expire INSIDE a provider, after its model listing but
    // before any capability ran. That provider measured nothing either, so it
    // belongs in the untested list as well as in the reports that carry its
    // configuration facts.
    if (report.diagnosticState === "NOT_TESTED") {
      deadlineExceeded = true;
      notTested.push({ provider, reason: DEADLINE_REACHED_MESSAGE });
    }
  }

  return { reports, notTested, deadlineExceeded, chainLength: providers.length };
}

/** Providers whose ANALYSIS capability was proven in this report. */
export function verifiedAnalysisProviders(reports: readonly ProviderCapabilityReport[]): AiProviderName[] {
  return reports.filter((r) => r.usableForAiAnalyze).map((r) => r.provider);
}

/** Providers excluded because they demand payment. */
export function billingBlockedProviders(reports: readonly ProviderCapabilityReport[]): AiProviderName[] {
  return reports
    .filter((r) => r.results.some((result) => isBillingBlocked(result.category)))
    .map((r) => r.provider);
}
