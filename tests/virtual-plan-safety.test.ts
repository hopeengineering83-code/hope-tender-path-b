import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";

describe("Virtual Plan Safety — no GeneratedDocument rows before readiness", () => {
  it("Build Plan route does not create GeneratedDocument rows", async () => {
    // This is a static analysis check of the route implementation
    const fs = require('fs');
    const routeContent = fs.readFileSync('app/api/tenders/[id]/submission-plan/build/route.ts', 'utf8');

    assert.strictEqual(routeContent.includes('prisma.generatedDocument.create'), false,
      "Build Plan route must not call prisma.generatedDocument.create");

    assert.ok(routeContent.includes('status: "PLAN_APPROVED"'),
      "Build Plan route must update tender status to PLAN_APPROVED");
  });

  it("Generation gate respects virtual plan and approved status", async () => {
    const fs = require('fs');
    const gateContent = fs.readFileSync('lib/engine/generation-readiness-gate.ts', 'utf8');

    assert.ok(gateContent.includes('planStatus === "CANONICAL_APPROVED"'),
      "Generation gate must check for CANONICAL_APPROVED plan status");

    assert.ok(gateContent.includes('buildSubmissionPlanWithDerivedFallback'),
      "Generation gate must use virtual plan derivation");
  });
});
