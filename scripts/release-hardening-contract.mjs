import fs from "node:fs";

function fail(message) {
  console.error(`RELEASE_CONTRACT_FAILED: ${message}`);
  process.exitCode = 1;
}

const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
if (vercel?.git?.deploymentEnabled !== false) {
  fail("vercel.json must keep git.deploymentEnabled=false while release hardening is active");
}

const providerDoc = fs.readFileSync("docs/ai-provider-order.md", "utf8");
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

if (!providerDoc.includes("Anthropic")) {
  fail("Anthropic must remain the final provider");
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

const contract = fs.readFileSync("docs/RELEASE_HARDENING_14_PHASES.md", "utf8");
for (const rule of requiredRules) {
  if (!contract.toLowerCase().includes(rule.toLowerCase())) {
    fail(`release contract is missing required rule: ${rule}`);
  }
}

if (!process.exitCode) {
  console.log("Release hardening contract passed.");
}
