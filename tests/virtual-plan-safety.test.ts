import { test } from "node:test";
import assert from "node:assert";
import { buildSubmissionPlanWithDerivedFallback, deriveSubmissionPlanStatus } from "../lib/engine/submission-plan";

test("Proof: submission plan can be virtual and approved via status PLAN_APPROVED", () => {
  const tender = {
    id: "t1",
    status: "PLAN_APPROVED",
    exactFileNaming: '["test.docx"]',
    exactFileOrder: '[]',
    requirements: [],
    generatedDocuments: [] // No real rows!
  };

  const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
  const status = deriveSubmissionPlanStatus(tender as any, plan);

  assert.strictEqual(status, "CANONICAL_APPROVED", "Status should be approved even with zero rows if status is PLAN_APPROVED");
  assert.strictEqual(plan.files.length, 1, "Plan should have 1 virtual file");
});

test("Proof: submission plan is BLOCKED if status is NOT PLAN_APPROVED and no rows exist", () => {
  const tender = {
    id: "t1",
    status: "DRAFT",
    exactFileNaming: '["test.docx"]',
    exactFileOrder: '[]',
    requirements: [],
    generatedDocuments: []
  };

  const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
  const status = deriveSubmissionPlanStatus(tender as any, plan);

  assert.strictEqual(status, "USER_REVIEW_REQUIRED", "Status should be unapproved");
});
