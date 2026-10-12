import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AIEnvironmentVariableStatusList,
  getConfigurationState,
  getSeverityLabel,
  groupEnvironmentVariables,
} from "../components/ai-environment-variable-status";
import type { AIEnvironmentVariableStatus } from "../lib/ai-environment-readiness";
import { getAIEnvironmentReadiness } from "../lib/ai-environment-readiness";
import { CANONICAL_AI_PROVIDER_ORDER, getProviderRegistry, isProviderConfigured } from "../lib/ai-provider-registry";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function variable(overrides: Partial<AIEnvironmentVariableStatus> & Pick<AIEnvironmentVariableStatus, "name">): AIEnvironmentVariableStatus {
  return {
    present: false,
    scope: "runtime",
    severity: "optional",
    configurationState: "OPTIONAL",
    requirementLabel: "optional",
    note: "Test variable",
    ...overrides,
  };
}

describe("post-1162 UI truth and responsive contracts", () => {
  it("renders complete variable truth in both desktop and mobile views", () => {
    const variables = [
      variable({ name: "OCR_KEY", scope: "ocr", severity: "recommended", configurationState: "RECOMMENDED", requirementLabel: "recommended", note: "OCR purpose" }),
      variable({ name: "AI_KEY_WITH_A_VERY_LONG_UNBROKEN_NAME", present: true, scope: "ai", severity: "critical", configurationState: "SET", requirementLabel: "alternative provider", note: "AI purpose" }),
      variable({ name: "DATABASE_URL", scope: "database", severity: "critical", configurationState: "MISSING", requirementLabel: "required", note: "Persistent database" }),
      variable({ name: "OPENAI_BASE_URL", scope: "ai", configurationState: "INACTIVE", note: "Inactive provider override" }),
    ];
    const html = renderToStaticMarkup(
      React.createElement(AIEnvironmentVariableStatusList, { variables }),
    );

    assert.match(html, /aria-label="Environment variables"/);
    assert.match(html, /aria-label="Environment variables by scope"/);
    assert.equal((html.match(/AI_KEY_WITH_A_VERY_LONG_UNBROKEN_NAME/g) ?? []).length, 2);
    assert.equal((html.match(/OCR_KEY/g) ?? []).length, 2);
    assert.match(html, /<dt[^>]*>Scope<\/dt>/);
    assert.match(html, /<dt[^>]*>Severity<\/dt>/);
    assert.match(html, /<dt[^>]*>Purpose<\/dt>/);
    assert.match(html, /break-all/);
    assert.match(html, /min-h-11/);
    assert.match(html, />SET<\/span>/);
    assert.match(html, />MISSING<\/span>/);
    assert.match(html, />RECOMMENDED<\/span>/);
    assert.match(html, />INACTIVE<\/span>/);
  });

  it("groups AI variables by canonical provider before functional groups", () => {
    const groups = groupEnvironmentVariables([
      variable({ name: "SESSION_SECRET", present: true, scope: "auth", severity: "critical", configurationState: "SET", requirementLabel: "required", note: "Auth" }),
      variable({ name: "DATABASE_URL", present: true, scope: "database", severity: "critical", configurationState: "SET", requirementLabel: "required", note: "DB" }),
      variable({ name: "OPENAI_API_KEY", present: true, scope: "ai", severity: "critical", configurationState: "SET", requirementLabel: "alternative provider", note: "OpenAI" }),
      variable({ name: "ZAI_API_KEY", present: true, scope: "ai", severity: "critical", configurationState: "SET", requirementLabel: "alternative provider", note: "Z.ai" }),
    ]);

    assert.deepEqual(groups.map((group) => group.label), ["Z.ai", "OpenAI", "Database", "Authentication"]);
    assert.deepEqual(groups.map((group) => group.variables[0]?.name), ["ZAI_API_KEY", "OPENAI_API_KEY", "DATABASE_URL", "SESSION_SECRET"]);
  });

  it("distinguishes true blockers from alternatives, defaults, and optional configuration", () => {
    assert.equal(getConfigurationState(variable({ name: "DATABASE_URL", configurationState: "MISSING" })).label, "MISSING");
    assert.equal(getConfigurationState(variable({ name: "ZAI_API_KEY", configurationState: "NOT_CONFIGURED" })).label, "NOT CONFIGURED");
    assert.equal(getConfigurationState(variable({ name: "ZAI_BASE_URL", configurationState: "DEFAULTED", note: "Copy may change without changing state" })).label, "DEFAULTED");
    assert.equal(getConfigurationState(variable({ name: "PDF_OCR_MODEL", configurationState: "RECOMMENDED" })).label, "RECOMMENDED");
    assert.equal(getConfigurationState(variable({ name: "OPTIONAL_FLAG", configurationState: "OPTIONAL" })).label, "OPTIONAL");
    assert.equal(getSeverityLabel(variable({ name: "ZAI_API_KEY", requirementLabel: "alternative provider" })), "alternative provider");
    assert.equal(getSeverityLabel(variable({ name: "DATABASE_URL", requirementLabel: "required" })), "required");
  });

  it("receives configuration truth explicitly from the readiness resolver", () => {
    const names = ["ZAI_API_KEY", "ZAI_BASE_URL", "DATABASE_URL", "PDF_OCR_MODEL"];
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => delete process.env[name]);
    try {
      const variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("ZAI_API_KEY")?.configurationState, "NOT_CONFIGURED");
      assert.equal(variables.get("ZAI_API_KEY")?.requirementLabel, "alternative provider");
      assert.equal(variables.get("ZAI_BASE_URL")?.configurationState, "INACTIVE");
      assert.equal(variables.get("DATABASE_URL")?.configurationState, "MISSING");
      assert.equal(variables.get("DATABASE_URL")?.requirementLabel, "required");
      assert.equal(variables.get("PDF_OCR_MODEL")?.configurationState, "INACTIVE");
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });

  it("covers every canonical provider override and mirrors registry defaults", () => {
    const reportVariables = getAIEnvironmentReadiness().variables;
    const variables = new Map(reportVariables.map((item) => [item.name, item]));
    assert.equal(variables.size, reportVariables.length, "readiness variables must not contain duplicate names");
    const registry = getProviderRegistry();
    for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
      const entry = registry[provider];
      assert.ok(variables.has(entry.env.apiKey), `${provider} API key must be reported`);
      const overrides = [
        [entry.env.baseUrl, entry.defaults.baseUrl],
        [entry.env.proposalModel, entry.defaults.proposalModel],
        [entry.env.analysisModel, entry.defaults.analysisModel],
        [entry.env.fastModel, entry.defaults.fastModel],
      ] as const;
      for (const [name, fallback] of overrides) {
        if (!name) continue;
        assert.ok(variables.has(name), `${provider} override ${name} must be reported`);
        if (!isProviderConfigured(provider)) {
          assert.equal(variables.get(name)?.configurationState, "INACTIVE", `${name} must be inactive without its provider`);
        } else if (!process.env[name] && fallback) {
          assert.equal(variables.get(name)?.configurationState, "DEFAULTED", `${name} must mirror its registry default`);
        }
      }
    }
  });

  it("uses provider aliases and only activates defaults for usable providers", () => {
    const names = ["DEEPSEEK_API_KEY", "DEEP_SEEK_API_KEY", "DEEPSEEK_KEY", "DEEPSEEK_BASE_URL"];
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => delete process.env[name]);
    try {
      let variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("DEEPSEEK_API_KEY")?.configurationState, "NOT_CONFIGURED");
      assert.equal(variables.get("DEEPSEEK_BASE_URL")?.configurationState, "INACTIVE");

      process.env.DEEP_SEEK_API_KEY = "alias-only-test-key";
      variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("DEEPSEEK_API_KEY")?.configurationState, "SET");
      assert.equal(variables.get("DEEPSEEK_API_KEY")?.present, true);
      assert.equal(variables.get("DEEPSEEK_BASE_URL")?.configurationState, "DEFAULTED");
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });

  it("keeps provider extras and OCR settings inactive until their dependencies are usable", () => {
    const names = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_FALLBACK_MODELS", "ANTHROPIC_TIER", "PDF_OCR_ENABLED", "PDF_OCR_MODEL"];
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => delete process.env[name]);
    try {
      let variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("GEMINI_FALLBACK_MODELS")?.configurationState, "INACTIVE");
      assert.equal(variables.get("ANTHROPIC_TIER")?.configurationState, "INACTIVE");
      assert.equal(variables.get("PDF_OCR_ENABLED")?.configurationState, "INACTIVE");
      assert.equal(variables.get("PDF_OCR_MODEL")?.configurationState, "INACTIVE");

      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("GEMINI_FALLBACK_MODELS")?.configurationState, "DEFAULTED");
      assert.equal(variables.get("ANTHROPIC_TIER")?.configurationState, "RECOMMENDED");
      assert.equal(variables.get("PDF_OCR_ENABLED")?.configurationState, "DEFAULTED");
      assert.equal(variables.get("PDF_OCR_MODEL")?.configurationState, "DEFAULTED");

      process.env.PDF_OCR_ENABLED = "false";
      variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("PDF_OCR_ENABLED")?.configurationState, "DISABLED");
      assert.equal(variables.get("PDF_OCR_MODEL")?.configurationState, "INACTIVE");

      process.env.PDF_OCR_ENABLED = "true";
      variables = new Map(getAIEnvironmentReadiness().variables.map((item) => [item.name, item]));
      assert.equal(variables.get("PDF_OCR_ENABLED")?.configurationState, "ENABLED");
      assert.equal(variables.get("PDF_OCR_MODEL")?.configurationState, "DEFAULTED");
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });

  it("does not label planned and empty document workspaces as generated", () => {
    const page = source("app/dashboard/documents/page.tsx");

    assert.doesNotMatch(page, />Generated Documents<\/h1>/);
    assert.match(page, />Proposal Documents<\/h1>/);
    assert.match(page, /No proposal documents yet\. Build a submission plan and generate the required outputs/);
  });

  it("labels root links as home navigation", () => {
    for (const path of ["app/not-found.tsx", "app/error.tsx"]) {
      const page = source(path);
      assert.match(page, /href="\/"/);
      assert.match(page, /Return home/);
      assert.doesNotMatch(page, /Return to dashboard/);
    }
  });
});
