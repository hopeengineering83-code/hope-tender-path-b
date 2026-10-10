import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { testProviderCapabilities, testAutomaticChainCapabilities } from "../lib/ai-provider-capability-test";
import { redactSecrets } from "../lib/sanitize-error";

// ─── What this file proves ───────────────────────────────────────────────────
//
// The operator diagnostic sends real credentials to real providers and renders
// whatever comes back. Providers routinely quote the request they rejected —
// including the Authorization header — so "the provider told us" is a direct
// path from a stored API key to an admin screen and an audit log.
//
// These tests drive the real report builder against providers that echo the
// credential back, then assert on the SERIALISED payload: what an operator
// would actually receive. Distinctive canaries are used so a leak cannot hide
// behind a plausible-looking string.
//
// They also pin the useful half: redaction that removed provider, model,
// category, timing or the safe message would "pass" a naive leak test while
// destroying the only reason the diagnostic exists.

// Canaries. Each is a shape a real provider key takes.
const CANARIES = {
  groq: "gsk_CANARY000111222333444555666777888",
  // Deliberately opaque: no recognisable prefix at all. Mistral keys look like
  // this, and a prefix-only redactor cannot see them — the Authorization
  // header rule is what has to catch it.
  mistral: "CANARYopaque9f8e7d6c5b4a3928170695",
  gemini: "AIzaCANARY0123456789abcdefghijklmnopq",
} as const;

const originalFetch = globalThis.fetch;
const touchedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string) {
  if (!touchedEnv.has(name)) touchedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

function headerValue(init: RequestInit | undefined, name: string): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return String(headers[name] ?? headers[name.toLowerCase()] ?? "");
}

