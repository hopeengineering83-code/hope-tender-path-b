import {
  getProviderRuntimeSnapshot,
  deepSeekOfficialEnvPresent,
  isDeepSeekConfigured,
  type ProviderRuntimeSnapshot,
  type AiProviderStatus,
} from "../lib/ai-provider-health";
import {
  getCanonicalProviderEntries,
  getProviderModel,
  isProviderConfigured,
  openRouterModelValidity,
  automaticChainDisplay,
  getAutomaticProviderOrder,
} from "../lib/ai-provider-registry";
import { AIHealthTestButton } from "./ai-health-test-button";

const AI_FALLBACK_CHAIN = `Canonical: ${automaticChainDisplay()}. The deterministic draft fallback is NOT an AI provider and runs only after every configured AI provider has failed or is unavailable.`;

type ProviderCardData = {
  key: string;
  label: string;
  rank: number;
  configured: boolean;
  model: string | null;
  envVar: string;
  note: string;
  detail: string | null;
  modelHint: string | null;
  runtime: ProviderRuntimeSnapshot;
  status: AiProviderStatus;
  isAi: boolean;
};

type AIHealthResponse = {
  success: boolean;
  preferredProvider: string;
  nextAction: string;
  blockers: string[];
  warnings: string[];
  providers: ProviderCardData[];
};

// ─── Status presentation: one row per status, no fall-through ────────────────
//
// This replaces a nested ternary ladder that handled six of the fifteen
// statuses and let the rest land on "Unknown — not yet verified". A provider
// whose ANALYSIS capability had been proven by a real structured-output call
// was therefore displayed as unverified, which is the opposite of what the
// runtime knew — and BILLING_BLOCKED rendered as a generic "Unavailable",
// hiding the one cause an operator can actually act on.
//
// The map is typed as Record<AiProviderStatus, …>, so adding a status to the
// union without giving it a presentation is a compile error rather than a
// silent fall-through to "Unknown".
//
//   healthy — a real call really succeeded.
//   neutral — nothing has failed; nothing has been proven either.
//   (neither) — something is wrong, and the label says what.
type StatusPresentation = {
  label: (p: ProviderCardData) => string;
  className: string;
  healthy: boolean;
  neutral: boolean;
};

const OK_PILL = "bg-emerald-100 text-emerald-700";
const WARN_PILL = "bg-amber-100 text-amber-800";
const BAD_PILL = "bg-red-100 text-red-700";
const NEUTRAL_PILL = "bg-slate-100 text-slate-600";

function cooldownSuffix(p: ProviderCardData): string {
  return p.runtime.cooldownUntil
    ? ` until ${new Date(p.runtime.cooldownUntil).toLocaleTimeString()}`
    : "";
}

