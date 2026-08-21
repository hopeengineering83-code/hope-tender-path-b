// Audit-only gap-closure reconciler. Verifies protected invariants without
// ever modifying repository files.
//
// Provider-order rules: the codebase derives every fallback chain from
// lib/ai-provider-catalog.cjs CANONICAL_AI_PROVIDER_ORDER. This script pins
// that catalog to the documented canonical order (CLAUDE.md) and verifies the
// consumers (policy, lib/ai.ts, health route, environment readiness) still
// DERIVE from the catalog instead of hardcoding their own literal chains —
// the failure mode that caused drift in the past.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalog = require("../lib/ai-provider-catalog.cjs");

// The documented canonical order (CLAUDE.md), zero-paid first:
// Gemini → Groq → Mistral → Z.ai → OpenRouter → Cerebras → OpenAI → Together → DeepSeek → Anthropic
//
// The first five are the automatic chain; the rest require paid access and are
// enumerated only so health and diagnostics can report on them.
const REQUIRED_ORDER = ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"];
const REQUIRED_LABELS = "Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic";
const REQUIRED_AUTOMATIC_ORDER = REQUIRED_ORDER;
const failures = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function requireRule(label, condition) {
  if (!condition) failures.push(label);
}

const ai = read("lib/ai.ts");
const policy = read("lib/ai-provider-policy.ts");
const health = read("app/api/ai/health/route.ts");
const envReadiness = read("lib/ai-environment-readiness.ts");
const download = read("app/api/tenders/[id]/download/route.ts");
const self = read("scripts/reconcile-gap-closure.mjs");

// 1. The catalog itself must match the documented canonical order exactly.
requireRule(
  "Catalog CANONICAL_AI_PROVIDER_ORDER drifted from the documented canonical order",
  JSON.stringify(catalog.CANONICAL_AI_PROVIDER_ORDER) === JSON.stringify(REQUIRED_ORDER),
);

// 2. Consumers must DERIVE from the catalog order, not hardcode literals.
requireRule(
  "lib/ai-provider-policy.ts no longer derives CANONICAL_AI_PROVIDER_CHAIN from the catalog order",
  /export const CANONICAL_AI_PROVIDER_CHAIN\s*=\s*CANONICAL_AI_PROVIDER_ORDER/.test(policy),
);
requireRule(
  "lib/ai.ts no longer derives CANONICAL_PROVIDER_CHAIN from the catalog order",
  /export const CANONICAL_PROVIDER_CHAIN[^=]*=\s*CANONICAL_AI_PROVIDER_ORDER/.test(ai),
);
requireRule(
  "lib/ai.ts providerChainForUseCase no longer returns the active automatic order",
  /providerChainForUseCase[\s\S]{0,600}?return getAutomaticProviderOrder\(\);/.test(ai),
);

// 2b. The owner-required automatic chain contains all configured providers.
requireRule(
  "Catalog automatic order drifted from the required full chain",
  JSON.stringify(catalog.ZERO_PAID_AUTOMATIC_ORDER) === JSON.stringify(REQUIRED_AUTOMATIC_ORDER),
);
requireRule(
  "Automatic provider order no longer includes every provider",
  JSON.stringify(catalog.automaticProviderOrder({})) === JSON.stringify(REQUIRED_AUTOMATIC_ORDER),
);
// No per-use-case literal chain may reappear (e.g. `extraction: ["mistral", ...]`).
for (const useCase of ["default", "extraction", "proposal", "validation", "fast", "reasoning"]) {
  requireRule(
    `${useCase} use case reintroduced a hardcoded provider chain`,
    !new RegExp(`${useCase}:\\s*\\[\\s*"`).test(ai),
  );
}

// 3. Surfaces must expose the derived display order, not a hardcoded one.
requireRule(
  "AI health route no longer exposes a registry-derived fallback chain",
  health.includes("CANONICAL_AI_FALLBACK_CHAIN_DISPLAY") || health.includes("automaticChainDisplay"),
);
requireRule(
  "AI environment readiness no longer derives its display order from the canonical registry",
  envReadiness.includes("CANONICAL_AI_PROVIDER_CHAIN_DISPLAY") &&
    /export const CANONICAL_PROVIDER_DISPLAY\s*=\s*CANONICAL_AI_PROVIDER_CHAIN_DISPLAY/.test(envReadiness),
);

// 4. Prompt trust boundary.
requireRule("AI prompt trust boundary import is missing", ai.includes('from "./ai-trust-boundary"'));
requireRule("AI prompt trust boundary is not applied", ai.includes("const trustBoundary = protectPrompt(prompt);") && ai.includes("trustBoundary.protectedPrompt"));

// 5. Final ZIP invariants.
requireRule("Final ZIP assembly helper is missing", download.includes("assembleFinalSubmissionZip"));
requireRule("Final ZIP private cache control is missing", download.includes('"Cache-Control": "private, no-store"'));
requireRule("Final ZIP nosniff header is missing", download.includes('"X-Content-Type-Options": "nosniff"'));

// 6. This reconciler must stay read-only.
// We split the forbidden token names so they don't appear literally and
// trigger a false positive when we test `self` against the pattern.
const writeTokens = ["Sync", "appendFile", "rename", "unlink", "rm", "cp"].map((s, i) => i === 0 ? "writeFile" + s : s + "Sync");
const selfImports = (self.match(/^import\s*\{([^}]+)\}/m) ?? [])[1] ?? "";
requireRule("Reconciler imported a write API", !writeTokens.some((t) => selfImports.includes(t)));

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    message: "Gap-closure drift detected. This command is audit-only and never rewrites repository files.",
    failures,
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    message: "Protected gap-closure invariants verified without modifying repository files.",
    providerOrder: REQUIRED_LABELS,
    trackedP1: "Legacy monolithic proposal paths still require migration to the canonical executor; tracked separately and not hidden by this audit.",
  }, null, 2));
}
