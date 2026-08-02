// The Generation stage has one authority and one primary action.
//
// GenerationActionPanel is the canonical Generation-stage owner. It carried two
// repair controls that hit the SAME endpoint with the same handler, the same
// error branches and the same icon, differing only in the request payload:
// `{fields: ["evaluationMethodology"]}` versus `{fields: ALL_REPAIRABLE_FIELDS}`.
// The narrow one is a strict subset of the broad one, so it offered the user a
// choice with no meaningful difference and ~48 lines of duplicated fetch and
// error handling behind it. One control remains.
//
// The competing readiness presentation ("Ready to generate full proposal", the
// 0-100 ScoreGauge, its own blocker lists) is NOT on the normal page: it lives
// in GenerationReadinessPanel inside the "Generation and review diagnostics"
// disclosure, which is collapsed. Those assertions are here so the separation
// cannot quietly regress.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const PANEL = readFileSync("components/generation-action-panel.tsx", "utf8");
const PAGE = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
const READINESS = readFileSync("components/generation-readiness-panel.tsx", "utf8");

describe("The canonical generation panel offers one primary action", () => {
  it("renders exactly two controls: generate, and one conditional repair", () => {
    const buttons = PANEL.match(/<button/g) ?? [];
    assert.equal(buttons.length, 2, "a third control means the stage regained a competing action");
  });

  it("no longer offers two repair scopes for the same endpoint", () => {
    assert.doesNotMatch(PANEL, /runRepairMetadata\b/, "the narrow-scope duplicate must stay deleted");
    assert.doesNotMatch(PANEL, /Repair evaluation criteria only/);
    assert.doesNotMatch(PANEL, /fields: \["evaluationMethodology"\]/);
    // The surviving control repairs every repairable field in one call.
    assert.match(PANEL, /runRepairAllMetadata/);
    assert.match(PANEL, /fields: ALL_REPAIRABLE_FIELDS/);
  });

  it("keeps the repair endpoint reachable rather than orphaning the route", () => {
    // Deleting both controls would have left /repair-metadata with no caller.
    // Count fetch call sites only — the string also appears in the import of
    // lib/engine/repair-metadata-contract, which is not a call.
    const calls = PANEL.match(/fetch\(`\/api\/tenders\/\$\{tenderId\}\/repair-metadata`/g) ?? [];
    assert.equal(calls.length, 1, "exactly one call site to the repair endpoint");
  });

  it("shows the repair only while a metadata blocker is actually present", () => {
    assert.match(PANEL, /canMutate && metadataBlockerPresent/);
  });
});

describe("The competing readiness presentation stays out of the normal page", () => {
  it("keeps GenerationReadinessPanel inside the diagnostics disclosure", () => {
    const stage = PAGE.slice(PAGE.indexOf("<WorkflowStage number={4}"), PAGE.indexOf("<WorkflowStage number={5}"));
    const disclosureAt = stage.indexOf("Generation and review diagnostics");
    const readinessAt = stage.indexOf("<GenerationReadinessPanel");
    assert.ok(disclosureAt > 0 && readinessAt > disclosureAt,
      "the readiness panel must render inside the diagnostics disclosure, not above it");
    // The canonical action comes first, before the disclosure.
    const actionAt = stage.indexOf("<GenerationActionPanel");
    assert.ok(actionAt > 0 && actionAt < disclosureAt, "the canonical action must lead the stage");
  });

  it("leaves every disclosure collapsed by default", () => {
    assert.match(PAGE, /defaultOpen = false/);
    // No caller may force one open — that would put diagnostics back on the
    // normal page without moving any code.
    assert.doesNotMatch(PAGE, /defaultOpen(=\{true\}|\s*=\s*true)/);
    assert.doesNotMatch(PAGE, /<Disclosure[^>]*defaultOpen/);
  });

  it("keeps the score and its headline confined to the diagnostics panel", () => {
    assert.match(READINESS, /Ready to generate full proposal/);
    assert.match(READINESS, /ScoreGauge/);
    // ...and out of the canonical one.
    assert.doesNotMatch(PANEL, /ScoreGauge/);
    assert.doesNotMatch(PANEL, /Ready to generate full proposal/);
  });
});
