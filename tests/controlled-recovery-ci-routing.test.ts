import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("controlled recovery CI routing", () => {
  it("runs the full CI job for pull requests and pushes on integration/controlled-recovery", () => {
    const occurrences = workflow.match(/- integration\/controlled-recovery/g) ?? [];
    assert.equal(occurrences.length, 2, "controlled recovery must be listed under both pull_request and push");
  });

  it("runs a real Prisma zero-drift check after migration deployment", () => {
    assert.match(workflow, /name: Verify Prisma zero drift/);
    assert.match(workflow, /--from-schema-datasource prisma\/schema\.prisma/);
    assert.match(workflow, /--to-schema-datamodel prisma\/schema\.prisma/);
    assert.match(workflow, /--exit-code/);
    assert.match(workflow, /prisma-zero-drift\.log/);
  });

  it("keeps database integration and authenticated isolation enabled", () => {
    assert.match(workflow, /RUN_DB_INTEGRATION: "true"/);
    assert.match(workflow, /E2E_FULL_AUTH: "true"/);
    assert.match(workflow, /npm run test:e2e/);
  });
});
