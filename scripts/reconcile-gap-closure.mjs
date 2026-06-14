import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const REQUIRED_CHAIN = ["gemini", "openrouter", "openai", "groq", "deepseek", "anthropic"];
const REQUIRED_LABELS = "Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude";

function read(path) { return readFileSync(path, "utf8"); }
function write(path, value) { writeFileSync(path, value); }
function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Reconciliation target not found: ${label}`);
  return source.replace(pattern, replacement);
}

function patchAi() {
  const path = "lib/ai.ts";
  let source = read(path);

  if (!source.includes('from "./ai-trust-boundary"')) {
    source = source.replace(
      /^(import .* from "\.\/ai-provider-health";\n)/m,
      '$1import { protectPrompt } from "./ai-trust-boundary";\n',
    );
  }

  source = source.replace(
    /export const CANONICAL_PROVIDER_CHAIN:[^\n]+\n/,
    `export const CANONICAL_PROVIDER_CHAIN: readonly AiProviderName[] = ${JSON.stringify(REQUIRED_CHAIN)} as const;\n`,
  );

  source = replaceRequired(
    source,
    /const PROVIDER_CHAINS: Record<AiUseCase, AiProviderName\[]> = \{[\s\S]*?\n\};/,
    `const PROVIDER_CHAINS: Record<AiUseCase, AiProviderName[]> = {\n  default:    ${JSON.stringify(REQUIRED_CHAIN)},\n  extraction: ${JSON.stringify(REQUIRED_CHAIN)},\n  proposal:   ${JSON.stringify(REQUIRED_CHAIN)},\n  validation: ${JSON.stringify(REQUIRED_CHAIN)},\n  fast:       ${JSON.stringify(REQUIRED_CHAIN)},\n  reasoning:  ${JSON.stringify(REQUIRED_CHAIN)},\n};`,
    "PROVIDER_CHAINS",
  );

  source = source.replace(
    /export function isAIEnabled\(\) \{[\s\S]*?\n\}/,
    `export function isAIEnabled() {\n  return Boolean(apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || isGroqConfigured() || isDeepSeekConfigured() || anthropicApiKey);\n}`,
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
    .replaceAll("Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude", REQUIRED_LABELS)
    .replaceAll("Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Claude", REQUIRED_LABELS)
    .replaceAll("Gemini → OpenAI → Mistral → DeepSeek → Groq → OpenRouter → Claude", REQUIRED_LABELS)
    .replaceAll("Claude is the preferred provider for proposal generation when configured", "Claude is the final fallback provider for proposal generation when configured");

  write(path, source);
}

function patchHealth() {
  const path = "app/api/ai/health/route.ts";
  let source = read(path);
  source = source.replace(
    /const AI_FALLBACK_CHAIN = ".*?";/,
    `const AI_FALLBACK_CHAIN = "${REQUIRED_LABELS} → deterministic draft fallback";`,
  );
  source = source.replace(
    /const preferredProvider =[\s\S]*?: "none";/,
    `const preferredProvider =\n    geminiConfigured ? "gemini"\n    : openRouterConfigured ? "openrouter"\n    : openaiConfigured ? "openai"\n    : groqConfigured ? "groq"\n    : deepSeekConfigured ? "deepseek"\n    : claudeConfigured ? "claude"\n    : "none";`,
  );

  const ranks = { gemini: 1, openrouter: 2, openai: 3, groq: 4, deepseek: 5, claude: 6, mistral: 99, together: 99 };
  for (const [key, rank] of Object.entries(ranks)) {
    const block = new RegExp(`(${key}: \\{[\\s\\S]*?fallbackRank:) \\d+`, "m");
    source = source.replace(block, `$1 ${rank}`);
  }
  source = source.replaceAll("Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude", REQUIRED_LABELS);
  source = source.replaceAll("Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Claude", REQUIRED_LABELS);
  write(path, source);
}

function patchEnvironmentReadiness() {
  const path = "lib/ai-environment-readiness.ts";
  let source = read(path);
  source = source.replace(
    /  \/\/ Reflect actual PROVIDER_CHAINS order:[\s\S]*?  const blockers: string\[] = \[];/,
    `  // Reflect the required canonical provider order: ${REQUIRED_LABELS}\n  const providerChain: string[] = [];\n  if (present("GEMINI_API_KEY")) providerChain.push(\`Gemini (\${process.env.GEMINI_MODEL || "gemini-2.5-pro"})\`);\n  if (present("OPENROUTER_API_KEY")) providerChain.push(\`OpenRouter (\${process.env.OPENROUTER_PROPOSAL_MODEL || "auto"})\`);\n  if (present("OPENAI_API_KEY")) providerChain.push(\`OpenAI (\${process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o"})\`);\n  if (present("GROQ_API_KEY")) providerChain.push(\`Groq (\${process.env.GROQ_PROPOSAL_MODEL || "llama-3.3-70b-versatile"})\`);\n  if (present("DEEPSEEK_API_KEY")) providerChain.push(\`DeepSeek (\${process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat"})\`);\n  if (present("ANTHROPIC_API_KEY")) providerChain.push("Claude (last-resort)");\n\n  const blockers: string[] = [];`,
  );
  write(path, source);
}

function walk(dir, callback) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", ".next"].includes(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, callback);
    else callback(full);
  }
}

function patchTextReferences() {
  const roots = ["README.md", ".env.example", "docs", "tests", "app", "components", "lib"];
  const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json"]);
  const replacements = [
    "Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude",
    "Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Claude",
    "Gemini → OpenAI → Mistral → DeepSeek → Groq → OpenRouter → Claude",
  ];
  for (const root of roots) {
    try {
      const stat = statSync(root);
      const files = [];
      if (stat.isDirectory()) walk(root, (file) => files.push(file));
      else files.push(root);
      for (const file of files) {
        if (!extensions.has(extname(file))) continue;
        let source = read(file);
        const original = source;
        for (const old of replacements) source = source.replaceAll(old, REQUIRED_LABELS);
        if (source !== original) write(file, source);
      }
    } catch {
      // Optional path absent.
    }
  }
}

patchAi();
patchHealth();
patchEnvironmentReadiness();
patchTextReferences();
console.log(`Reconciled provider policy: ${REQUIRED_LABELS}`);
