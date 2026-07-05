import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getFinalSubmissionStatus } from "../lib/final-submission-status";

describe("final submission status", () => {
  it("blocks generation and zip when regex fallback is active", () => {
    const status = getFinalSubmissionStatus({ analysisSourceGate: "BLOCKED_REGEX_FALLBACK", generationReady: true, exportChecked: false });
    assert.equal(status.analysis, "blocked");
    assert.equal(status.generation, "blocked");
    assert.equal(status.exportGate, "unknown");
    assert.equal(status.zip, "blocked");
  });

  it("distinguishes generation readiness from export readiness", () => {
    const status = getFinalSubmissionStatus({ generationReady: true, generationBlockerCount: 0, exportChecked: true, exportReady: false });
    assert.equal(status.generation, "done");
    assert.equal(status.exportGate, "blocked");
    assert.equal(status.zip, "blocked");
  });

  it("allows zip only after export gate passes", () => {
    const status = getFinalSubmissionStatus({ generationReady: true, generationBlockerCount: 0, exportChecked: true, exportReady: true });
    assert.equal(status.generation, "done");
    assert.equal(status.exportGate, "done");
    assert.equal(status.zip, "done");
  });
});
