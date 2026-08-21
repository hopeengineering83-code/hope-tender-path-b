import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolveVerifiedModel, runCapabilityTest, testProviderCapabilities } from "../lib/ai-provider-capability-test";
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
    const requestUrl = new URL(String(input instanceof Request ? input.url : input));
    if (requestUrl.hostname === "generativelanguage.googleapis.com") {
      if (requestUrl.pathname === "/v1beta/models") {
        return new Response(JSON.stringify({ models: [
          { name: "models/gemini-2.5-flash" },
          { name: "models/gemini-2.0-flash" },
          { name: "models/gemini-flash-latest" },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const match = requestUrl.pathname.match(/\/models\/([^/:]+):generateContent$/);
      assert.ok(match, `Gemini request did not carry a model: ${requestUrl.toString()}`);
      outbound.set("gemini", decodeURIComponent(match[1]));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const providerByHostname: Partial<Record<string, AiProviderName>> = {
      "api.groq.com": "groq",
      "api.mistral.ai": "mistral",
      "openrouter.ai": "openrouter",
      "api.z.ai": "zai",
    };
    const provider = providerByHostname[requestUrl.hostname];
    assert.ok(provider, `Unexpected provider request host: ${requestUrl.hostname}`);
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

describe("effective configured model selection", () => {
  it("uses the configured model and never substitutes arbitrary models[0]", async () => {
    const resolved = await resolveVerifiedModel("mistral", "extraction", ["unknown-paid-model"], {
      NODE_ENV: "test",
      AI_ZERO_PAID_MODE: "true", MISTRAL_API_KEY: "present",
      MISTRAL_ANALYSIS_MODEL: "unknown-paid-model", MISTRAL_PROPOSAL_MODEL: "unknown-paid-model",
    });
    assert.equal(resolved.model, "unknown-paid-model");
    assert.equal(resolved.source, "configured");
  });

  it("calls the exact configured model without a custom cost policy", async () => {
    outbound.delete("mistral");
    const result = await runCapabilityTest("mistral", "connectivity", {
      model: "unknown-paid-model",
      env: { ...process.env, AI_ZERO_PAID_MODE: "true" },
    });
    assert.equal(result.status, "ok");
    assert.equal(outbound.has("mistral"), true);
  });

  it("contains no retired Groq runtime default", () => {
    const registry = readFileSync("lib/ai-provider-registry.ts", "utf8");
    assert.doesNotMatch(registry, /llama-3\.3-70b-versatile/);
    assert.equal(getProviderModel("groq", "proposal", { NODE_ENV: "test" }), "");
  });

  it("reports a present key and configured model without policy blocking", async () => {
    const report = await testProviderCapabilities("groq", {
      capabilities: ["analysis"],
      env: {
        NODE_ENV: "test", AI_ZERO_PAID_MODE: "true", GROQ_API_KEY: "present",
        GROQ_PROPOSAL_MODEL: "unknown-cost-model",
        GROQ_ANALYSIS_MODEL: "unknown-cost-model",
        GROQ_FAST_MODEL: "unknown-cost-model",
      },
    });
    assert.equal(report.keyPresent, true);
    assert.equal(report.modelConfigured, true);
    assert.equal(report.modelFreePolicy, false);
    assert.equal(report.modelVisible, null);
    assert.notEqual(report.diagnosticState, "MODEL_POLICY_BLOCKED");
    assert.notEqual(report.results[0]?.status, "skipped");
  });

  it("resolves each capability against its actual fast/analysis/proposal model", async () => {
    outbound.delete("gemini");
    const report = await testProviderCapabilities("gemini", {
      capabilities: ["connectivity", "analysis", "generation"],
      env: {
        NODE_ENV: "test", AI_ZERO_PAID_MODE: "true",
        GEMINI_API_KEY: "AIzaTestExactModelKey12345678901234567890",
        GEMINI_MODEL: "gemini-2.5-flash",
        GEMINI_ANALYSIS_MODEL: "gemini-2.0-flash",
        GEMINI_EXTRACTION_MODEL: "gemini-flash-latest",
      },
    });
    assert.deepEqual(report.resolvedModels, {
      proposal: "gemini-2.5-flash",
      extraction: "gemini-2.0-flash",
      fast: "gemini-flash-latest",
    });
    assert.deepEqual(report.results.map((result) => result.model), [
      "gemini-flash-latest",
      "gemini-2.0-flash",
      // The analysis mock returns only "OK", so generation is intentionally
      // not reached after structured-analysis validation fails.
    ]);
  });
});
