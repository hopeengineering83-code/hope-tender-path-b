import { readFileSync } from "node:fs";

const REQUIRED_CHAIN = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
const REQUIRED_LABELS = "Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude";
const failures = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function requireRule(label, condition) {
  if (!condition) failures.push(label);
}

function extractQuotedValues(source) {
  return Array.from(source.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
}

const ai = read("lib/ai.ts");
const policy = read("lib/ai-provider-policy.ts");
const health = read("app/api/ai/health/route.ts");
const envReadiness = read("lib/ai-environment-readiness.ts");
const download = read("app/api/tenders/[id]/download/route.ts");
const self = read("scripts/reconcile-gap-closure.mjs");

const policyChainMatch = policy.match(/CANONICAL_AI_PROVIDER_CHAIN\s*=\s*\[([\s\S]*?)\]\s*as const/);
const policyChain = policyChainMatch ? extractQuotedValues(policyChainMatch[1]) : [];
requireRule("Canonical provider policy is missing or out of order", JSON.stringify(policyChain) === JSON.stringify(REQUIRED_CHAIN));

const aiChainMatch = ai.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
const aiChain = aiChainMatch ? extractQuotedValues(aiChainMatch[1]) : [];
requireRule("lib/ai.ts canonical generic provider chain is missing or out of order", JSON.stringify(aiChain) === JSON.stringify(REQUIRED_CHAIN));

for (const useCase of ["default", "extraction", "proposal", "validation", "fast", "reasoning"]) {
  const direct = ai.match(new RegExp(`${useCase}:\\s*\\[([^\\]]+)\\]`));
  const spread = ai.includes(`${useCase}: [...CANONICAL_PROVIDER_CHAIN]`);
  const values = direct ? extractQuotedValues(direct[1]) : [];
  requireRule(`${useCase} generic provider chain drifted`, spread || JSON.stringify(values) === JSON.stringify(REQUIRED_CHAIN));
}

requireRule("AI prompt trust boundary import is missing", ai.includes('from "./ai-trust-boundary"'));
requireRule("AI prompt trust boundary is not applied", ai.includes("const trustBoundary = protectPrompt(prompt);") && ai.includes("trustBoundary.protectedPrompt"));
requireRule("AI health display order drifted", health.includes(REQUIRED_LABELS));
requireRule("AI health preferred provider is not Mistral-first", health.indexOf('mistralConfigured ? "mistral"') >= 0 && health.indexOf('mistralConfigured ? "mistral"') < health.indexOf(': geminiConfigured ? "gemini"'));
requireRule("AI environment readiness order drifted", envReadiness.includes(REQUIRED_LABELS));

requireRule("Final ZIP assembly helper is missing", download.includes("assembleFinalSubmissionZip"));
requireRule("Final ZIP private cache control is missing", download.includes('"Cache-Control": "private, no-store"'));
requireRule("Final ZIP nosniff header is missing", download.includes('"X-Content-Type-Options": "nosniff"'));

// Check that this reconciler script only imports read-only fs APIs.
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
