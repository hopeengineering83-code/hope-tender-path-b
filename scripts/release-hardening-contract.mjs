import fs from "node:fs";

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
if (vercel?.git?.deploymentEnabled !== false) {
  fail("vercel.json must keep git.deploymentEnabled=false while release hardening is active");
}

const providerDoc = readText("docs/ai-provider-order.md");
const providers = [
  "Z.ai",
  "Cerebras",
  "Mistral",
  "Groq",
  "OpenRouter",
  "Gemini",
  "OpenAI",
  "Together",
  "DeepSeek",
  "Anthropic",
];

let previous = -1;
for (const provider of providers) {
  const index = providerDoc.indexOf(provider);
  if (index < 0) {
    fail(`provider-order contract is missing ${provider}`);
    continue;
  }
  if (index <= previous) {
    fail(`provider-order contract is out of order at ${provider}`);
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
