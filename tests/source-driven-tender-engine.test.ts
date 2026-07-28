import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CLASSIFICATIONS,
  classifySourceDisposition,
} from "../lib/tender-understanding/source-classification";
import { TENDER_ACTIONS, assertUniqueMutationOwners } from "../lib/ui/action-registry";
import { SEMANTIC_ICON_ASSIGNMENTS, findIconCollisions } from "../lib/semantic-icon-registry";
import { DASHBOARD_NAV_GROUPS, flattenDashboardLinks } from "../lib/dashboard-navigation";

test("canonical tender-understanding classification is complete and stable", () => {
  assert.deepEqual(SOURCE_CLASSIFICATIONS, [
    "FOUND_AND_GROUNDED",
    "EXPLICITLY_NOT_REQUIRED",
    "NOT_STATED",
    "UNREADABLE",
    "EXTRACTION_FAILED",
    "CONFLICTING",
  ]);
});

test("optional NOT_STATED facts never block or interrupt", () => {
  assert.deepEqual(
    classifySourceDisposition({ key: "siteVisit", classification: "NOT_STATED", requiredForFinalDelivery: false }),
    {
      blocks: false,
      requiresUserInterruption: false,
      severity: "NONE",
      reason: "siteVisit is optional and not stated by the tender source.",
    },
  );
});

test("only indispensable unresolved delivery facts block", () => {
  for (const classification of ["UNREADABLE", "EXTRACTION_FAILED", "CONFLICTING"] as const) {
    const result = classifySourceDisposition({ key: "submissionDeadline", classification, requiredForFinalDelivery: true });
    assert.equal(result.blocks, true);
    assert.equal(result.requiresUserInterruption, true);
  }
});

test("one mutation owner and one final ZIP preparation owner are enforced", () => {
  assert.doesNotThrow(assertUniqueMutationOwners);
  const zipActions = Object.values(TENDER_ACTIONS).filter((action) => action.mutation === "POST /api/tenders/:id/export");
  assert.equal(zipActions.length, 1);
  assert.equal(zipActions[0]?.owner, "ExportReadinessPanel");
  assert.equal(zipActions[0]?.label, "Prepare final ZIP");
});

test("semantic icons have no collisions", () => {
  const collisions = findIconCollisions();
  assert.equal(collisions.length, 0, `Icon collisions found: ${JSON.stringify(collisions)}`);
});

test("primary navigation exposes at most six destinations", () => {
  assert.ok(flattenDashboardLinks(DASHBOARD_NAV_GROUPS).length <= 6);
});
