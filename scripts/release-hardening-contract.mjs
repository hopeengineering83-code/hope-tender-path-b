import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`RELEASE_CONTRACT_FAILED: ${message}`);
  process.exitCode = 1;
}

function readText(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function readJson(path) {
  const raw = readText(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const vercel = readJson("vercel.json");
// The deployment policy must be an object that explicitly enables deployment
// for main and explicitly disables it for all other branches. This prevents
// accidental preview deployments from feature/fix/experiment branches while
// allowing one production deployment after merge to main.
//
// Vercel uses minimatch for git.deploymentEnabled keys. The single-char `"*"`
// does NOT match branches containing `/` (e.g. `fix/release-candidate`), so
// those branches still get preview deployments. The correct wildcard is `"**"`
// which matches all branches including those with slashes.
if (!vercel) {
  fail("vercel.json is missing or unreadable");
} else if (!vercel.git || !vercel.git.deploymentEnabled) {
  fail("vercel.json must have a git.deploymentEnabled configuration");
} else if (typeof vercel.git.deploymentEnabled === "boolean") {
  fail("vercel.json git.deploymentEnabled must be an object { '**': false, 'main': true }, not a boolean");
} else if (typeof vercel.git.deploymentEnabled !== "object") {
  fail("vercel.json git.deploymentEnabled must be an object");
} else {
  const dep = vercel.git.deploymentEnabled;
  // Must explicitly disable the glob wildcard that covers ALL branches
  // (including those with slashes like fix/release-candidate).
  if (dep["**"] !== false) {
    fail("vercel.json git.deploymentEnabled['**'] must be false to prevent deployments from arbitrary branches (including those with slashes)");
  }
  // Must explicitly enable main.
  if (dep["main"] !== true) {
    fail("vercel.json git.deploymentEnabled['main'] must be true to allow production deployment after merge");
  }
  // Branches explicitly allowed to build PREVIEW deployments on every push.
  // Vercel only creates PRODUCTION deployments from the project's production
  // branch (main), so an entry here can never deploy to production — it only
  // lets the controlled release branch produce a reviewable preview URL per
  // commit (owner-requested, 2026-07-20).
  const PREVIEW_ALLOWED_BRANCHES = new Set(["release/consolidated-recovery-20260717"]);
  // Reject any configuration that silently enables unspecified branches.
  for (const key of Object.keys(dep)) {
    if (key !== "**" && key !== "main" && dep[key] === true && !PREVIEW_ALLOWED_BRANCHES.has(key)) {
      fail(`vercel.json git.deploymentEnabled['${key}'] must not be true — only 'main' (production) and the allowlisted release branch (previews) may deploy`);
    }
  }
}

// The expected order is DERIVED from the catalog, never restated here. This
// list was a hand-written copy that still read Z.ai → Cerebras → Mistral → Groq
// → OpenRouter → Gemini long after the catalog led with Gemini, so the release
// contract was enforcing a withdrawn order against the operator documentation
// and would have failed the moment the docs were corrected to match the code.
const providerCatalog = require("../lib/ai-provider-catalog.cjs");
const PROVIDER_DISPLAY = {
  gemini: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  zai: "Z.ai",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  together: "Together",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
};

const providerDoc = readText("docs/ai-provider-order.md");
// Compare against the numbered runtime chain only. Matching anywhere in the
// document made the check depend on incidental prose ordering.
const chainSection = providerDoc.split(/^## /m).find((section) => section.startsWith("Runtime provider chain")) ?? "";

let previous = -1;
for (const provider of providerCatalog.CANONICAL_AI_PROVIDER_ORDER) {
  const label = PROVIDER_DISPLAY[provider];
  if (!label) {
    fail(`provider-order contract has no display name for catalog provider '${provider}'`);
    continue;
  }
  const index = chainSection.indexOf(label);
  if (index < 0) {
    fail(`provider-order contract is missing ${label}`);
    continue;
  }
  if (index <= previous) {
    fail(`provider-order contract is out of order at ${label}`);
  }
  previous = index;
}

const requiredRules = [
  "Tender controls scope",
  "Company Vault",
  "No invented evidence",
  "Regex",
  "partial",
  "GeneratedDocument",
  "Build Plan",
  "final ZIP",
];

const contract = readText("docs/RELEASE_HARDENING_14_PHASES.md");
for (const rule of requiredRules) {
  if (!contract.toLowerCase().includes(rule.toLowerCase())) {
    fail(`release contract is missing required rule: ${rule}`);
  }
}

if (!process.exitCode) {
  console.log("Release hardening contract passed.");
}