const STATUS_PRESENTATION: Record<AiProviderStatus, StatusPresentation> = {
  GENERATION_VERIFIED: {
    label: () => "Generation verified",
    className: OK_PILL, healthy: true, neutral: false,
  },
  ANALYSIS_VERIFIED: {
    label: () => "Analysis verified",
    className: OK_PILL, healthy: true, neutral: false,
  },
  CONNECTIVITY_VERIFIED: {
    // Deliberately not green. Reaching the provider proves the key and the
    // route; it does not prove the provider can return the structured analysis
    // the workflow depends on. Calling this "available" is what let diagnostics
    // report success on a provider AI Analyze could not actually use.
    label: () => "Connectivity verified — analysis not yet proven",
    className: WARN_PILL, healthy: false, neutral: true,
  },
  RATE_LIMITED: {
    label: (p) => `Rate-limited${cooldownSuffix(p)}`,
    className: WARN_PILL, healthy: false, neutral: false,
  },
  PROVIDER_OVERLOAD: {
    label: (p) => `Provider overloaded — retrying${cooldownSuffix(p)}`,
    className: WARN_PILL, healthy: false, neutral: false,
  },
  BILLING_BLOCKED: {
    label: () => "Billing blocked — excluded from automatic use",
    className: BAD_PILL, healthy: false, neutral: false,
  },
  AUTH_FAILED: {
    label: () => "Auth failed — fix API key",
    className: BAD_PILL, healthy: false, neutral: false,
  },
  MODEL_UNAVAILABLE: {
    label: (p) => `Model unavailable${p.model ? ` (${p.model})` : ""}`,
    className: BAD_PILL, healthy: false, neutral: false,
  },
  CONFIGURATION_INVALID: {
    label: () => "Configuration invalid",
    className: BAD_PILL, healthy: false, neutral: false,
  },
  NOT_CONFIGURED: {
    label: () => "Not configured",
    className: NEUTRAL_PILL, healthy: false, neutral: true,
  },
  CONFIGURED: {
    label: () => "Configured — not yet tested on this instance",
    className: NEUTRAL_PILL, healthy: false, neutral: true,
  },
  TIMEOUT: {
    label: () => "Timeout — retrying shortly",
    className: WARN_PILL, healthy: false, neutral: false,
  },
  NETWORK_ERROR: {
    label: () => "Network error — provider unreachable",
    className: WARN_PILL, healthy: false, neutral: false,
  },
  PROVIDER_ERROR: {
    label: () => "Provider error (5xx) — their side",
    className: WARN_PILL, healthy: false, neutral: false,
  },
  MALFORMED_RESPONSE: {
    label: () => "Responded, but the output was unusable",
    className: WARN_PILL, healthy: false, neutral: false,
  },
  COOLING_DOWN: {
    label: (p) => `Cooling down${cooldownSuffix(p)}`,
    className: WARN_PILL, healthy: false, neutral: false,
  },
  UNKNOWN: {
    label: () => "Unknown — not yet verified",
    className: NEUTRAL_PILL, healthy: false, neutral: true,
  },
};

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function getAIHealth(): AIHealthResponse {
  // Provider cards are generated DIRECTLY from the authoritative registry in
  // canonical order (zai → cerebras → mistral → groq → openrouter → gemini →
  // openai → together → deepseek → anthropic). Anthropic / Claude is last so
  // its rate limits never block the app while earlier providers are available.
  const entries = getCanonicalProviderEntries();
  const orModelValidity = openRouterModelValidity();

  const aiCards: ProviderCardData[] = entries.map((entry) => {
    const runtime = getProviderRuntimeSnapshot(entry.provider);
    const configured = isProviderConfigured(entry.provider);
    let detail: string | null = null;
    let modelHint: string | null = null;
    if (entry.provider === "openrouter" && !orModelValidity.valid) {
      modelHint = orModelValidity.message;
    }
    if (entry.provider === "deepseek" && configured && !deepSeekOfficialEnvPresent()) {
      detail = "Enabled via alias env var — rename to DEEPSEEK_API_KEY.";
    }
    if (entry.provider === "anthropic") {
      detail = `Tier ${process.env.ANTHROPIC_TIER ?? "not set"}`;
    }
    return {
      key: entry.provider,
      label: entry.displayName,
      rank: entry.rank,
      configured,
      model: entry.provider === "openrouter" ? orModelValidity.model : getProviderModel(entry.provider, "proposal"),
      envVar: entry.env.apiKey,
      note: `Rank ${entry.rank} provider${entry.emergencyOnly ? " (last-resort)" : ""}`,
      detail,
      modelHint,
      runtime,
      status: runtime.status,
      isAi: true,
    };
  });

  const providers: ProviderCardData[] = [
    ...aiCards,
    {
      // Final non-AI fallback. NOT a healthy AI provider — never shown as
      // green. Runs only after every configured AI provider has failed.
      key: "deterministic", label: "Deterministic draft fallback", rank: entries.length + 1, configured: true, envVar: "(none — always available)",
      model: null, note: "Final non-AI fallback (not an AI provider). Output is never exportable as a final proposal.",
      detail: null, modelHint: null,
      runtime: {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCategory: null,
        lastSafeErrorMessage: null,
        lastFailureReason: null,
        cooldownUntil: null,
        consecutiveFailures: 0,
        coolingDown: false,
        rateLimited: false,
        billingBlocked: false,
        runtimeVerified: false,
        analysisUsable: false,
        available: true,
        status: "UNKNOWN",
      },
      status: "UNKNOWN",
      isAi: false,
    },
  ];

  const aiProviders = providers.filter((p) => p.isAi);
  const anyConfigured = aiProviders.some((p) => p.configured);
  // preferredProvider is the first CONFIGURED AI provider in the canonical
  // runtime chain order. Mirrors /api/ai/health preferredProvider logic.
  const preferredProvider = aiProviders.find((p) => p.configured)?.key ?? "none";

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!anyConfigured) {
    const keyNames = entries.map((e) => e.env.apiKey).join(", ");
    blockers.push(`No AI provider key is configured. Set one of: ${keyNames}. Without one, only the deterministic fallback runs, which cannot be exported as final.`);
  }
  if (isProviderConfigured("gemini") && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (isProviderConfigured("openrouter") && !orModelValidity.valid && orModelValidity.message) warnings.push(`OpenRouter: ${orModelValidity.message}`);
  if (isDeepSeekConfigured() && !deepSeekOfficialEnvPresent()) warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");
  const cooling = providers.filter((p) => p.runtime.coolingDown).map((p) => p.label);
  if (cooling.length > 0) warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}. Requests skip cooled-down providers until the window expires.`);

  // Configured ≠ verified runtime. The pill must not claim READY purely
  // because keys exist — the screenshot bug. The unified `status` field on
  // each provider is the single source of truth for pill colour.
  const configuredProviders = aiProviders.filter((p) => p.configured);
  const anyHasRecentSuccess = configuredProviders.some((p) => p.runtime.lastSuccessAt);
  const allConfiguredCooling = anyConfigured && configuredProviders.every((p) => p.runtime.coolingDown);
  if (allConfiguredCooling) warnings.push("All configured AI providers are currently in cooldown. AI Analyze will fall back to regex (UNAPPROVED) until a provider's cooldown expires.");
  if (anyConfigured && !anyHasRecentSuccess) warnings.push("AI providers are configured but no successful response has been recorded on this instance yet — runtime availability is not verified. The first analysis or document generation on this instance will confirm it.");

  const nextAction = blockers.length > 0
    ? "CONFIGURE_AI_KEYS"
    : allConfiguredCooling
      ? "ALL_PROVIDERS_COOLING"
      : !anyHasRecentSuccess
        ? "RUNTIME_NOT_VERIFIED"
        : warnings.length > 0
          ? "REVIEW_AI_CONFIGURATION"
          : "READY";

  return {
    success: anyConfigured,
    providers,
    preferredProvider,
    blockers,
    warnings,
    nextAction,
  };
}

function ProviderCard({ p }: { p: ProviderCardData }) {
  // The deterministic draft fallback is the final non-AI entry. It is never
  // shown as a healthy AI provider — it always renders as a neutral,
  // non-green "final fallback" card.
  if (!p.isAi) {
    return (
      <div className="rounded-xl bg-slate-50 p-3 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="font-semibold text-slate-900">{p.label}</p>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Final fallback (non-AI)</span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Fallback rank {p.rank}</p>
        <p className="mt-1 text-xs text-slate-600">{p.note}</p>
        <p className="mt-1 text-xs text-slate-500">Runs only after every configured AI provider has failed, returned no usable result, or is in cooldown.</p>
      </div>
    );
  }
  const presentation = STATUS_PRESENTATION[p.status];
  const pill = (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${presentation.className}`}>
      {presentation.label(p)}
    </span>
  );
  // "Last response failed" is only true when something actually failed. It used
  // to fire for every status except GENERATION_VERIFIED, so a provider whose
  // ANALYSIS capability had just been verified was told it had failed.
  const failing = p.configured && !presentation.healthy && !presentation.neutral;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="font-semibold text-slate-900">{p.label}</p>
        {pill}
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Fallback rank {p.rank}</p>
      {!p.configured && <p className="mt-1 text-xs text-slate-600">Not configured — set {p.envVar} in Vercel Production environment.</p>}
      {p.configured && <p className="mt-1 text-xs text-slate-600">Model: {p.model ?? "provider default"}</p>}
      {p.configured && p.detail && <p className="mt-1 text-xs text-slate-500">{p.detail}</p>}
      {p.configured && failing && !p.runtime.coolingDown && (
        <p className="mt-1 text-xs text-amber-800">
          Last response failed or returned empty{p.runtime.lastErrorCategory ? ` (${p.runtime.lastErrorCategory})` : ""}. Check {p.label} model access or retry after cooldown.
        </p>
      )}
      {p.configured && p.modelHint && <p className="mt-1 text-xs text-slate-500">{p.modelHint}</p>}
      {p.configured && p.status === "CONFIGURED" && (
        <p className="mt-1 text-xs text-slate-400">Providers are tested automatically when AI Analyze or proposal generation is first run.</p>
      )}
    </div>
  );
}

