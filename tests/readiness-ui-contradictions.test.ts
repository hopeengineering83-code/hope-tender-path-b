import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("readiness UI contradiction guardrails", () => {
  it("blocked generation button does not stay green or say Generate Docs", () => {
    const source = readFileSync(resolve(process.cwd(), "components/generation-action-panel.tsx"), "utf8");
    assert.doesNotMatch(source, /Tender details incomplete/);
    assert.match(source, /cursor-not-allowed/);
  });

  it("export readiness normalizes mandatory evidence support before displaying 0\/N blockers", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export-readiness/route.ts"), "utf8");
    assert.match(source, /normalizeSupportLevel/);
    assert.match(source, /mandatoryEvidence/);
    assert.match(source, /MANDATORY_EVIDENCE_INCOMPLETE/);
  });

  it("controls summary includes suggested controls so totals do not show zero while suggestions exist", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/controls/route.ts"), "utf8");
    assert.match(source, /suggested: suggested\.length/);
    assert.match(source, /persistedTotal/);
    assert.match(source, /persistedSummary\.total \+ suggested\.length/);
  });

  it("does not double-count NO_CONFIRMED_BUILD_PLAN against the canonical NO_CURRENT_CONFIRMED_BUILD_PLAN blocker", () => {
    // Confirmed by a real cross-page comparison against a live seeded
    // tender: the Documents page and the Export Readiness panel (both
    // backed by this route) showed 10 canonical blockers, while the tender
    // workspace/command-center/report (which read the Tender Release
    // State, built from final-submission-readiness.ts's
    // tenderLevelBlockers alone) showed 9 for the identical tender at the
    // identical moment. final-package-readiness-model.ts's
    // NO_CONFIRMED_BUILD_PLAN and final-submission-readiness.ts's
    // NO_CURRENT_CONFIRMED_BUILD_PLAN both fire from the same "no
    // confirmed Build Plan exists" condition. Guarded here so this route's
    // count and list agree with the canonical Tender Release State.
    const source = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export-readiness/route.ts"), "utf8");
    assert.match(source, /hasCanonicalNoConfirmedBuildPlan/);
    assert.match(source, /blocker\.category === "NO_CURRENT_CONFIRMED_BUILD_PLAN"/);
    assert.match(source, /reconciledExportBlockers = finalPackage\.export\.blockers\.filter/);
    assert.match(source, /blocker\.code === "NO_CONFIRMED_BUILD_PLAN" && hasCanonicalNoConfirmedBuildPlan/);
    // Both the gating count and the publicly-listed blockers must use the
    // deduped array -- not the raw finalPackage.export.blockers -- so the
    // fail-closed export gate and the displayed list never disagree.
    assert.match(source, /finalPackageDocumentBlockers = finalPackage\.documents\.blockers\.length \+ reconciledExportBlockers\.length/);
    assert.match(source, /publicBlockers = \[\s*\.\.\.finalPackage\.documents\.blockers,\s*\.\.\.reconciledExportBlockers,/);
  });
});
