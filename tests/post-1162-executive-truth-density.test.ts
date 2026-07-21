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
    const diagnostics = workspace.indexOf('title="Advanced diagnostics"');

    assert.ok(nextAction > -1);
    assert.ok(quickOverview > nextAction);
    assert.ok(diagnostics > quickOverview);
  });

  // UPDATED (superseding the 2026-07-20 "defaulting to visible" decision, per
  // an explicit follow-up owner request the next day): NextActionPanel now
  // absorbs tender status, readiness score, and bid verdict directly (see
  // components/next-action-panel.tsx), so it is the one authoritative,
  // always-visible status card. Recovery Command Center, the full Tender
  // Release State detail, and Final Submission Control Center render the
  // same underlying data at greater depth and would compete with that card
  // if left open by default — they are grouped under "Advanced diagnostics"
  // and now collapsed by default, alongside the already-collapsed "Quick
  // workflow control".
  it("keeps overview and diagnostic panels grouped and collapsible, both collapsed by default (owner request 2026-07-21 supersedes 2026-07-20)", () => {
    assert.match(workspace, /function Disclosure/);
    assert.match(workspace, /Compact overview of workflow steps and shortcuts/);
    assert.match(workspace, /Recovery Command Center, full release-state detail, and Final Submission Control Center/);
    const quickBlock = workspace.match(/<Disclosure\s+[\s\S]*?title="Quick workflow control"[\s\S]*?<\/Disclosure>/)?.[0] ?? "";
    const advancedBlock = workspace.match(/<Disclosure\s+[\s\S]*?title="Advanced diagnostics"[\s\S]*?<\/Disclosure>/)?.[0] ?? "";
    assert.ok(quickBlock, "quick workflow disclosure must exist");
    assert.ok(advancedBlock, "advanced diagnostics disclosure must exist");
    assert.doesNotMatch(quickBlock, /defaultOpen/, "quick workflow must stay collapsed by default");
    assert.doesNotMatch(advancedBlock, /defaultOpen/, "advanced diagnostics must now be collapsed by default, not compete with NextActionPanel");
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
