import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Required repair target not found: ${label}`);
  return source.replace(pattern, replacement);
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = JSON.parse(read(path));
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command !== "string") continue;
    pkg.scripts[name] = command
      .replaceAll("node scripts/reconcile-gap-closure.mjs && ", "")
      .replaceAll(" && node scripts/reconcile-gap-closure.mjs", "")
      .replaceAll("node scripts/reconcile-gap-closure.mjs", "")
      .trim();
  }
  delete pkg.scripts["reconcile:ai"];
  pkg.scripts["verify:source-clean"] = "node scripts/verify-source-clean.mjs";
  pkg.scripts["test:incorporation"] = "node --test tests/merged-pr-incorporation.test.ts";
  write(path, JSON.stringify(pkg, null, 2));
}

function patchAiRuntime() {
  const path = "lib/ai.ts";
  let source = read(path);
  if (!source.includes('from "./ai-provider-policy"')) {
    source = source.replace(
      /^(import .* from "\.\/ai-provider-health";\n)/m,
      '$1import { CANONICAL_AI_PROVIDER_CHAIN, CANONICAL_AI_PROVIDER_DISPLAY } from "./ai-provider-policy";\n',
    );
  }
  if (!source.includes('from "./ai-trust-boundary"')) {
    source = source.replace(
      /^(import .* from "\.\/ai-provider-policy";\n)/m,
      '$1import { protectPrompt } from "./ai-trust-boundary";\n',
    );
  }
  source = replaceRequired(
    source,
    /export const CANONICAL_PROVIDER_CHAIN:[^\n]+\n/,
    "export const CANONICAL_PROVIDER_CHAIN: readonly AiProviderName[] = CANONICAL_AI_PROVIDER_CHAIN;\n",
    "AI canonical provider chain",
  );
  source = replaceRequired(
    source,
    /const PROVIDER_CHAINS: Record<AiUseCase, AiProviderName\[]> = \{[\s\S]*?\n\};/,
    `const PROVIDER_CHAINS: Record<AiUseCase, AiProviderName[]> = {\n  default:    [...CANONICAL_AI_PROVIDER_CHAIN],\n  extraction: [...CANONICAL_AI_PROVIDER_CHAIN],\n  proposal:   [...CANONICAL_AI_PROVIDER_CHAIN],\n  validation: [...CANONICAL_AI_PROVIDER_CHAIN],\n  fast:       [...CANONICAL_AI_PROVIDER_CHAIN],\n  reasoning:  [...CANONICAL_AI_PROVIDER_CHAIN],\n};`,
    "AI provider use-case chains",
  );
  source = replaceRequired(
    source,
    /export function isAIEnabled\(\) \{[\s\S]*?\n\}/,
    `export function isAIEnabled() {\n  return CANONICAL_AI_PROVIDER_CHAIN.some(isProviderEnabled);\n}`,
    "isAIEnabled",
  );
  if (!source.includes("const trustBoundary = protectPrompt(prompt);")) {
    source = source.replace(
      "  const chain = PROVIDER_CHAINS[useCase];\n  const tried: string[] = [];",
      "  const chain = PROVIDER_CHAINS[useCase];\n  const trustBoundary = protectPrompt(prompt);\n  if (trustBoundary.suspicious) {\n    console.warn(`[ai] Untrusted prompt content matched ${trustBoundary.matchedRules.length} injection rule(s)`);\n  }\n  const tried: string[] = [];",
    );
    source = source.replace(
      "const result = await callProvider(provider, prompt, { ...opts, useCase });",
      "const result = await callProvider(provider, trustBoundary.protectedPrompt, { ...opts, useCase });",
    );
  }
  source = source
    .replaceAll("Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude", "Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude/Anthropic")
    .replaceAll("Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Claude", "Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude/Anthropic")
    .replaceAll("Gemini → OpenAI → Mistral → DeepSeek → Groq → OpenRouter → Claude", "Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude/Anthropic")
    .replaceAll("Claude is the preferred provider for proposal generation when configured", "Claude/Anthropic is the final fallback provider when configured")
    .replace(
      '"No AI provider configured — set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.",',
      '`No AI provider configured — set one canonical provider key. Policy order: ${CANONICAL_AI_PROVIDER_DISPLAY}.`,',
    );
  write(path, source);
}

function patchSystemReadiness() {
  const path = "lib/system-readiness.ts";
  let source = read(path);
  if (!source.includes('from "./ai-provider-policy"')) {
    source = source.replace(
      'import { resolveStorageProvider } from "./storage";\n',
      'import { resolveStorageProvider } from "./storage";\nimport { CANONICAL_AI_PROVIDER_DISPLAY, canonicalProviderLabel, configuredCanonicalProviders } from "./ai-provider-policy";\n',
    );
  }
  source = source.replace(
    /export const REQUIRED_PROVIDER_ORDER = \[[\s\S]*?\n\}\n\n/,
    "",
  );
  source = source.replace(
    "  const configuredProviders = configuredAiProviders();",
    "  const configuredProviders = configuredCanonicalProviders().map(canonicalProviderLabel);",
  );
  source = source.replace(
    /`Configure at least one provider\. Policy order: \$\{REQUIRED_PROVIDER_ORDER\.join\(" → "\)\}\.`,/,
    "`Configure at least one provider. Policy order: ${CANONICAL_AI_PROVIDER_DISPLAY}.`,",
  );
  write(path, source);
}

function patchEnvironmentReadiness() {
  const path = "lib/ai-environment-readiness.ts";
  let source = read(path);
  if (!source.includes('from "./ai-provider-policy"')) {
    source = 'import { CANONICAL_AI_PROVIDER_CHAIN, CANONICAL_AI_PROVIDER_DISPLAY, CANONICAL_AI_PROVIDER_ENV, canonicalProviderLabel } from "./ai-provider-policy";\n\n' + source;
  }
  source = source
    .replace('status("ANTHROPIC_API_KEY", "ai", "recommended", "Last-resort provider (eighth in default chain). Placed last to avoid Anthropic rate limits blocking the app when other providers are available."),', 'status("ANTHROPIC_API_KEY", "ai", "recommended", "Final canonical fallback provider."),')
    .replace('status("OPENAI_API_KEY", "ai", "critical", "Second-tier provider in the canonical chain after Gemini."),', 'status("OPENAI_API_KEY", "ai", "critical", "Third canonical provider after Gemini and OpenRouter."),')
    .replace('status("MISTRAL_API_KEY", "ai", "optional", "Third-tier provider via OpenAI-compatible Mistral endpoint."),', 'status("MISTRAL_API_KEY", "ai", "optional", "Optional adapter retained for explicit use; excluded from the canonical fallback chain."),')
    .replace('status("DEEPSEEK_API_KEY", "ai", "optional", "Fifth-tier fallback provider via OpenAI-compatible DeepSeek endpoint."),', 'status("DEEPSEEK_API_KEY", "ai", "optional", "Fifth canonical provider."),')
    .replace('status("GROQ_API_KEY", "ai", "optional", "Sixth-tier fallback provider (llama-3.3-70b-versatile)."),', 'status("GROQ_API_KEY", "ai", "optional", "Fourth canonical provider."),')
    .replace('status("TOGETHER_API_KEY", "ai", "optional", "Fourth-tier fallback provider after Mistral."),', 'status("TOGETHER_API_KEY", "ai", "optional", "Optional adapter retained for explicit use; excluded from the canonical fallback chain."),')
    .replace('status("OPENROUTER_API_KEY", "ai", "optional", "Seventh-tier fallback provider; aggregates many models via OpenAI-compatible API."),', 'status("OPENROUTER_API_KEY", "ai", "critical", "Second canonical provider; aggregates models via an OpenAI-compatible API."),');
  source = replaceRequired(
    source,
    /  \/\/ Reflect actual PROVIDER_CHAINS order:[\s\S]*?  const blockers: string\[] = \[];/,
    `  const providerChain = CANONICAL_AI_PROVIDER_CHAIN\n    .filter((provider) => present(CANONICAL_AI_PROVIDER_ENV[provider]))\n    .map((provider) => canonicalProviderLabel(provider));\n\n  const blockers: string[] = [];`,
    "environment provider chain",
  );
  source = source.replace(
    /  if \(!present\("OPENAI_API_KEY"\)[\s\S]*?\n  \}/,
    `  if (providerChain.length === 0) {\n    blockers.push(\`No canonical AI provider is configured. Policy order: \${CANONICAL_AI_PROVIDER_DISPLAY}.\`);\n  }`,
  );
  write(path, source);
}

