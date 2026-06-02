// Source-level wiring test: the Generation Action panel surfaces the
// /api/tenders/[id]/repair-metadata endpoint as a one-click affordance when
// (and only when) fullProposalBlockers contains FULL_PROPOSAL_METADATA_INCOMPLETE.
//
// Behavioural runtime test would need React + auth + Prisma — kept the
// assertion at source level so it's deterministic and fast.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("GenerationActionPanel wires the repair-metadata endpoint", () => {
  const source = readFileSync("components/generation-action-panel.tsx", "utf8");

  it("computes metadataBlockerPresent from the blocker code (not free-text matching)", () => {
    assert.match(source, /metadataBlockerPresent\s*=\s*fullProposalBlockers\.some\(\(b\)\s*=>\s*b\.code === "FULL_PROPOSAL_METADATA_INCOMPLETE"\)/);
  });

  it("POSTs to the /repair-metadata endpoint with the evaluationMethodology field", () => {
    assert.match(source, /\/api\/tenders\/\$\{tenderId\}\/repair-metadata/);
    assert.match(source, /fields:\s*\["evaluationMethodology"\]/);
  });

  it("renders the repair button only when metadataBlockerPresent is true", () => {
    assert.match(source, /\{metadataBlockerPresent\s*&&\s*\(/);
  });

  it("surfaces NOT_FOUND, REPAIRED and SKIPPED states from the endpoint", () => {
    assert.match(source, /result\.status === "REPAIRED"/);
    assert.match(source, /result\.status === "NOT_FOUND"/);
    assert.match(source, /result\.status === "SKIPPED"/);
  });

  it("refreshes the route only on REPAIRED so the new value is visible", () => {
    // The REPAIRED branch should call router.refresh via startTransition;
    // NOT_FOUND / SKIPPED should NOT call refresh (nothing changed).
    const repairedBlock = source.match(/result\.status === "REPAIRED"[\s\S]{0,400}/);
    assert.ok(repairedBlock && /router\.refresh\(\)/.test(repairedBlock[0]), "REPAIRED branch must call router.refresh");
  });

  it("the button label clearly conveys the source-grounded intent", () => {
    // The single-field button label changed when the batch "Repair all" button
    // landed next to it — match the still-present "evaluationMethodology" token
    // and the source-grounded descriptor in the help text.
    assert.match(source, /Repair evaluationMethodology only/);
    assert.match(source, /source-grounded repair/);
  });

  it("does not duplicate or weaken the existing fullProposalReady disable on the Generate Docs button", () => {
    assert.match(source, /disabled=\{!fullProposalReady \|\| running \|\| isPending\}/);
  });
});
