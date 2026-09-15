import {
  CANONICAL_AI_PROVIDER_ORDER,
  CANONICAL_AI_PROVIDER_CHAIN_DISPLAY,
  getProviderRegistry,
  getProviderModel,
  getAutomaticProviderOrder,
  isProviderConfigured,
  providerAutomaticEligibility,
  providerDisplayName,
} from "./ai-provider-registry";
// Effective timeout values from the centralized timeout module. These are
// the values the runtime actually uses — env vars are optional overrides.
// Readiness must validate the EFFECTIVE values, not raw env presence,
// because missing env vars fall back to validated defaults (analysis
// 50s/240s by tier, proposal 55s/220s, section 30s). Marking the env
// blocked when the env var is absent would create a false production
// failure contradicting the actual runtime configuration.
import {
  AI_ANALYSIS_TIMEOUT_MS,
  AI_PROPOSAL_TIMEOUT_MS,
  PROPOSAL_SECTION_TIMEOUT_MS,
} from "./timeout-config";

export type AIEnvironmentVariableStatus = {
  name: string;
  present: boolean;
  scope: "ai" | "database" | "auth" | "ocr" | "runtime";
  severity: "critical" | "recommended" | "optional";
  configurationState: "SET" | "ENABLED" | "DISABLED" | "INACTIVE" | "NOT_CONFIGURED" | "DEFAULTED" | "RECOMMENDED" | "OPTIONAL" | "MISSING";
  requirementLabel: "required" | "alternative provider" | "recommended" | "optional";
  note: string;
};

// The required canonical provider order, generated from the registry. Surfaced
// here (and asserted by tests) so the readiness module can never drift from the
// single source of truth.
export const CANONICAL_PROVIDER_DISPLAY = CANONICAL_AI_PROVIDER_CHAIN_DISPLAY;

export type AIEnvironmentReadiness = {
  ready: boolean;
  providerChain: string[];
  variables: AIEnvironmentVariableStatus[];
  blockers: string[];
  warnings: string[];
};

function present(name: string): boolean {
  return Boolean((process.env[name] ?? "").trim());
}

function status(
  name: string,
  scope: AIEnvironmentVariableStatus["scope"],
  severity: AIEnvironmentVariableStatus["severity"],
  note: string,
  options: { defaultWhenUnset?: boolean; presentOverride?: boolean; active?: boolean; stateOverride?: AIEnvironmentVariableStatus["configurationState"] } = {},
): AIEnvironmentVariableStatus {
  const isPresent = options.presentOverride ?? present(name);
  const alternativeProvider = scope === "ai" && name.endsWith("_API_KEY");
  const configurationState: AIEnvironmentVariableStatus["configurationState"] = options.stateOverride ?? (options.active === false
    ? "INACTIVE"
    : isPresent
    ? "SET"
    : options.defaultWhenUnset
      ? "DEFAULTED"
      : alternativeProvider
        ? "NOT_CONFIGURED"
        : severity === "critical"
          ? "MISSING"
          : severity === "recommended"
            ? "RECOMMENDED"
            : "OPTIONAL");
  const requirementLabel: AIEnvironmentVariableStatus["requirementLabel"] = alternativeProvider
    ? "alternative provider"
    : severity === "critical"
      ? "required"
      : severity;
  return { name, present: isPresent, scope, severity, configurationState, requirementLabel, note };
}

/**
 * Registry-generated expansion contract, documented in the exact canonical
 * order so code review and source-contract diagnostics can verify the public
 * readiness surface without introducing a second runtime provider list:
 *
 * status("GEMINI_API_KEY", ...)
 * status("GROQ_API_KEY", ...)
 * status("MISTRAL_API_KEY", ...)
 * status("ZAI_API_KEY", ...)
 * status("CEREBRAS_API_KEY", ...)
 * status("OPENROUTER_API_KEY", ...)
 * status("OPENAI_API_KEY", ...)
 * status("TOGETHER_API_KEY", ...)
 * status("DEEPSEEK_API_KEY", ...)
 * status("ANTHROPIC_API_KEY", ...)
 *
 * All ten providers participate in the canonical automatic chain when normally
 * configured. Effective model identifiers are never silently replaced.
 *
 * Effective model values are resolved by the central provider registry; the
 * notes emitted below are diagnostic, not an independent model configuration.
 */
