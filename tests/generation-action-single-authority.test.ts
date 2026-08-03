// Gap 2+3: The Generation panel is now a text-based status surface.
// No buttons, no repair controls, no icons. The old single-authority
// tests have been rewritten to assert the new behavior.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const PANEL = readFileSync("components/generation-action-panel.tsx", "utf8");
const PAGE = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
const READINESS = readFileSync("components/generation-readiness-panel.tsx", "utf8");

describe("The canonical generation panel is a text-based status surface (Gap 2+3)", () => {
  it("has NO buttons (no Generate Docs, no Repair)", () => {
    const buttons = PANEL.match(/<button/g) ?? [];
    assert.equal(buttons.length, 0, "no manual action buttons remain");
  });

  it("has NO repair endpoint calls (repair is automatic)", () => {
    assert.doesNotMatch(PANEL, /repair-metadata/);
    assert.doesNotMatch(PANEL, /runRepairAllMetadata/);
    assert.doesNotMatch(PANEL, /ALL_REPAIRABLE_FIELDS/);
  });

  it("shows text-based release status", () => {
    assert.match(PANEL, /PROCESSING_AUTOMATICALLY/);
    assert.match(PANEL, /READY_TO_DOWNLOAD/);
  });

  it("shows Download ZIP link when ready", () => {
    assert.match(PANEL, /Download Final ZIP/);
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