before(() => {
  setEnv("GROQ_API_KEY", CANARIES.groq);
  setEnv("MISTRAL_API_KEY", CANARIES.mistral);
  setEnv("GEMINI_API_KEY", CANARIES.gemini);
  for (const prefix of ["GROQ", "MISTRAL"]) {
    setEnv(`${prefix}_PROPOSAL_MODEL`, "canary-model");
    setEnv(`${prefix}_ANALYSIS_MODEL`, "canary-model");
    setEnv(`${prefix}_FAST_MODEL`, "canary-model");
  }
  setEnv("GEMINI_MODEL", "canary-model");
  setEnv("GEMINI_ANALYSIS_MODEL", "canary-model");
  setEnv("GEMINI_EXTRACTION_MODEL", "canary-model");
  for (const prefix of ["ZAI", "CEREBRAS", "OPENROUTER", "OPENAI", "TOGETHER", "DEEPSEEK", "ANTHROPIC"]) {
    setEnv(`${prefix}_API_KEY`, "");
  }

  // A maximally hostile provider: it rejects the request and quotes back the
  // credential, the full Authorization header AND the entire request body
  // (which contains the system prompt and the prompt text).
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const auth = headerValue(init, "Authorization") || headerValue(init, "x-goog-api-key");
    const requestBody = String(init?.body ?? "");

    if (url.pathname.endsWith("/models") || url.pathname === "/v1beta/models") {
      return new Response(JSON.stringify({ data: [{ id: "canary-model" }], models: [{ name: "models/canary-model" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      error: {
        message: `Invalid API key '${auth}'. Authorization: ${auth}. Rejected request body: ${requestBody}`,
        authorization_header: auth,
        raw_request: requestBody,
      },
    }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of touchedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** What the operator actually receives, as text. */
async function serialisedReportFor(provider: "groq" | "mistral" | "gemini") {
  const report = await testProviderCapabilities(provider, { capabilities: ["connectivity", "analysis"] });
  return { report, payload: JSON.stringify(report) };
}

describe("diagnostic payloads never carry credentials", () => {
  for (const provider of ["groq", "mistral", "gemini"] as const) {
    it(`does not leak the ${provider} API key value`, async () => {
      const { payload } = await serialisedReportFor(provider);
      assert.equal(
        payload.includes(CANARIES[provider]),
        false,
        `${provider} diagnostic payload contained the API key value`,
      );
    });

    it(`does not leak the ${provider} Authorization header or bearer token`, async () => {
      const { payload } = await serialisedReportFor(provider);
      // No live bearer token, in any casing, anywhere in the payload.
      assert.doesNotMatch(payload, /Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._-]{8,}/i);
      assert.doesNotMatch(payload, /x-goog-api-key["\s:]+[A-Za-z0-9._-]{8,}/i);
    });
  }

  it("does not leak a key value across a whole-chain run", async () => {
    const run = await testAutomaticChainCapabilities({ capabilities: ["connectivity"] });
    const payload = JSON.stringify(run);
    for (const canary of Object.values(CANARIES)) {
      assert.equal(payload.includes(canary), false, "chain run payload contained an API key value");
    }
    assert.doesNotMatch(payload, /Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._-]{8,}/i);
  });
});

describe("diagnostic payloads never carry prompts, tender text or raw bodies", () => {
  it("does not echo a whole prompt or request body back to the operator", async () => {
    const { payload } = await serialisedReportFor("groq");
    // The hostile provider returned the entire request body. Whatever survives
    // must be a short, bounded excerpt — not the message array in full.
    assert.doesNotMatch(payload, /"role"\s*:\s*"user"[\s\S]*"role"\s*:\s*"system"/);
    assert.doesNotMatch(payload, /Respond ONLY with valid JSON/);
  });

  it("bounds every safe message so an unbounded provider body cannot be relayed", async () => {
    const { report } = await serialisedReportFor("groq");
    for (const result of report.results) {
      if (!result.safeMessage) continue;
      assert.ok(
        result.safeMessage.length <= 300,
        `safeMessage was ${result.safeMessage.length} chars — an unbounded provider body is a relay, not a diagnostic`,
      );
    }
  });

  it("never sends real tender text to a provider in the first place", () => {
    // The strongest guarantee available: the diagnostic has no tender in scope.
    // Its analysis probe is a fixed synthetic document compiled into the module,
    // so there is no path by which a customer's tender could reach a provider
    // or a report through this route.
    const source = readFileSync("lib/ai-provider-capability-test.ts", "utf8");
    assert.match(source, /const SYNTHETIC_TENDER_TEXT = `/);
    assert.match(source, /Alpha Bridge/);
    // No tender, file or extracted-text lookup anywhere in the module.
    assert.doesNotMatch(source, /prisma\./);
    assert.doesNotMatch(source, /extractedText/);
  });
});

describe("diagnostic payloads keep the fields that make them useful", () => {
  it("still reports provider, model, category, timing and a safe message", async () => {
    const { report } = await serialisedReportFor("groq");
    assert.equal(report.provider, "groq");
    assert.equal(report.resolvedModel, "canary-model");

    const failure = report.results.find((result) => result.status === "failed");
    assert.ok(failure, "the canary provider returns 401, so a failure must be reported");
    assert.equal(failure.provider, "groq");
    assert.equal(failure.model, "canary-model");
    assert.equal(failure.category, "AUTH");
    assert.equal(typeof failure.durationMs, "number");
    assert.ok(failure.safeMessage && failure.safeMessage.length > 0, "a redacted diagnostic is still a diagnostic");
    // The operator must be able to tell WHY without seeing the credential.
    assert.match(failure.safeMessage, /401|auth/i);
  });

  it("still reports configuration facts and cooldown/eligibility state", async () => {
    const { report } = await serialisedReportFor("groq");
    assert.equal(report.keyPresent, true);
    assert.equal(report.modelConfigured, true);
    assert.equal(report.eligible, true);
    assert.equal(typeof report.eligibilityReason, "string");
    assert.equal(typeof report.diagnosticState, "string");
  });
});

describe("there is one redactor, not several disagreeing copies", () => {
  it("the shared redactor removes bearer tokens and opaque keys quoted by a provider", () => {
    const echoed = `Invalid API key 'Bearer ${CANARIES.mistral}'.`;
    assert.equal(redactSecrets(echoed).includes(CANARIES.mistral), false);
  });

  it("lib/ai.ts carries no private redaction regex of its own", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    // Four sites here each had their own weaker pattern; none matched
    // `Bearer <token>`, so a provider that echoed the Authorization header
    // printed a live credential into the logs.
    assert.doesNotMatch(source, /\.replace\(\/\(?sk[-_|]/);
    assert.doesNotMatch(source, /"\[REDACTED\]"\)\.slice\(0, 200\)/);
    assert.match(source, /redactSecrets\(body\)/);
    assert.match(source, /redactSecrets\(data\.error\.message\)/);
  });

  it("the workflow runner's safe message routes through the shared redactor", () => {
    const source = readFileSync("lib/engine/tender-workflow-runner.ts", "utf8");
    assert.match(source, /return redactSecrets\(message\)/);
  });

  it("no diagnostic route reads an API key value into its response", () => {
    for (const path of [
      "app/api/admin/ai-provider-health/test/route.ts",
      "app/api/ai-providers/diagnostics/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(source, /process\.env\.[A-Z_]*API_KEY/, `${path} reads a key value directly`);
      assert.doesNotMatch(source, /readProviderKey/, `${path} reads a key value directly`);
    }
  });
});
