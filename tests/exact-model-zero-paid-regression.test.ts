import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolveVerifiedModel, runCapabilityTest } from "../lib/ai-provider-capability-test";
import { getProviderModel, type AiProviderName } from "../lib/ai-provider-registry";
import { preflightProvider } from "../lib/ai-preflight";

const originalFetch = globalThis.fetch;
const touchedEnv = new Map<string, string | undefined>();
const outbound = new Map<AiProviderName, string>();

function setEnv(name: string, value: string) {
  if (!touchedEnv.has(name)) touchedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

before(() => {
  setEnv("AI_ZERO_PAID_MODE", "true");
  const configurations = [
    ["ZAI", "glm-4.7-flash"],
    ["MISTRAL", "mistral-small-latest"],
    ["GROQ", "llama-3.1-8b-instant"],
    ["OPENROUTER", "test/account-model:free"],
  ] as const;
  for (const [prefix, model] of configurations) {
    setEnv(`${prefix}_API_KEY`, `test-${prefix.toLowerCase()}-key`);
    setEnv(`${prefix}_PROPOSAL_MODEL`, model);
    setEnv(`${prefix}_ANALYSIS_MODEL`, model);
    setEnv(`${prefix}_FAST_MODEL`, model);
  }
  setEnv("GEMINI_API_KEY", "AIzaTestExactModelKey12345678901234567890");
  setEnv("GEMINI_MODEL", "gemini-2.5-flash");
  setEnv("GEMINI_ANALYSIS_MODEL", "gemini-2.5-flash");
  setEnv("GEMINI_EXTRACTION_MODEL", "gemini-2.5-flash");

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("generativelanguage.googleapis.com")) {
      const match = url.match(/\/models\/([^/:]+):generateContent/);
      assert.ok(match, `Gemini request did not carry a model: ${url}`);
      outbound.set("gemini", decodeURIComponent(match[1]));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const provider: AiProviderName = url.includes("api.groq.com") ? "groq"
      : url.includes("api.mistral.ai") ? "mistral"
      : url.includes("openrouter.ai") ? "openrouter" : "zai";
    assert.ok(body.model, `${provider} request did not carry a model`);
    outbound.set(provider, body.model);
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of touchedEnv) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe("one exact model identity from diagnostic to outbound request", () => {
  for (const provider of ["gemini", "groq", "mistral", "zai", "openrouter"] as const) {
    it(`${provider}: configured = resolved = diagnostic = outbound`, async () => {
      const configured = getProviderModel(provider, "fast");
      const resolved = await resolveVerifiedModel(provider, "fast", [configured]);
      assert.equal(resolved.model, configured);
      const preflight = preflightProvider(provider, "diagnostic prompt", {
        useCase: "fast", modelOverride: resolved.model ?? undefined,
      });
      assert.equal(preflight.model, configured);
      assert.equal(preflight.eligible, true);
      const result = await runCapabilityTest(provider, "connectivity", {
        model: resolved.model ?? undefined,
        modelConfirmedByProvider: resolved.confirmedByProvider,
      });
      assert.equal(result.status, "ok", result.safeMessage ?? undefined);
      assert.equal(result.model, configured);
      assert.equal(outbound.get(provider), configured);
    });
  }
});

describe("zero-paid model selection fails closed", () => {
  it("never selects arbitrary models[0] or an unknown-cost configured model", async () => {
    const resolved = await resolveVerifiedModel("mistral", "extraction", ["unknown-paid-model"], {
      AI_ZERO_PAID_MODE: "true", MISTRAL_API_KEY: "present",
      MISTRAL_ANALYSIS_MODEL: "unknown-paid-model", MISTRAL_PROPOSAL_MODEL: "unknown-paid-model",
    });
    assert.equal(resolved.model, null);
    assert.equal(resolved.source, "no-proven-free-model");
  });

  it("skips an unknown-cost model with zero outbound requests", async () => {
    outbound.delete("mistral");
    const result = await runCapabilityTest("mistral", "connectivity", {
      model: "unknown-paid-model",
      env: { ...process.env, AI_ZERO_PAID_MODE: "true" },
    });
    assert.equal(result.status, "skipped");
    assert.equal(result.durationMs, 0);
    assert.equal(outbound.has("mistral"), false);
  });

  it("contains no retired Groq runtime default", () => {
    const registry = readFileSync("lib/ai-provider-registry.ts", "utf8");
    assert.doesNotMatch(registry, /llama-3\.3-70b-versatile/);
    assert.equal(getProviderModel("groq", "proposal", {}), "");
  });
});