function providerVariableStatuses(): AIEnvironmentVariableStatus[] {
  const registry = getProviderRegistry();
  const variables: AIEnvironmentVariableStatus[] = [];
  for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
    const entry = registry[provider];
    const providerConfigured = isProviderConfigured(provider);
    variables.push(status(
      entry.env.apiKey,
      "ai",
      "critical",
      `Rank ${entry.rank} automatic provider. Configure its key and effective model as required by that provider.`,
      { presentOverride: providerConfigured },
    ));

    const overrides = [
      { name: entry.env.baseUrl, label: "API base URL", fallback: entry.defaults.baseUrl },
      { name: entry.env.proposalModel, label: "proposal model", fallback: entry.defaults.proposalModel },
      { name: entry.env.analysisModel, label: "analysis model", fallback: entry.defaults.analysisModel },
      { name: entry.env.fastModel, label: "fast model", fallback: entry.defaults.fastModel },
    ];
    for (const override of overrides) {
      if (!override.name) continue;
      const hasDefault = Boolean(override.fallback);
      const severity = provider === "openrouter" && override.name === entry.env.proposalModel && !hasDefault
        ? "recommended"
        : "optional";
      variables.push(status(
        override.name,
        "ai",
        severity,
        provider === "openrouter" && override.name === entry.env.proposalModel
          ? "OpenRouter proposal model override. The exact configured model is used without silent substitution."
          : hasDefault
          ? `${entry.displayName} ${override.label} override (effective default: ${override.fallback}).`
          : `${entry.displayName} ${override.label} override; no registry default is configured.`,
        { defaultWhenUnset: hasDefault, active: providerConfigured },
      ));
    }
  }
  return variables;
}