function patchHealthRoute() {
  const path = "app/api/ai/health/route.ts";
  let source = read(path);
  if (!source.includes('from "../../../../lib/ai-provider-policy"')) {
    source = source.replace(
      'import { restoreHealthFromDb } from "../../../../lib/ai-provider-health-db";\n',
      'import { restoreHealthFromDb } from "../../../../lib/ai-provider-health-db";\nimport { CANONICAL_AI_PROVIDER_CHAIN, CANONICAL_AI_PROVIDER_DISPLAY, CANONICAL_AI_PROVIDER_RANK, configuredCanonicalProviders, preferredCanonicalProvider } from "../../../../lib/ai-provider-policy";\n',
    );
  }
  source = source.replace(
    /const AI_FALLBACK_CHAIN = ".*?";/,
    'const AI_FALLBACK_CHAIN = `${CANONICAL_AI_PROVIDER_DISPLAY} → deterministic draft fallback`;',
  );
  source = replaceRequired(
    source,
    /  const anyConfigured =[\s\S]*?    : "none";/,
    `  const configuredNames = configuredCanonicalProviders();\n  const anyConfigured = configuredNames.length > 0;\n  const preferredProvider = preferredCanonicalProvider() ?? "none";`,
    "health configured/preferred providers",
  );
  source = source.replace(
    'blockers.push("No AI provider key is configured. Set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY. AI analysis/generation will use the deterministic fallback, which cannot be exported as final.");',
    'blockers.push(`No canonical AI provider key is configured. Policy order: ${CANONICAL_AI_PROVIDER_DISPLAY}. Deterministic fallback cannot be exported as final.`);',
  );
  source = source.replace(
    'const allProviderNames: AiProviderName[] = ["gemini", "openai", "mistral", "together", "deepseek", "groq", "openrouter", "anthropic"];',
    'const allProviderNames: AiProviderName[] = [...CANONICAL_AI_PROVIDER_CHAIN];',
  );
  source = source.replace(/  const configuredNames = allProviderNames\.filter\(\(n\) => configuredMap\[n\]\);\n/, "");
  source = source
    .replace("fallbackRank: 5,\n        label: \"OpenAI\",\n        note: \"Fifth-tier provider (canonical chain)\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.openai,\n        label: \"OpenAI\",\n        note: \"Third canonical provider\"")
    .replace("fallbackRank: 4,\n        label: \"Gemini\",\n        note: \"Fourth-tier provider (canonical chain for analysis, extraction, proposal, validation, and fast use cases)\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.gemini,\n        label: \"Gemini\",\n        note: \"First canonical provider\"")
    .replace("fallbackRank: 1,\n        label: \"Mistral\",\n        note: \"First-tier provider; verified working — used for analysis, extraction, proposal, validation\"", "fallbackRank: null,\n        label: \"Mistral\",\n        note: \"Optional explicit adapter; excluded from the canonical fallback chain\"")
    .replace("fallbackRank: 7,\n        label: \"DeepSeek\",\n        note: \"Seventh-tier fallback provider\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.deepseek,\n        label: \"DeepSeek\",\n        note: \"Fifth canonical provider\"")
    .replace("fallbackRank: 2,\n        label: \"Groq\",\n        note: \"Second-tier provider — fastest verified working provider (88ms)\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.groq,\n        label: \"Groq\",\n        note: \"Fourth canonical provider\"")
    .replace("fallbackRank: 6,\n        label: \"Together\",\n        note: \"Sixth-tier fallback provider\"", "fallbackRank: null,\n        label: \"Together\",\n        note: \"Optional explicit adapter; excluded from the canonical fallback chain\"")
    .replace("fallbackRank: 3,\n        label: \"OpenRouter\",\n        note: \"Third-tier aggregator provider — verified working, routes via high-quality models\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.openrouter,\n        label: \"OpenRouter\",\n        note: \"Second canonical provider\"")
    .replace("fallbackRank: 8,\n        label: \"Claude\",\n        note: \"Last-resort provider (placed last to avoid Anthropic rate-limit blocking)\"", "fallbackRank: CANONICAL_AI_PROVIDER_RANK.anthropic,\n        label: \"Claude/Anthropic\",\n        note: \"Final canonical fallback provider\"");
  write(path, source);
}

