import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import playwrightConfig from "../playwright.config";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("exact-head CI evidence completeness", () => {
  it("uses one command recorder and a machine-readable ledger", () => {
    assert.equal(existsSync("scripts/run-evidence-command.mjs"), true);
    assert.equal(existsSync("scripts/verify-ci-evidence.mjs"), true);
    assert.match(workflow, /run-evidence-command\.mjs/);
    assert.match(workflow, /command-ledger\.ndjson/);
    assert.match(workflow, /verify-ci-evidence\.mjs/);
  });

  it("keeps Playwright cleanup outside the immutable command-evidence directory", () => {
    assert.equal(playwrightConfig.outputDir, "./browser-results/test-artifacts");
    assert.notEqual(playwrightConfig.outputDir, "test-results");
    assert.notEqual(playwrightConfig.outputDir, "./test-results");
  });

  it("retains every mandatory success log, not only build and migration fragments", () => {
    for (const requiredLog of [
      "prisma-validate.log",
      "prisma-generate.log",
      "migrate-deploy.log",
      "critical-schema.log",
      "retroactive-init.log",
      "migrate-idempotency.log",
      "prisma-zero-drift.log",
      "release-integrity-audit.log",
      "typecheck.log",
      "lint.log",
      "npm-test.log",
      "npm-build.log",
      "playwright.log",
    ]) {
      assert.ok(workflow.includes(requiredLog), `CI must retain ${requiredLog}`);
    }
  });

  it("publishes exact-head acceptance only after success and fails on missing evidence", () => {
    const exactUpload = workflow.slice(
      workflow.indexOf("- name: Upload credential-free exact-head acceptance evidence"),
      workflow.indexOf("- name: Upload non-browser diagnostics"),
    );
    assert.match(exactUpload, /if:\s*success\(\)/);
    assert.match(exactUpload, /test-results\//);
    assert.match(exactUpload, /browser-results\//);
    assert.match(exactUpload, /if-no-files-found:\s*error/);
    assert.doesNotMatch(exactUpload, /if-no-files-found:\s*warn/);
  });
});
