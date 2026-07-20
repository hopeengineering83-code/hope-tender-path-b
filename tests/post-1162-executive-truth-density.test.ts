import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const snapshot = readFileSync("app/dashboard/tenders/[id]/executive-snapshot.tsx", "utf8");
const workspace = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

describe("post-1162 executive snapshot truth", () => {
  it("uses canonical final-package status instead of legacy workflow progress as the primary metric", () => {
    assert.match(snapshot, /Final package status/);
    assert.match(snapshot, /canonicalReadiness\?\.readyForFinalExport/);
    assert.match(snapshot, /modules\.export\.state/);
    assert.doesNotMatch(snapshot, />Workflow Progress</);
    assert.doesNotMatch(snapshot, /workflowProgress/);
  });

  it("uses the same selected population for strong expert and project metrics", () => {
    assert.match(snapshot, /selectedExperts\.filter\(\(match\) => match\.score >= 0\.9\)/);
    assert.match(snapshot, /selectedProjects\.filter\(\(match\) => match\.score >= 0\.9\)/);
    assert.match(snapshot, /Selected experts ≥90%/);
    assert.match(snapshot, /Selected projects ≥90%/);
    assert.doesNotMatch(snapshot, /const strongExperts = expertMatches\.filter/);
    assert.doesNotMatch(snapshot, /const strongProjects = projectMatches\.filter/);
  });

  it("deduplicates document-generation actions by root cause", () => {
    assert.match(snapshot, /export function dedupeSnapshotActions/);
    const documentKeys = snapshot.match(/key: "document-generation"/g) ?? [];
    assert.ok(documentKeys.length >= 4, "all overlapping document-generation messages must share one root-cause key");
    assert.match(snapshot, /unique\.has\(action\.key\)/);
  });
});

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
    assert.match(workspace, /Canonical score, health, recovery, bid verdict, and final-submission diagnostics/);
    assert.match(workspace, /defaultOpen/);
    assert.doesNotMatch(workspace, /<details open className="group rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">/);
  });

  it("does not claim that every action appears once while optional duplicate overviews exist", () => {
    assert.doesNotMatch(workspace, /Each major action appears once/);
    assert.match(workspace, /Start with Next Required Action/);
  });
});
