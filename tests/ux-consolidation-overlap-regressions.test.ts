import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_NAV_GROUPS,
  flattenDashboardLinks,
  getActiveDashboardHref,
} from "../lib/dashboard-navigation";

const repoRoot = path.resolve(__dirname, "..");
const readSource = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// Category A — engine action ownership.
test("category A: engine panel has one primary Safe Mode action and one advanced Full AI action", () => {
  const source = readSource("components/engine-action-panel.tsx");
  const buttons = source.match(/<button[\s\S]*?<\/button>/g) ?? [];
  assert.equal(buttons.filter((button) => /Run Safe Mode — Recommended/.test(button)).length, 1);
  assert.equal(buttons.filter((button) => /Run Full AI in Background/.test(button)).length, 1);
  assert.match(source, /Advanced AI refinement/);
  assert.match(source, /onClick=\{\(\) => runEngineAsync\(false, \{ safe: "true", skipAiRematch: "true" \}\)\}/);
  assert.match(source, /onClick=\{\(\) => runEngineAsync\(false\)\}/);
});

test("category A: large-vault guidance is informational, not another action owner", () => {
  const source = readSource("components/engine-action-panel.tsx");
  const banner = source.match(/Large reviewed vault[\s\S]*?<\/div>\s*\)\}/)?.[0] ?? "";
  assert.ok(banner);
  assert.doesNotMatch(banner, /<button/);
});

test("category A: retry controls remain failure-state-only", () => {
  const source = readSource("components/engine-action-panel.tsx");
  assert.match(source, /result\.code === "ASYNC_ENGINE_FAILED" \|\| result\.code === "ASYNC_ENGINE_TIMEOUT"/);
});

test("category A: Recovery Command Center links to the canonical engine control", () => {
  const source = readSource("components/tender-recovery-command-center.tsx");
  assert.doesNotMatch(source, /executeAction\("RUN_ENGINE"\)/);
  assert.match(source, /<DisclosureAnchorLink href="#run-engine-action"/);
});

test("category A: export readiness does not duplicate AI Analyze or missing-plan mutations", () => {
  const source = readSource("components/export-readiness-panel.tsx");
  assert.doesNotMatch(source, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/ai-analyze`/);
  assert.match(source, /<DisclosureAnchorLink href="#ai-analyze-section"/);
  assert.doesNotMatch(source, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/generate-missing-plan-files`/);
  assert.match(source, /<DisclosureAnchorLink href="#submission-plan-reconciliation"/);
  assert.match(source, /const note = approvalNote\.trim\(\)/);
  assert.match(source, /disabled=\{busy \|\| !approvalNote\.trim\(\)\}/);
});

// Category B — primary navigation uniqueness.
test("category B: five primary destinations represent five distinct workspaces", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  assert.equal(links.length, 5);
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
  const formerPrimaryRoutes = [
    "/dashboard/history", "/dashboard/calendar", "/dashboard/company/readiness",
    "/dashboard/company/plan-b-import", "/dashboard/company/review-board",
    "/dashboard/company/review", "/dashboard/assets", "/dashboard/setup",
    "/dashboard/settings", "/dashboard/matching", "/dashboard/compliance",
    "/dashboard/export", "/dashboard/analytics", "/dashboard/admin/ai-readiness",
    "/dashboard/system", "/dashboard/admin/safety-center", "/dashboard/users",
  ];
  const primaryHrefs = new Set(links.map((link) => link.href));
  for (const route of formerPrimaryRoutes) assert.ok(!primaryHrefs.has(route));
});

test("category B: consolidated member routes activate one correct primary destination", () => {
  const cases: Array<[string, string]> = [
    ["/dashboard/history", "/dashboard/tenders"],
    ["/dashboard/calendar", "/dashboard/tenders"],
    ["/dashboard/company/readiness", "/dashboard/company"],
    ["/dashboard/assets", "/dashboard/company"],
    ["/dashboard/matching", "/dashboard/analysis"],
    ["/dashboard/compliance", "/dashboard/analysis"],
    ["/dashboard/export", "/dashboard/documents"],
    ["/dashboard/analytics", "/dashboard/activity"],
    ["/dashboard/users", "/dashboard/activity"],
  ];
  for (const [route, expected] of cases) {
    assert.equal(getActiveDashboardHref(route, DASHBOARD_NAV_GROUPS), expected);
  }
});

// Category C — one page-level next action.
test("category C: tender page renders exactly one always-visible NextActionPanel", () => {
  const source = readSource("app/dashboard/tenders/[id]/page.tsx");
  assert.equal((source.match(/<NextActionPanel\b/g) ?? []).length, 1);
  const panelIndex = source.indexOf("<NextActionPanel");
  const before = source.slice(0, panelIndex);
  assert.equal((before.match(/<Disclosure\b/g) ?? []).length, (before.match(/<\/Disclosure>/g) ?? []).length);
});

test("category C: competing workflow and release control centers are absent from the normal workspace", () => {
  const source = readSource("app/dashboard/tenders/[id]/page.tsx");
  assert.doesNotMatch(source, /<TenderWorkflowActionCenter\b/);
  assert.doesNotMatch(source, /<TenderRecoveryCommandCenter\b/);
  assert.doesNotMatch(source, /<TenderReleaseStatePanel\b/);
  assert.doesNotMatch(source, /<FinalSubmissionControlCenter\b/);
  assert.match(source, /Open read-only Command Center/);
});

// Category D — sub-navigation ownership.
test("category D: company profile tab is path-segment accurate", () => {
  const sectionSource = readSource("components/section-subnav.tsx");
  assert.match(sectionSource, /isDashboardRouteWithin/);
  assert.match(sectionSource, /sort\(\(a, b\) => b\.href\.length - a\.href\.length\)/);
  const companySource = readSource("components/company-subnav.tsx");
  assert.match(companySource, /href:\s*"\/dashboard\/company\/profile",\s*label:\s*"Labeled Profile Editor"/);
});

test("category D: DashboardGroupSubnav does not duplicate the company tab bar", () => {
  assert.match(
    readSource("components/dashboard-group-subnav.tsx"),
    /isDashboardRouteWithin\(pathname, "\/dashboard\/company"\)\)\s*return null/,
  );
});

// Category E — icon semantics.
test("category E: no two primary sidebar links share an icon", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  assert.equal(new Set(links.map((link) => link.iconName)).size, links.length);
});

test("category E: engine actions use distinct semantic icons", () => {
  const source = readSource("components/engine-action-panel.tsx");
  const safeButton = source.match(/onClick=\{\(\) => runEngineAsync\(false, \{ safe: "true", skipAiRematch: "true" \}\)\}[\s\S]*?<\/button>/)?.[0] ?? "";
  const aiButton = source.match(/onClick=\{\(\) => runEngineAsync\(false\)\}[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(safeButton, /<BoltIcon \/>/);
  assert.match(aiButton, /<ClockIcon \/>/);
});