function patchHealthPanel() {
  const path = "components/ai-health-panel.tsx";
  let source = read(path);
  if (!source.includes('from "../lib/ai-provider-policy"')) {
    source = source.replace(
      'import { AIHealthTestButton } from "./ai-health-test-button";\n',
      'import { AIHealthTestButton } from "./ai-health-test-button";\nimport { CANONICAL_AI_PROVIDER_DISPLAY, CANONICAL_AI_PROVIDER_RANK } from "../lib/ai-provider-policy";\n',
    );
  }
  source = source.replace(
    /const AI_FALLBACK_CHAIN = ".*?";/,
    'const AI_FALLBACK_CHAIN = `Canonical: ${CANONICAL_AI_PROVIDER_DISPLAY}. Claude/Anthropic remains last.`;',
  );
  source = source
    .replace('key: "mistral", label: "Mistral", rank: 1', 'key: "mistral", label: "Mistral", rank: 0')
    .replace('note: "First-tier provider (also analysis/fast capable)"', 'note: "Optional explicit adapter; excluded from canonical fallback"')
    .replace('key: "groq", label: "Groq", rank: 2', 'key: "groq", label: "Groq", rank: CANONICAL_AI_PROVIDER_RANK.groq')
    .replace('note: "Second-tier provider"', 'note: "Fourth canonical provider"')
    .replace('key: "openrouter", label: "OpenRouter", rank: 3', 'key: "openrouter", label: "OpenRouter", rank: CANONICAL_AI_PROVIDER_RANK.openrouter')
    .replace('note: "Third-tier provider"', 'note: "Second canonical provider"')
    .replace('key: "gemini", label: "Gemini", rank: 4', 'key: "gemini", label: "Gemini", rank: CANONICAL_AI_PROVIDER_RANK.gemini')
    .replace('note: "Fourth-tier provider"', 'note: "First canonical provider"')
    .replace('key: "openai", label: "OpenAI", rank: 5', 'key: "openai", label: "OpenAI", rank: CANONICAL_AI_PROVIDER_RANK.openai')
    .replace('note: "Fifth-tier provider"', 'note: "Third canonical provider"')
    .replace('key: "together", label: "Together", rank: 6', 'key: "together", label: "Together", rank: 0')
    .replace('note: "Sixth-tier provider"', 'note: "Optional explicit adapter; excluded from canonical fallback"')
    .replace('key: "deepseek", label: "DeepSeek", rank: 7', 'key: "deepseek", label: "DeepSeek", rank: CANONICAL_AI_PROVIDER_RANK.deepseek')
    .replace('note: "Seventh-tier provider"', 'note: "Fifth canonical provider"')
    .replace('key: "claude", label: "Claude", rank: 8', 'key: "claude", label: "Claude/Anthropic", rank: CANONICAL_AI_PROVIDER_RANK.anthropic')
    .replace('note: "Last-resort provider (placed last to avoid Anthropic rate-limit blocking)"', 'note: "Final canonical fallback provider"');
  source = source.replace(
    "  const anyConfigured = providers.some((p) => p.configured);\n  const preferredProvider = providers.find((p) => p.configured)?.key ?? \"none\";",
    "  const canonicalProviders = providers.filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);\n  const anyConfigured = canonicalProviders.some((p) => p.configured);\n  const preferredProvider = canonicalProviders.find((p) => p.configured)?.key ?? \"none\";",
  );
  source = source.replace("  const configuredProviders = providers.filter((p) => p.configured);", "  const configuredProviders = canonicalProviders.filter((p) => p.configured);");
  source = source.replace("    providers,\n    preferredProvider,", "    providers: canonicalProviders,\n    preferredProvider,");
  source = source.replace(
    "No AI provider key is configured. Set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY. Without one, only the deterministic fallback runs, which cannot be exported as final.",
    "No canonical AI provider key is configured. Configure Gemini, OpenRouter, OpenAI, Groq, DeepSeek, or Claude/Anthropic. Deterministic fallback cannot be exported as final.",
  );
  source = source.replace(
    "Shows whether the OpenAI, Gemini, Mistral, DeepSeek, Groq, Together, OpenRouter, and Claude keys are configured AND whether at least one provider has produced a successful response on this instance.",
    "Shows whether the canonical Gemini, OpenRouter, OpenAI, Groq, DeepSeek, and Claude/Anthropic providers are configured and runtime-verified.",
  );
  write(path, source);
}

