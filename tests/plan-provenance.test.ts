import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePlanProvenance,
  parsePlanSourceRequirementIds,
  requiresPlanConfirmation,
  resolvePlanProvenance,
  serializePlanSourceRequirementIds,
} from "../lib/engine/plans/plan-provenance";

test("structured provenance overrides legacy marker text", () => {
  assert.equal(resolvePlanProvenance({ planProvenance: "TENDER_REQUIREMENT", contentSummary: "DERIVED_DRAFT_UNCONFIRMED" }), "TENDER_REQUIREMENT");
});

test("legacy marker remains a migration fallback", () => {
  assert.equal(resolvePlanProvenance({ contentSummary: "DERIVED_DRAFT_UNCONFIRMED" }), "DERIVED_DRAFT");
  assert.equal(resolvePlanProvenance({ contentSummary: "ordinary summary" }), null);
});

test("derived plans require durable confirmation", () => {
  assert.equal(requiresPlanConfirmation({ planProvenance: "DERIVED_DRAFT" }), true);
  assert.equal(requiresPlanConfirmation({ planProvenance: "DERIVED_DRAFT", planConfirmedAt: new Date() }), false);
  assert.equal(requiresPlanConfirmation({ planProvenance: "TENDER_REQUIREMENT" }), false);
});

test("provenance follows the plan evidence source", () => {
  assert.equal(derivePlanProvenance({ isDerivedDraft: true, sourceRequirementIds: ["r1"] }), "DERIVED_DRAFT");
  assert.equal(derivePlanProvenance({ isDerivedDraft: false, sourceRequirementIds: ["r1"] }), "TENDER_REQUIREMENT");
  assert.equal(derivePlanProvenance({ isDerivedDraft: false, sourceRequirementIds: [] }), "EXACT_FILE_INSTRUCTION");
});

test("source requirement ids round trip uniquely", () => {
  const raw = serializePlanSourceRequirementIds(["r1", "r2", "r1", ""]);
  assert.deepEqual(parsePlanSourceRequirementIds(raw), ["r1", "r2"]);
  assert.deepEqual(parsePlanSourceRequirementIds("invalid"), []);
});
