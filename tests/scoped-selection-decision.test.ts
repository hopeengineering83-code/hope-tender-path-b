import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
const panel = readFileSync("components/selection-approval-panel.tsx", "utf8");

describe("scoped evidence-selection decisions", () => {
  it("keeps ordinary Engine selection automatic and requires rationale only for a manual exception", () => {
    assert.match(panel, /Downstream processing continues automatically/);
    assert.match(panel, /documented, revision-bound material exception/);
    assert.match(panel, /window\.prompt/);
    assert.match(panel, /rationale\.length < 12/);
    assert.doesNotMatch(panel, /Approve Selection|Selection Approval|Approve & Continue/);
  });

  it("reads the authoritative revision immediately before writing", () => {
    const getPosition = panel.indexOf('method: "GET"');
    const putPosition = panel.indexOf('method: "PUT"');
    assert.ok(getPosition >= 0 && putPosition > getPosition);
    assert.match(panel, /expectedRevision:\s*currentMatch\.revision/);
    assert.match(route, /revision:\s*match\.updatedAt\.toISOString\(\)/);
    assert.match(route, /MATCH_REVISION_CONFLICT/);
    assert.match(route, /match\.updatedAt\.toISOString\(\) !== new Date\(parsed\.expectedRevision\)\.toISOString\(\)/);
  });

  it("prevents a manual exception from selecting non-eligible Vault evidence", () => {
    assert.match(route, /canUseVaultRecord\(record, "MATCHING"\)/);
    assert.match(route, /MATCH_SOURCE_NOT_ELIGIBLE/);
    assert.match(route, /VAULT_REVIEW_CONSUMER_SELECT\.EXPERT/);
    assert.match(route, /VAULT_REVIEW_CONSUMER_SELECT\.PROJECT/);
  });

  it("persists the decision and invalidates every dependent release authority atomically", () => {
    const transactionPosition = route.indexOf("const decision = await prisma.$transaction");
    const matchUpdatePosition = route.indexOf("tenderExpertMatch.update", transactionPosition);
    const invalidationPosition = route.indexOf("invalidateSelectionDependents", matchUpdatePosition);
    const auditPosition = route.indexOf("tx.auditLog.create", invalidationPosition);
    assert.ok(transactionPosition >= 0);
    assert.ok(matchUpdatePosition > transactionPosition);
    assert.ok(invalidationPosition > matchUpdatePosition);
    assert.ok(auditPosition > invalidationPosition);

    assert.match(route, /buildPlan\.updateMany/);
    assert.match(route, /generatedDocument\.updateMany/);
    assert.match(route, /exportPackage\.updateMany/);
    assert.match(route, /sectionEvidenceMap\.updateMany/);
    assert.match(route, /submissionPlanState\.updateMany/);
    assert.match(route, /MATERIAL_EVIDENCE_SELECTION_EXCEPTION/);
    assert.match(route, /previousRevision/);
    assert.match(route, /resultingRevision/);
    assert.match(route, /selectedBefore/);
    assert.match(route, /selectedAfter/);
    assert.match(route, /affectedOutputs/);
    assert.match(route, /invalidationRules/);
  });

  it("automatically re-derives machine-confirmed Build Plan authority", () => {
    assert.match(route, /buildAndVerifyBuildPlan\(prisma, tenderId, userId/);
    assert.match(route, /reuseCurrent:\s*false/);
    assert.match(route, /status:\s*"MACHINE_CONFIRMED"/);
    assert.match(route, /CONTINUE_AUTOMATED_GENERATION/);
    assert.match(route, /Dependent artifacts remain safely invalidated/);
  });
});
