#!/usr/bin/env node
// Provider smoke test — exercises each configured AI provider against a
// sanitized synthetic tender excerpt and reports analysis/fallback results.
//
// Usage:
//   node scripts/provider-smoke-test.mjs
//
// It reads provider keys from the environment (never prints them), sends one
// small structured-analysis request per CONFIGURED provider using that
// provider's registry endpoint/model/request-format, and validates the JSON
// locally. It NEVER deploys, never writes to the DB, and never prints secrets
// or raw provider bodies.
//
// This script is intentionally dependency-free (uses global fetch) and mirrors
// the registry contract. Providers that are not configured are skipped.

const SYNTHETIC_TENDER = `
[FILE_ID:doc-1|FILE_NAME:tender.pdf]
PROJECT: Alpha Bridge Construction Supervision
Procuring Entity: National Roads Authority
Reference: NRA/RFP/2026/014
Submission Deadline: 2026-12-31 17:00 local time
Submission Email: procurement@nra.example.gov
Requirements:
1. Valid Professional Indemnity Insurance of at least USD 10,000,000.
2. At least 10 years of experience supervising bridge construction.
3. Submit technical and financial proposals in separate sealed envelopes.
`;

const PROMPT =
  "Analyze the following synthetic tender excerpt. Return ONLY a JSON object with " +
  "keys: summary (string), procuringEntityName (string|null), reference (string|null), " +
  "submissionDeadline (string|null), oneRequirement (object with title, priority). " +
  "No markdown, no prose.\n\nTENDER:\n" +
  SYNTHETIC_TENDER;

// Registry mirror (kept in sync with lib/ai-provider-registry.ts). Order is the
// canonical automatic provider order.
const PROVIDERS = [
  { id: "zai", label: "Z.ai GLM", keyEnv: "ZAI_API_KEY", baseEnv: "ZAI_BASE_URL", baseDefault: "https://api.z.ai/api/paas/v4", modelEnv: "ZAI_ANALYSIS_MODEL", modelDefault: "glm-4.7-flash", format: "openai", tokenParam: "max_tokens", cap: 3000, json: true },
  { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY", baseEnv: "CEREBRAS_BASE_URL", baseDefault: "https://api.cerebras.ai/v1", modelEnv: "CEREBRAS_ANALYSIS_MODEL", modelDefault: "gpt-oss-120b", format: "openai", tokenParam: "max_completion_tokens", cap: 3000, json: true },
  { id: "mistral", label: "Mistral", keyEnv: "MISTRAL_API_KEY", baseEnv: "MISTRAL_BASE_URL", baseDefault: "https://api.mistral.ai/v1", modelEnv: "MISTRAL_ANALYSIS_MODEL", modelDefault: "mistral-large-latest", format: "openai", tokenParam: "max_tokens", cap: 4000, json: false },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", baseEnv: "GROQ_BASE_URL", baseDefault: "https://api.groq.com/openai/v1", modelEnv: "GROQ_ANALYSIS_MODEL", modelDefault: "", format: "openai", tokenParam: "max_tokens", cap: 4000, json: false },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", baseEnv: "OPENROUTER_BASE_URL", baseDefault: "https://openrouter.ai/api/v1", modelEnv: "OPENROUTER_ANALYSIS_MODEL", modelDefault: "", format: "openai", tokenParam: "max_tokens", cap: 4000, json: false, freeOnly: true },
];

function readKey(env) {
  const v = process.env[env];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function validateJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: "NO_JSON" };
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.summary !== "string") return { ok: false, reason: "MALFORMED_RESPONSE (missing summary)" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "MALFORMED_RESPONSE (invalid JSON)" };
  }
}

async function testProvider(p) {
  const key = readKey(p.keyEnv);
  if (!key) return { provider: p.label, status: "SKIPPED", detail: "not configured" };

  const base = (process.env[p.baseEnv]?.trim() || p.baseDefault).replace(/\/+$/, "");
  let model = process.env[p.modelEnv]?.trim() || p.modelDefault;
  if (p.freeOnly) {
    const configured = (process.env.OPENROUTER_PROPOSAL_MODEL || process.env.OPENROUTER_ANALYSIS_MODEL || "").trim();
    if (!configured || configured.toLowerCase() === "openrouter/auto" || !configured.endsWith(":free")) {
      return { provider: p.label, status: "SKIPPED", detail: "OpenRouter requires an explicit ':free' model (CONFIGURATION_INVALID)" };
    }
    model = configured;
  }
  if (!model) return { provider: p.label, status: "SKIPPED", detail: "no model configured" };

  const body = {
    model,
    [p.tokenParam]: p.cap,
    temperature: 0,
    messages: [
      { role: "system", content: "You are a senior tender analyst. Output ONLY a valid JSON object." },
      { role: "user", content: PROMPT },
    ],
  };
  if (p.json) body.response_format = { type: "json_object" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const started = Date.now();
  try {
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    if (p.id === "openrouter") {
      headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "https://hope-tender-path-b.vercel.app";
      headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "Hope Tender Proposal Generator";
    }
    const res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (!res.ok) {
      // Never print the raw body — only the status category.
      const category = res.status === 429 ? "RATE_LIMITED" : res.status === 401 || res.status === 403 ? "UNAUTHORIZED" : res.status === 402 ? "BILLING_BLOCKED" : `HTTP_${res.status}`;
      return { provider: p.label, status: "FAILED", detail: category, ms };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const validation = validateJson(text);
    return { provider: p.label, status: validation.ok ? "OK" : "INVALID_JSON", detail: validation.ok ? `${model}` : validation.reason, ms };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const category = /abort|timeout/i.test(msg) ? "TIMEOUT" : "NETWORK_ERROR";
    return { provider: p.label, status: "FAILED", detail: category, ms };
  }
}

async function main() {
  console.log("Provider smoke test — synthetic tender excerpt (no secrets printed)\n");
  const results = [];
  for (const p of PROVIDERS) {
    // Sequential — never run providers in parallel (mirrors runtime policy).
    results.push(await testProvider(p));
  }
  for (const r of results) {
    const ms = r.ms != null ? ` (${r.ms}ms)` : "";
    console.log(`  ${r.status.padEnd(10)} ${r.provider.padEnd(12)} — ${r.detail}${ms}`);
  }
  const verified = results.filter((r) => r.status === "OK").map((r) => r.provider);
  const failed = results.filter((r) => r.status === "FAILED" || r.status === "INVALID_JSON");
  console.log(`\nVerified: ${verified.length ? verified.join(", ") : "none"}`);
  if (failed.length) console.log(`Could not verify: ${failed.map((r) => `${r.provider} (${r.detail})`).join(", ")}`);
  console.log("\nNote: this script does not deploy, write to the DB, or modify Vercel secrets.");
}

main().catch((e) => { console.error("Smoke test failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