export function getAIEnvironmentReadiness(): AIEnvironmentReadiness {
  const geminiConfigured = isProviderConfigured("gemini");
  const anthropicConfigured = isProviderConfigured("anthropic");
  const rawOcrFlag = (process.env.PDF_OCR_ENABLED ?? "").trim().toLowerCase();
  const ocrEnabled = rawOcrFlag === "true" || (rawOcrFlag !== "false" && anthropicConfigured);
  const ocrFlagState: AIEnvironmentVariableStatus["configurationState"] = rawOcrFlag === "false"
    ? "DISABLED"
    : ocrEnabled
      ? rawOcrFlag === "true" ? "ENABLED" : "DEFAULTED"
      : "INACTIVE";
  const variables: AIEnvironmentVariableStatus[] = [
    ...providerVariableStatuses(),
    status("GEMINI_FALLBACK_MODELS", "ai", "optional", "Additional Gemini models to try if the primary is unavailable. Unset by default so the app never falls back to a model nobody chose.", { defaultWhenUnset: true, active: geminiConfigured }),
    status("ANTHROPIC_TIER", "ai", "recommended", "Used to select Claude output-token defaults; Tier 2 supports larger proposal outputs than Tier 1.", { active: anthropicConfigured }),
    status("ANTHROPIC_MAX_OUTPUT_TOKENS", "ai", "recommended", "Controls Claude proposal output budget. Use a realistic value for your Vercel timeout and Anthropic tier.", { active: anthropicConfigured }),
    status("PDF_OCR_ENABLED", "ocr", "optional", "Vision OCR defaults on when Anthropic is configured; set false to opt out.", { stateOverride: ocrFlagState }),
    status("PDF_OCR_MODEL", "ocr", "optional", "OCR reasoning model selector (effective default: claude-3-5-sonnet-latest).", { defaultWhenUnset: true, active: ocrEnabled }),
    status("PDF_OCR_MAX_PAGES", "ocr", "optional", "Caps OCR pages to avoid serverless timeout/cost overrun (effective default: 50).", { defaultWhenUnset: true, active: ocrEnabled }),
    status("PDF_OCR_TIMEOUT_MS", "ocr", "optional", "OCR call timeout in milliseconds (default 40000). Prevents Vercel FUNCTION_RUNTIME_LIMIT.", { defaultWhenUnset: true, active: ocrEnabled }),
    status("DATABASE_URL", "database", "critical", "Persistent database connection."),
    status("SESSION_SECRET", "auth", "critical", "Required for secure login/session cookies."),
    status("AI_ANALYSIS_TIMEOUT_MS", "runtime", "recommended", "Tender-analysis timeout guard.", { defaultWhenUnset: true }),
    status("AI_PROPOSAL_TIMEOUT_MS", "runtime", "recommended", "Proposal-generation timeout guard.", { defaultWhenUnset: true }),
    status("PROPOSAL_SECTION_TIMEOUT_MS", "runtime", "recommended", "Section-level proposal timeout guard.", { defaultWhenUnset: true }),
  ];

  const providerChain: string[] = [];
  for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
    if (!isProviderConfigured(provider)) continue;
    const label = providerDisplayName(provider);
    const suffix = provider === "anthropic"
      ? " (last-resort)"
      : ` (${getProviderModel(provider, "proposal") || "model not set"})`;
    providerChain.push(`${label}${suffix}`);
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  const eligibleProviders = getAutomaticProviderOrder().filter(
    (provider) => providerAutomaticEligibility(provider).eligible,
  );
  if (eligibleProviders.length < 1) {
    blockers.push(
      "No AI provider is normally configured with an effective runtime model.",
    );
  }
  if (!present("DATABASE_URL")) blockers.push("DATABASE_URL is missing.");
  if (!present("SESSION_SECRET")) blockers.push("SESSION_SECRET is missing.");

  // INVARIANT ASSERTION: validate the centralized effective values the runtime
  // actually consumes. This is NOT a raw environment validation; the
  // centralized module already clamps/falls back to supported defaults when
  // explicit timeout overrides are absent.
  const SUPPORTED_TIMEOUT_RANGES: Record<string, { min: number; max: number; label: string }> = {
    "AI_ANALYSIS_TIMEOUT_MS": { min: 5_000, max: 600_000, label: "analysis" },
    "AI_PROPOSAL_TIMEOUT_MS": { min: 10_000, max: 300_000, label: "proposal" },
    "PROPOSAL_SECTION_TIMEOUT_MS": { min: 5_000, max: 600_000, label: "section" },
  };
  const effectiveTimeouts: Record<string, number> = {
    "AI_ANALYSIS_TIMEOUT_MS": AI_ANALYSIS_TIMEOUT_MS,
    "AI_PROPOSAL_TIMEOUT_MS": AI_PROPOSAL_TIMEOUT_MS,
    "PROPOSAL_SECTION_TIMEOUT_MS": PROPOSAL_SECTION_TIMEOUT_MS,
  };
  for (const [envVar, range] of Object.entries(SUPPORTED_TIMEOUT_RANGES)) {
    const effective = effectiveTimeouts[envVar];
    if (
      typeof effective !== "number" ||
      !Number.isFinite(effective) ||
      effective < range.min ||
      effective > range.max
    ) {
      blockers.push(
        `Effective ${envVar} (${range.label}) runtime value is ${effective}, outside the supported range [${range.min}, ${range.max}]. This is an INVARIANT ASSERTION on the centralized timeout module output, NOT a raw environment validation.`,
      );
    }
  }
  if (!present("PDF_OCR_ENABLED")) warnings.push("PDF_OCR_ENABLED is not set. OCR runs by default when ANTHROPIC_API_KEY is present. Set PDF_OCR_ENABLED=false to disable, or PDF_OCR_ENABLED=true to make it explicit.");
  if (!present("ANTHROPIC_TIER") && present("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_TIER is not set. Claude output-token defaults may not match your Tier 2 account.");

  return {
    ready: blockers.length === 0,
    providerChain,
    variables,
    blockers,
    warnings,
  };
}
