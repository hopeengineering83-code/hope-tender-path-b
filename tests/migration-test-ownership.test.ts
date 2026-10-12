import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const serverSuite = readFileSync("tests/screenshot-export-gates-003-server.test.ts", "utf8");
const structuralSuite = readFileSync("tests/screenshot-export-gates-003-structural.test.ts", "utf8");

describe("migration execution ownership", () => {
  it("keeps migrate deploy out of parallel node:test bodies", () => {
    for (const [path, source] of [
      ["tests/screenshot-export-gates-003-server.test.ts", serverSuite],
      ["tests/screenshot-export-gates-003-structural.test.ts", structuralSuite],
    ] as const) {
      assert.doesNotMatch(
        source,
        /execSync\(["']npx prisma migrate deploy["']/,
        `${path} must not mutate shared Prisma migration state from a parallel test body`,
      );
    }
  });

  it("keeps deploy and idempotency verification serialized before the test runner", () => {
    const deployStep = workflow.indexOf("- name: Deploy complete migration history");
    const idempotencyStep = workflow.indexOf("- name: Verify migration idempotency");
    const testStep = workflow.indexOf("- name: Unit and database integration tests");
    assert.ok(deployStep >= 0, "CI must own initial migrate deploy");
    assert.ok(idempotencyStep > deployStep, "CI idempotency check must follow initial deploy");
    assert.ok(testStep > idempotencyStep, "parallel tests must start only after migration checks finish");
    assert.ok(
      (workflow.match(/npx prisma migrate deploy/g) ?? []).length >= 2,
      "CI must execute migrate deploy at least twice to prove idempotency",
    );
  });
});