function patchRbac() {
  write("lib/security/rbac.ts", [
    'export const SECURITY_ROLES = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"] as const;',
    'export type SecurityRole = (typeof SECURITY_ROLES)[number];',
    '',
    'export type Action =',
    '  | "TENDER_READ"',
    '  | "TENDER_UPDATE"',
    '  | "TENDER_DELETE"',
    '  | "AI_ANALYZE_TRIGGER"',
    '  | "GENERATION_TRIGGER"',
    '  | "REVIEW"',
    '  | "APPROVAL"',
    '  | "FINAL_EXPORT"',
    '  | "COMPANY_KNOWLEDGE_MGMT"',
    '  | "USER_ADMIN"',
    '  | "OPERATIONAL_DIAGNOSTICS"',
    '  | "DATA_REPAIR";',
    '',
    'export const ROLE_PERMISSIONS: Readonly<Record<SecurityRole, ReadonlySet<Action>>> = {',
    '  ADMIN: new Set(["TENDER_READ", "TENDER_UPDATE", "TENDER_DELETE", "AI_ANALYZE_TRIGGER", "GENERATION_TRIGGER", "REVIEW", "APPROVAL", "FINAL_EXPORT", "COMPANY_KNOWLEDGE_MGMT", "USER_ADMIN", "OPERATIONAL_DIAGNOSTICS", "DATA_REPAIR"]),',
    '  PROPOSAL_MANAGER: new Set(["TENDER_READ", "TENDER_UPDATE", "TENDER_DELETE", "AI_ANALYZE_TRIGGER", "GENERATION_TRIGGER", "REVIEW", "APPROVAL", "FINAL_EXPORT", "COMPANY_KNOWLEDGE_MGMT"]),',
    '  REVIEWER: new Set(["TENDER_READ", "REVIEW"]),',
    '  VIEWER: new Set(["TENDER_READ"]),',
    '};',
    '',
    'export function canPerform(role: string, action: Action): boolean {',
    '  return SECURITY_ROLES.includes(role as SecurityRole) && ROLE_PERMISSIONS[role as SecurityRole].has(action);',
    '}',
  ].join("\n"));

  const authPath = "lib/auth.ts";
  let auth = read(authPath);
  if (!auth.includes('from "./security/rbac"')) {
    auth = auth.replace('import { prisma, prismaReady } from "./prisma";\n', 'import { prisma, prismaReady } from "./prisma";\nimport { canPerform, type Action } from "./security/rbac";\n');
  }
  if (!auth.includes("export async function requirePermission")) {
    auth = auth.replace(
      'export async function requireRole(...roles: Role[]) {\n  const user = await requireUser();\n  if (!roles.includes(user.role as Role)) {\n    throw new Error("Forbidden");\n  }\n  return user;\n}\n',
      'export async function requireRole(...roles: Role[]) {\n  const user = await requireUser();\n  if (!roles.includes(user.role as Role)) {\n    throw new Error("Forbidden");\n  }\n  return user;\n}\n\nexport async function requirePermission(action: Action) {\n  const user = await requireUser();\n  if (!canPerform(user.role, action)) {\n    throw new Error("Forbidden");\n  }\n  return user;\n}\n',
    );
  }
  write(authPath, auth);
}

