import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { statusToSeverity } from "../lib/ui-tokens";

describe("UI token state semantics", () => {
  it("keeps RUNNING distinct from WARNING", () => {
    assert.equal(statusToSeverity("RUNNING"), "running");
    assert.equal(statusToSeverity("WARNING"), "warning");
  });

  it("keeps STALE distinct from PARTIAL", () => {
    assert.equal(statusToSeverity("STALE"), "stale");
    assert.equal(statusToSeverity("PARTIAL"), "partial");
  });

  it("treats OCR_REQUIRED as a blocking/poor visual state", () => {
    assert.equal(statusToSeverity("OCR_REQUIRED"), "poor");
  });

  it("does not visually classify approved fallback as fully ready", () => {
    assert.equal(statusToSeverity("HUMAN_APPROVED_REGEX_FALLBACK"), "partial");
  });
});
