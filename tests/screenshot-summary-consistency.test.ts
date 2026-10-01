import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  assertScreenshotCoverageConsistency,
  summarizeRouteCoverage,
} from "../scripts/screenshot-route-manifest.mjs";

const capture = readFileSync("scripts/capture-production-pages.mjs", "utf8");
const manifest = readFileSync("scripts/screenshot-route-manifest.mjs", "utf8");

describe("screenshot audit summary consistency", () => {
  it("derives index and compact-summary coverage from one canonical calculation", () => {
    assert.match(manifest, /export function summarizeRouteCoverage/);
    assert.match(manifest, /export function assertScreenshotCoverageConsistency/);
    assert.match(capture, /summarizeRouteCoverage/);
    assert.match(capture, /assertScreenshotCoverageConsistency/);
    assert.match(capture, /coverage:\s*coverageSummary/);
  });

  it("does not overload a zero routeCoverage finding count as a coverage count", () => {
    assert.doesNotMatch(capture, /counts:\s*summary\.findingCounts/);
    assert.doesNotMatch(capture, /routeCoverage:\s*routeCoverageFindings\.length/);
    assert.match(capture, /missingRouteCoverage:\s*coverageSummary\.uncovered/);
  });

  it("calculates explicit coverage dimensions and rejects contradictory details", () => {
    const routeCoverage = [
      { viewport: "desktop", pattern: "/", covered: true },
      { viewport: "desktop", pattern: "/dashboard", covered: true },
      { viewport: "mobile", pattern: "/dashboard", covered: false },
    ];
    const coverage = summarizeRouteCoverage(routeCoverage);
    const uncoveredRoutes = [routeCoverage[2]];

    assert.deepEqual(coverage, {
      expected: 3,
      covered: 2,
      uncovered: 1,
      percent: 66.67,
    });
    assert.doesNotThrow(() => assertScreenshotCoverageConsistency({
      coverage,
      routeCoverage,
      uncoveredRoutes,
    }));
    assert.throws(
      () => assertScreenshotCoverageConsistency({
        coverage: { ...coverage, percent: 100 },
        routeCoverage,
        uncoveredRoutes,
      }),
      /percent is inconsistent/,
    );
    assert.throws(
      () => assertScreenshotCoverageConsistency({
        coverage,
        routeCoverage,
        uncoveredRoutes: [],
      }),
      /uncovered route details are inconsistent/,
    );
  });
});