function wirePermission(path, action, roleCall) {
  let source = read(path);
  source = source.replace(/\brequireRole\b/g, "requirePermission");
  source = source.replace(roleCall, `requirePermission("${action}")`);
  write(path, source);
}

function patchPermissionWiring() {
  wirePermission("app/api/tenders/[id]/generate/route.ts", "GENERATION_TRIGGER", 'requirePermission("ADMIN", "PROPOSAL_MANAGER")');
  wirePermission("app/api/tenders/[id]/export/route.ts", "FINAL_EXPORT", 'requirePermission("ADMIN", "PROPOSAL_MANAGER")');
  wirePermission("app/api/tenders/[id]/download/route.ts", "FINAL_EXPORT", 'requirePermission("ADMIN", "PROPOSAL_MANAGER")');
  wirePermission("app/api/admin/repair/route.ts", "DATA_REPAIR", 'requirePermission("ADMIN")');
  wirePermission("app/api/admin/diagnostics/route.ts", "OPERATIONAL_DIAGNOSTICS", 'requirePermission("ADMIN")');

  let company = read("app/api/company/documents/[id]/route.ts");
  company = company.replace('import { getSession, requireRole } from "../../../../../lib/auth";', 'import { getSession, requirePermission } from "../../../../../lib/auth";');
  company = company.replace('requireRole("ADMIN", "PROPOSAL_MANAGER")', 'requirePermission("COMPANY_KNOWLEDGE_MGMT")');
  write("app/api/company/documents/[id]/route.ts", company);

  let users = read("app/api/users/[id]/route.ts");
  users = users.replace('import { requireRole, requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";', 'import { requirePermission, requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";');
  users = users.replace('requireRole("ADMIN", "PROPOSAL_MANAGER")', 'requirePermission("USER_ADMIN")');
  users = users.replace('requireRole("ADMIN")', 'requirePermission("USER_ADMIN")');
  write("app/api/users/[id]/route.ts", users);
}

