import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const workspace = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

// app/dashboard/tenders/[id]/executive-snapshot.tsx was removed entirely as
// part of the app-wide consolidation onto the canonical Tender Release
// State — it was a fourth independent GO/REVIEW/NO_GO verdict + its own
// deduplicated next-actions list, built on a different readiness engine
// (canonical-tender-readiness.ts) than the one the canonical panel uses.
// The properties this block protected (canonical final-package status as
// the primary metric, consistent expert/project population, deduplicated
// actions) were specific to that component's own implementation and have
// no direct analogue now that the whole surface is gone rather than
// migrated — the canonical panel's readinessScore/verdict/blockers/
// primaryNextAction are covered by tests/release-integration-panel-truth.test.ts
// and tests/canonical-readiness-counts-and-blockers.test.ts instead.

describe("post-1162 tender workspace density", () => {
  it("places the canonical next action before optional workflow and diagnostic overviews", () => {
    const nextAction = workspace.indexOf("<NextActionPanel");
    const quickOverview = workspace.indexOf('title="Quick workflow control"');
    const diagnostics = workspace.indexOf('title="Detailed readiness and submission controls"');

    assert.ok(nextAction > -1);
    assert.ok(quickOverview > nextAction);
    assert.ok(diagnostics > quickOverview);
  });

  it("keeps overview and diagnostic panels grouped and collapsible, defaulting to visible (owner request 2026-07-20)", () => {
    assert.match(workspace, /function Disclosure/);
    assert.match(workspace, /Compact overview of workflow steps and shortcuts/);
    // Updated for the canonical Tender Release State consolidation: the old
    // description named the retired health/bid-verdict panels directly.
    assert.match(workspace, /Canonical release state, recovery actions, and final-submission diagnostics/);
    assert.match(workspace, /defaultOpen/);
    assert.doesNotMatch(workspace, /<details open className="group rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">/);
  });

  it("does not claim that every action appears once while optional duplicate overviews exist", () => {
    assert.doesNotMatch(workspace, /Each major action appears once/);
    // Updated: Stage 1 (source intake/extraction) now renders before the
    // executive controls, so the guidance banner says "Continue with" rather
    // than "Start with" Next Required Action.
    assert.match(workspace, /Continue with Next Required Action/);
  });
});