export async function AIHealthPanel() {
  const health = getAIHealth();
  // Header tone follows the same trichotomy as the pill so the panel never
  // reads "all green" while runtime is unverified or every provider is cooling.
  const verified = health.nextAction === "READY";
  const degraded = health.nextAction === "RUNTIME_NOT_VERIFIED" || health.nextAction === "REVIEW_AI_CONFIGURATION" || health.nextAction === "ALL_PROVIDERS_COOLING";
  const sectionTone = verified ? "border-emerald-200 bg-emerald-50" : degraded ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const labelTone = verified ? "text-emerald-700" : degraded ? "text-amber-800" : "text-red-700";
  const pillTone = verified ? "bg-emerald-100 text-emerald-800" : degraded ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionTone}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${labelTone}`}>AI provider health</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Preferred provider: {health.preferredProvider}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Shows whether the OpenAI, Gemini, Mistral, DeepSeek, Groq, Together, OpenRouter, and Claude keys are configured AND whether at least one provider has produced a successful response on this instance. &ldquo;Configured&rdquo; alone does not guarantee runtime availability. Secret values are never displayed.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${pillTone}`}>{health.nextAction.replace(/_/g, " ")}</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {health.providers.map((p) => <ProviderCard key={p.key} p={p} />)}
      </div>

      <p className="mt-3 text-xs text-slate-500">Fallback chain: {AI_FALLBACK_CHAIN}</p>

      <AIHealthTestButton />

      {(health.blockers.length > 0 || health.warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {health.blockers.length > 0 && <div className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800"><p className="font-semibold">Blockers</p><ul className="mt-2 list-disc pl-5">{health.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {health.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800"><p className="font-semibold">Warnings</p><ul className="mt-2 list-disc pl-5">{health.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}
