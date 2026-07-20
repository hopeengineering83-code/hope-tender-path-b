import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
const readiness = readFileSync("lib/ai-environment-readiness.ts", "utf8");

describe("actionable AI readiness diagnostics", () => {
  it("summarizes the runtime before showing low-level variable details", () => {
    assert.match(page, /AI readiness summary/);
    assert.match(page, /Active AI providers/);
    assert.match(page, /Required values missing/);
    assert.match(page, /Actions to review/);
    assert.match(page, /configurationState === "MISSING"/);
  });

  it("provides an explicit deployment remediation sequence", () => {
    assert.match(page, /What to do next/);
    assert.match(page, /Settings → Environment Variables/);
    assert.match(page, /Do not paste secret values into Hope Tender/);
    assert.match(page, /Redeploy the same environment/);
    assert.match(page, /A running deployment cannot read newly added variables until a new deployment starts/);
    assert.match(page, /confirm <strong>Runtime status: ready<\/strong>/);
  });

  it("links remediation to the other canonical admin diagnostics", () => {
    assert.match(page, /href="\/dashboard\/system"/);
    assert.match(page, /Open System Status/);
    assert.match(page, /href="\/dashboard\/admin\/safety-center"/);
    assert.match(page, /Open System Safety Center/);
    assert.match(page, /href="\/dashboard\/admin"/);
    assert.ok((page.match(/min-h-11/g) ?? []).length >= 3, "all remediation links must meet the 44px target contract");
  });

  it("keeps the detailed variable inventory available but collapsed by default", () => {
    assert.match(page, /<details className=/);
    assert.doesNotMatch(page, /<details open/);
    assert.match(page, /Environment variable details \(\{report\.variables\.length\} checks\)/);
    assert.match(page, /<AIEnvironmentVariableStatusList variables=\{report\.variables\} \/>/);
    assert.match(page, /secret values are never returned/);
  });

  it("does not weaken the readiness source of truth or expose environment values", () => {
    assert.match(page, /const report = getAIEnvironmentReadiness\(\)/);
    assert.match(readiness, /ready: blockers\.length === 0/);
    assert.doesNotMatch(page, /process\.env\[/);
    assert.doesNotMatch(page, /variable\.value/);
  });
});
