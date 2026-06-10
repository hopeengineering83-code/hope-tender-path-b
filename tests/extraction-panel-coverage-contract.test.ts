import { describe, it } from "node:test";
import assert from "node:assert/strict";

function pageStatusCoverage(pages: Array<{ status: string }>) {
  const total = pages.length;
  const good = pages.filter((p) => p.status === "GOOD").length;
  const weak = pages.filter((p) => p.status === "LOW_DENSITY" || p.status === "TABLE_HEAVY" || p.status === "IMAGE_HEAVY" || p.status === "OCR").length;
  const failed = pages.filter((p) => p.status === "FAILED" || p.status === "BLANK").length;
  const percent = total > 0 ? Math.round((good / total) * 100) : 0;
  return { total, good, weak, failed, percent };
}

describe("extraction panel page-status coverage", () => {
  it("does not report full coverage when page status has blank and weak pages", () => {
    const pages = [
      { status: "GOOD" }, { status: "GOOD" }, { status: "GOOD" }, { status: "GOOD" },
      { status: "BLANK" }, { status: "BLANK" }, { status: "BLANK" },
      { status: "LOW_DENSITY" }, { status: "LOW_DENSITY" }, { status: "LOW_DENSITY" }, { status: "LOW_DENSITY" },
      { status: "TABLE_HEAVY" }, { status: "TABLE_HEAVY" },
    ];
    const coverage = pageStatusCoverage(pages);
    assert.equal(coverage.total, 13);
    assert.equal(coverage.good, 4);
    assert.equal(coverage.weak, 6);
    assert.equal(coverage.failed, 3);
    assert.equal(coverage.percent, 31);
    assert.notEqual(coverage.percent, 100);
  });
});
