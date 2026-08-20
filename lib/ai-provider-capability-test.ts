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
  isZeroPaidMode,
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

export type CapabilityTestResult = {
  provider: AiProviderName;
  capability: CapabilityName;
  status: "ok" | "failed" | "skipped";
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
  resolvedModel: string | null;
};

function safeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return redactSecrets(raw).replace(/\s+/g, " ").trim().slice(0, 300);
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
): Promise<string[] | null> {
  const entry = getProviderEntry(provider);
  if (!entry.modelsEndpoint) return null;
  const key = readProviderKey(provider, env);
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
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
  model: string;
  /**
   * true  — the provider's list contains it.
   * false — the provider's list does not contain it (it will 404).
   * null  — the list could not be obtained, so this is unverified.
   */
  confirmedByProvider: boolean | null;
  source: "configured" | "free-tier-preference" | "provider-listing";
};

/**
 * Resolve the model to use, preferring what is CONFIGURED, then the free-tier
 * preference hints, then whatever the provider actually offers.
 *
 * The preference list is a set of hints checked against the live listing — never
 * an assertion that a name exists. When nothing matches, the provider's own
 * first offering is used rather than a name invented here.
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
  for (const candidate of entry.freeTierPreference) {
    if (listed.has(candidate)) {
      return { model: candidate, confirmedByProvider: true, source: "free-tier-preference" };
    }
  }
  // Last resort: something the provider actually lists, so the request has a
  // chance of succeeding. Still better than sending the unlisted configured name.
  const first = models[0];
  if (first) {
    return { model: first, confirmedByProvider: true, source: "provider-listing" };
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
  opts?: { model?: string; modelConfirmedByProvider?: boolean | null; env?: NodeJS.ProcessEnv },
): Promise<CapabilityTestResult> {
  const env = opts?.env ?? process.env;
  const spec = CAPABILITY_SPEC[capability];
  const eligibility = providerAutomaticEligibility(provider, env);

  // Refuse before any request is built. A paid-access provider is not "failing"
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
      category: eligibility.reason === "PAID_ACCESS_BLOCKED" ? "BILLING" : null,
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
      safeMessage: "Provider requires payment — excluded from automatic use.",
    };
  }

  const model = opts?.model ?? getProviderModel(provider, spec.useCase, env);
  const startedAt = Date.now();

  // Imported lazily: lib/ai.ts is a large module and pulling it in at load time
  // would drag the whole generation stack into anything that merely wants the
  // capability types.
  const { callProvider, runAsDiagnostic } = await import("./ai");

  let text: string | null = null;
  let thrown: unknown = null;
  const { capture } = await runAsDiagnostic(async () => {
    try {
      text = await callProvider(provider, spec.prompt, {
        useCase: spec.useCase,
        ...(provider === "gemini" ? { geminiModel: model } : {}),
      });
    } catch (err) {
      thrown = err;
    }
    return null;
  });

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
  opts?: { capabilities?: readonly CapabilityName[]; env?: NodeJS.ProcessEnv },
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
        category: eligibility.reason === "PAID_ACCESS_BLOCKED" ? ("BILLING" as const) : null,
        safeMessage: eligibility.safeMessage,
      })),
      usableForAiAnalyze: false,
      usableForGeneration: false,
      availableModels: null,
      resolvedModel: null,
    };
  }

  const availableModels = await listAccountModels(provider, env);
  const resolved = await resolveVerifiedModel(provider, "extraction", availableModels, env);

  const results: CapabilityTestResult[] = [];
  for (const capability of capabilities) {
    const result = await runCapabilityTest(provider, capability, {
      model: resolved.model,
      modelConfirmedByProvider: resolved.confirmedByProvider,
      env,
    });
    results.push(result);
    // No point testing generation once analysis has failed — the later tests
    // would report the same fault again and spend more of the provider's quota.
    if (result.status === "failed") break;
  }

  const passed = (name: CapabilityName) => results.some((r) => r.capability === name && r.status === "ok");

  return {
    ...base,
    results,
    // "Usable for AI Analyze" means the ANALYSIS test passed. Connectivity is
    // deliberately not sufficient.
    usableForAiAnalyze: passed("analysis"),
    usableForGeneration: passed("generation"),
    availableModels,
    resolvedModel: resolved.model,
  };
}

/**
 * Test every provider in the ACTIVE automatic chain. Paid providers are
 * reported as skipped rather than omitted — an operator needs to see that a key
 * is present and deliberately unused, not wonder where the provider went.
 */
export async function testAutomaticChainCapabilities(opts?: {
  capabilities?: readonly CapabilityName[];
  env?: NodeJS.ProcessEnv;
  includePaid?: boolean;
}): Promise<ProviderCapabilityReport[]> {
  const env = opts?.env ?? process.env;
  const { CANONICAL_AI_PROVIDER_ORDER } = await import("./ai-provider-registry");
  const providers = opts?.includePaid && !isZeroPaidMode(env)
    ? CANONICAL_AI_PROVIDER_ORDER
    : getAutomaticProviderOrder(env);

  const reports: ProviderCapabilityReport[] = [];
  // Serial, not parallel: these are real requests against free-tier accounts,
  // and firing them concurrently is a good way to trip the very rate limits the
  // test is meant to measure.
  for (const provider of providers) {
    reports.push(await testProviderCapabilities(provider, { capabilities: opts?.capabilities, env }));
  }
  return reports;
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