function patchDocs() {
  write("docs/ai-provider-order.md", [
    "# AI provider order",
    "",
    "This file is the operator-facing description of the same policy exported by `lib/ai-provider-policy.ts`.",
    "",
    "## Canonical runtime fallback chain",
    "",
    "1. Gemini",
    "2. OpenRouter",
    "3. OpenAI",
    "4. Groq",
    "5. DeepSeek",
    "6. Claude / Anthropic",
    "7. Deterministic draft fallback only after all configured providers fail",
    "",
    "Claude / Anthropic is intentionally last. Deterministic fallback is draft-only and cannot pass final-export gates without the explicit approved workflow allowed by the tender policy.",
    "",
    "Mistral and Together adapters remain in the repository for explicit future integrations. They are not members of the canonical automatic fallback chain.",
    "",
    "Runtime, health, readiness, UI, tests, and documentation must import or validate `lib/ai-provider-policy.ts`; they must not define an independent provider order.",
  ].join("\n"));
}

function addIntegrityFiles() {
  write("scripts/verify-source-clean.mjs", [
    'import { execFileSync } from "node:child_process";',
    '',
    'try {',
    '  execFileSync("git", ["diff", "--exit-code", "--", "."], { stdio: "inherit" });',
    '} catch {',
    '  console.error("Tracked source changed during install/build/test. Commit the intended source instead of mutating it at runtime.");',
    '  process.exit(1);',
    '}',
  ].join("\n"));

  write("tests/merged-pr-incorporation.test.ts", [
    'import { describe, it } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { existsSync, readFileSync } from "node:fs";',
    '',
    'const read = (path: string) => readFileSync(path, "utf8");',
    '',
    'describe("merged PR incorporation repair", () => {',
    '  it("uses one exact canonical provider policy", () => {',
    '    const policy = read("lib/ai-provider-policy.ts");',
    '    assert.match(policy, /\[\s*"gemini",\s*"openrouter",\s*"openai",\s*"groq",\s*"deepseek",\s*"anthropic",?\s*\]/s);',
    '    for (const path of ["lib/ai.ts", "lib/system-readiness.ts", "lib/ai-environment-readiness.ts", "app/api/ai/health/route.ts", "components/ai-health-panel.tsx"]) {',
    '      assert.match(read(path), /ai-provider-policy/, `${path} must consume the canonical policy`);',
    '    }',
    '  });',
    '',
    '  it("does not mutate tracked source during package lifecycle commands", () => {',
    '    const pkg = JSON.parse(read("package.json"));',
    '    for (const [name, command] of Object.entries(pkg.scripts)) {',
    '      assert.doesNotMatch(String(command), /reconcile-gap-closure|writeFileSync\([^)]*(?:lib|app|components|tests)/, `${name} must not rewrite source`);',
    '    }',
    '    assert.equal(existsSync("scripts/reconcile-gap-closure.mjs"), false);',
    '    assert.equal(pkg.scripts["verify:source-clean"], "node scripts/verify-source-clean.mjs");',
    '  });',
    '',
    '  it("wires centralized permissions into high-risk boundaries", () => {',
    '    const auth = read("lib/auth.ts");',
    '    assert.match(auth, /export async function requirePermission/);',
    '    assert.match(auth, /canPerform\(user\.role, action\)/);',
    '    const expected: Record<string, string> = {',
    '      "app/api/tenders/[id]/generate/route.ts": "GENERATION_TRIGGER",',
    '      "app/api/tenders/[id]/export/route.ts": "FINAL_EXPORT",',
    '      "app/api/tenders/[id]/download/route.ts": "FINAL_EXPORT",',
    '      "app/api/company/documents/[id]/route.ts": "COMPANY_KNOWLEDGE_MGMT",',
    '      "app/api/users/[id]/route.ts": "USER_ADMIN",',
    '      "app/api/admin/diagnostics/route.ts": "OPERATIONAL_DIAGNOSTICS",',
    '      "app/api/admin/repair/route.ts": "DATA_REPAIR",',
    '    };',
    '    for (const [path, action] of Object.entries(expected)) {',
    '      const source = read(path);',
    '      assert.match(source, new RegExp(`requirePermission\\(\\"${action}\\"\\)`), `${path} must enforce ${action}`);',
    '    }',
    '  });',
    '});',
  ].join("\n"));
}

function patchCi() {
  const path = ".github/workflows/ci.yml";
  let source = read(path);
  if (!source.includes("npm run verify:source-clean")) {
    const buildPattern = /(\n\s*- name: Build[\s\S]*?\n\s*run: npm run build[^\n]*\n)/;
    if (buildPattern.test(source)) {
      source = source.replace(buildPattern, `$1\n      - name: Verify build did not mutate source\n        run: npm run verify:source-clean\n`);
    } else {
      throw new Error("Required repair target not found: CI build step");
    }
  }
  write(path, source);
}

patchPackageJson();
patchAiRuntime();
patchSystemReadiness();
patchEnvironmentReadiness();
patchHealthRoute();
patchHealthPanel();
patchRbac();
patchPermissionWiring();
patchDocs();
addIntegrityFiles();
patchCi();

if (existsSync("scripts/reconcile-gap-closure.mjs")) unlinkSync("scripts/reconcile-gap-closure.mjs");
console.log("Applied merged PR incorporation repair.");
