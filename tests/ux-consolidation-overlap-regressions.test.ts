import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_NAV_GROUPS,
  flattenDashboardLinks,
  getActiveDashboardHref,
} from "../lib/dashboard-navigation";

// Dedicated regression suite for the 7-item UX consolidation pass (PR #1175).
// Each block below maps directly to one of the five named overlap categories
// from that instruction: "Add regression tests that fail when: (a) two
// visible buttons invoke the same engine action; (b) two visible primary
// navigation items represent the same workspace; (c) more than one primary
// next action is displayed on the tender page; (d) a company sub-navigation
// tab is active on the wrong route; (e) sidebar icon identities or action
// meanings overlap." Other test files already cover pieces of this
// (rendered-component-capability.test.ts, dashboard-navigation-contract.test.ts,
// single-company-profile-editor.test.ts) — this file exists so the mapping
// from the ask to the enforcement is unambiguous in one place.

const repoRoot = path.resolve(__dirname, "..");
function readSource(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

// ─── Category A: two visible buttons invoking the same engine action ───────

test("category A: engine-action-panel idle state renders exactly two engine-triggering buttons, each a distinct action", () => {
  const src = readSource("components/engine-action-panel.tsx");

  // The idle-state button row must contain exactly one Safe Mode trigger and
  // exactly one Full-AI-in-background trigger, and no third/fourth idle
  // button competing with them (e.g. a "Force run once" or bare "Run
  // Engine" control resurrected alongside the two named actions). Count
  // only actual <button> elements, not prose that references the button by
  // name (e.g. the large-vault banner's "Run Safe Mode — Recommended above").
  const buttonBlocks = src.match(/<button[\s\S]*?<\/button>/g) ?? [];
  const safeModeButtons = buttonBlocks.filter((b) => /Run Safe Mode — Recommended/.test(b));
  const backgroundButtons = buttonBlocks.filter((b) => /Run Full AI in Background/.test(b));
  assert.equal(safeModeButtons.length, 1, "exactly one <button> may render 'Run Safe Mode — Recommended'");
  assert.equal(backgroundButtons.length, 1, "exactly one <button> may render 'Run Full AI in Background'");

  // Both idle actions must go through the async job queue (runEngineAsync),
  // not a mix of sync executeEngineRun + async executeEngineRunAsync for
  // what the user perceives as two flavors of "run" — that mix was the
  // original duplicated-action bug. Scope this check to the idle section
  // only (before the `{result && (` failure/retry block begins) since the
  // retry-state buttons legitimately call runEngineAsync too, just gated
  // behind a failed/timeout result rather than shown in the idle state.
  const idleSectionEnd = src.indexOf("{result && (");
  assert.ok(idleSectionEnd > -1, "expected a `{result && (` block delimiting idle vs. failure/retry UI");
  const idleSection = src.slice(0, idleSectionEnd);
  const idleRunEngineAsyncCalls = idleSection.match(/onClick=\{\(\) => runEngineAsync\(/g) ?? [];
  assert.equal(idleRunEngineAsyncCalls.length, 2, "idle state must dispatch exactly two runEngineAsync-backed buttons");

  // The old always-both-safe-and-full-AI-shown-twice bug rendered a second
  // copy of one or both actions inside the amber "large vault" banner. That
  // banner must now be informational text only — no onClick / button markup.
  const amberBannerMatch = src.match(/Large vault detected[\s\S]*?<\/div>\s*\)\}/);
  assert.ok(amberBannerMatch, "expected to find the large-vault info banner block");
  assert.doesNotMatch(amberBannerMatch![0], /<button/, "the large-vault banner must not render its own action buttons (duplicate of the idle-state buttons above)");
});

test("category A: the retry/failure-state buttons remain distinct actions from the idle Safe Mode / Full AI buttons", () => {
  const src = readSource("components/engine-action-panel.tsx");
  // Retry-state buttons ("Retry from start", "Run Safe Mode", "Skip AI
  // Rematch") only render when result.code === ASYNC_ENGINE_FAILED /
  // ASYNC_ENGINE_TIMEOUT — i.e. never simultaneously with the idle-state
  // buttons (result is null in idle state). If this guard were ever removed,
  // the failure-state "Run Safe Mode" button would visibly duplicate the
  // idle "Run Safe Mode — Recommended" button.
  assert.match(
    src,
    /result\.code === "ASYNC_ENGINE_FAILED" \|\| result\.code === "ASYNC_ENGINE_TIMEOUT"/,
    "retry-state buttons must stay gated behind a failed/timeout result, not shown alongside the idle buttons",
  );
  assert.match(src, /!result && !running &&/, "the idle large-vault banner must stay gated to the no-result, not-running state");
});

test("category A: tender-recovery-command-center.tsx does not run a second, separate engine execution — it links to the one canonical control", () => {
  const src = readSource("components/tender-recovery-command-center.tsx");
  // RUN_ENGINE's spec in lib/recovery-command-actions.ts is a bare
  // synchronous POST /api/tenders/{id}/engine — calling it here would bypass
  // the async job-queue infrastructure engine-action-panel.tsx's two buttons
  // rely on to escape the 60s Vercel cap, and would be a second/third live
  // trigger for the same underlying engine action. Both places that could
  // dispatch RUN_ENGINE (the EVIDENCE_NOT_ASSESSED blocker quick-action, and
  // the generic recovery-state "Execute" button when primaryNextAction is
  // RUN_ENGINE) must instead link to the canonical #run-engine-action
  // control, not call executeAction("RUN_ENGINE").
  assert.doesNotMatch(src, /executeAction\("RUN_ENGINE"\)/, "must not directly execute RUN_ENGINE from this component — link to the canonical control instead");
  // The generic recovery-state button still legitimately calls
  // executeAction(data.primaryNextAction) for every OTHER action — it must
  // just special-case RUN_ENGINE first so that specific value never reaches
  // that call.
  assert.match(
    src,
    /data\.primaryNextAction === "RUN_ENGINE" \?[\s\S]{0,800}<DisclosureAnchorLink href="#run-engine-action"/,
    "the generic recovery Execute button must special-case RUN_ENGINE (render the canonical-control link) before falling back to executeAction(data.primaryNextAction) for other actions",
  );
  const runEngineLinks = src.match(/<DisclosureAnchorLink href="#run-engine-action"/g) ?? [];
  assert.equal(runEngineLinks.length, 2, "expected exactly the two known RUN_ENGINE call sites (blocker quick-action + recovery-state Execute) to link to the canonical control");
});

// ─── Category B: two visible primary nav items representing the same workspace ───

test("category B: primary sidebar has no two links pointing at routes that serve the same workspace", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);

  // Href uniqueness (a duplicate href is trivially the same workspace twice).
  assert.equal(new Set(links.map((l) => l.href)).size, links.length, "no two primary nav links may share an href");

  // The consolidation's actual goal: routes that used to be separate primary
  // items (Active Tenders / Tender History / Deadline Calendar, Knowledge
  // Vault / Profile / Readiness / Review Board / Diagnostics / Assets /
  // Import / Setup / Settings, Global Analysis / Matching / Compliance,
  // Document Archive / Export Hub, Activity Logs / System Analytics / AI
  // Readiness / System Status / Safety Center / User Management) must now be
  // memberHrefs of ONE link, not separate top-level links.
  const consolidatedFormerPrimaries = [
    "/dashboard/history",
    "/dashboard/calendar",
    "/dashboard/company/readiness",
    "/dashboard/company/plan-b-import",
    "/dashboard/company/review-board",
    "/dashboard/company/review",
    "/dashboard/assets",
    "/dashboard/setup",
    "/dashboard/settings",
    "/dashboard/matching",
    "/dashboard/compliance",
    "/dashboard/export",
    "/dashboard/analytics",
    "/dashboard/admin/ai-readiness",
    "/dashboard/system",
    "/dashboard/admin/safety-center",
    "/dashboard/users",
  ];
  const primaryHrefs = new Set(links.map((l) => l.href));
  for (const formerPrimary of consolidatedFormerPrimaries) {
    assert.ok(!primaryHrefs.has(formerPrimary), `"${formerPrimary}" must not be re-advertised as its own primary sidebar destination — it was consolidated`);
  }

  // And exactly 6 primary destinations total (Overview, Tenders, Company
  // Vault, Engine, Documents & Export, Administration) — a regression that
  // silently re-adds a 7th "same workspace, new label" entry must fail here.
  assert.equal(links.length, 6, "post-consolidation the primary sidebar must show exactly 6 destinations");
});

test("category B: every consolidated member route still resolves to exactly one (the correct) primary sidebar destination", () => {
  const cases: Array<[string, string]> = [
    ["/dashboard/history", "/dashboard/tenders"],
    ["/dashboard/calendar", "/dashboard/tenders"],
    ["/dashboard/company/readiness", "/dashboard/company"],
    ["/dashboard/assets", "/dashboard/company"],
    ["/dashboard/setup", "/dashboard/company"],
    ["/dashboard/settings", "/dashboard/company"],
    ["/dashboard/matching", "/dashboard/analysis"],
    ["/dashboard/compliance", "/dashboard/analysis"],
    ["/dashboard/export", "/dashboard/documents"],
    ["/dashboard/analytics", "/dashboard/activity"],
    ["/dashboard/users", "/dashboard/activity"],
  ];
  for (const [route, expectedPrimary] of cases) {
    const active = getActiveDashboardHref(route, DASHBOARD_NAV_GROUPS);
    assert.equal(active, expectedPrimary, `${route} must activate exactly the ${expectedPrimary} destination, never a second competing one`);
  }
});

// ─── Category C: more than one primary next action on the tender detail page ───

test("category C: tender detail page renders exactly one always-visible NextActionPanel, outside any collapsed disclosure", () => {
  const src = readSource("app/dashboard/tenders/[id]/page.tsx");

  const nextActionPanelUsages = src.match(/<NextActionPanel\b/g) ?? [];
  assert.equal(nextActionPanelUsages.length, 1, "exactly one <NextActionPanel> may render on the tender detail page");

  // It must sit between the intake WorkflowStage and the "Quick workflow
  // control" Disclosure — i.e. not nested inside any <Disclosure ...> block
  // that could hide it by default (which would demote it from "the one
  // authoritative status card" to an optional, collapsed one).
  const panelIndex = src.indexOf("<NextActionPanel");
  const precedingSlice = src.slice(0, panelIndex);
  const openDisclosures = (precedingSlice.match(/<Disclosure\b/g) ?? []).length;
  const closedDisclosures = (precedingSlice.match(/<\/Disclosure>/g) ?? []).length;
  assert.equal(openDisclosures, closedDisclosures, "<NextActionPanel> must not be nested inside an unclosed <Disclosure> — it must always be visible, not collapsed");
});

test("category C: every panel capable of rendering its own next-action is either collapsed or has next-action suppressed", () => {
  const src = readSource("app/dashboard/tenders/[id]/page.tsx");

  // TenderReleaseStatePanel can render its own "next action" UI — it must be
  // explicitly suppressed wherever it's rendered on this page so it never
  // competes with NextActionPanel's next-action content.
  const releaseStateUsages = [...src.matchAll(/<TenderReleaseStatePanel\b[^>]*\/?>/g)].map((m) => m[0]);
  assert.ok(releaseStateUsages.length > 0, "expected at least one TenderReleaseStatePanel usage");
  for (const usage of releaseStateUsages) {
    assert.match(usage, /showNextAction=\{false\}/, `TenderReleaseStatePanel must be rendered with showNextAction={false} on the tender page, got: ${usage}`);
  }

  // TenderRecoveryCommandCenter, TenderReleaseStatePanel, and
  // FinalSubmissionControlCenter — the three panels the spec names as
  // needing consolidation away from competing with the one status card —
  // must all be inside the same collapsed "Advanced diagnostics" Disclosure,
  // not left floating at top level where they'd visually compete with
  // NextActionPanel.
  const advancedDiagnosticsMatch = src.match(/<Disclosure\s+title="Advanced diagnostics"[\s\S]*?<\/Disclosure>/);
  assert.ok(advancedDiagnosticsMatch, "expected an 'Advanced diagnostics' Disclosure grouping the deeper panels");
  const block = advancedDiagnosticsMatch![0];
  assert.match(block, /<TenderRecoveryCommandCenter\b/);
  assert.match(block, /<TenderReleaseStatePanel\b/);
  assert.match(block, /<FinalSubmissionControlCenter\b/);

  // And that Disclosure must not default open (defaultOpen is only set via
  // an explicit `open` prop on WorkflowStage or `defaultOpen` prop on
  // Disclosure — its absence here means it defaults to closed).
  const disclosureTagMatch = block.match(/<Disclosure\s+title="Advanced diagnostics"[^>]*>/);
  assert.ok(disclosureTagMatch);
  assert.doesNotMatch(disclosureTagMatch![0], /defaultOpen/, "Advanced diagnostics must stay collapsed by default so it never visually competes with NextActionPanel");
});

// ─── Category D: company sub-navigation tab active on the wrong route ──────

test("category D: Labeled Profile Editor tab is active only on /dashboard/company/profile, never on sibling company routes", () => {
  const sectionSubnavSrc = readSource("components/section-subnav.tsx");
  // The active-tab computation must use isDashboardRouteWithin (prefix-safe,
  // not substring) and pick the LONGEST matching tab href — otherwise
  // "/dashboard/company" (Knowledge Vault) would also prefix-match every
  // nested company route and both tabs could render as simultaneously
  // active, or the wrong (shorter) tab could win.
  assert.match(sectionSubnavSrc, /isDashboardRouteWithin/, "SectionSubnav must use the path-segment-safe isDashboardRouteWithin helper");
  assert.match(sectionSubnavSrc, /sort\(\(a, b\) => b\.href\.length - a\.href\.length\)/, "SectionSubnav must pick the longest-matching tab href as active, so a nested route never activates a shorter sibling tab");

  const companySubnavSrc = readSource("components/company-subnav.tsx");
  const tabsBlock = companySubnavSrc.match(/COMPANY_TABS_BASE[\s\S]*?\];/)?.[0] ?? "";
  const profileTabMatch = tabsBlock.match(/\{\s*href:\s*"([^"]+)",\s*label:\s*"Labeled Profile Editor"\s*\}/);
  assert.ok(profileTabMatch, "expected a 'Labeled Profile Editor' tab entry in COMPANY_TABS_BASE");
  assert.equal(profileTabMatch![1], "/dashboard/company/profile", "Labeled Profile Editor's href must be exactly /dashboard/company/profile");

  // Simulate activeTabHref's logic directly against the real tab list to
  // prove /dashboard/company (Knowledge Vault, a shorter sibling prefix)
  // does not activate Labeled Profile Editor, and vice versa.
  const hrefs = [...tabsBlock.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.includes("/dashboard/company"));
  assert.ok(hrefs.includes("/dashboard/company/profile"));

  function isWithin(pathname: string, href: string): boolean {
    if (href === "/dashboard") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  function activeFor(pathname: string): string | null {
    const matches = hrefs.filter((h) => isWithin(pathname, h));
    if (matches.length === 0) return null;
    return [...matches].sort((a, b) => b.length - a.length)[0];
  }
  assert.equal(activeFor("/dashboard/company"), "/dashboard/company", "Knowledge Vault route must activate only Knowledge Vault");
  assert.equal(activeFor("/dashboard/company/profile"), "/dashboard/company/profile", "profile route must activate only Labeled Profile Editor");
  assert.equal(activeFor("/dashboard/company/readiness"), "/dashboard/company/readiness", "a sibling company route must not activate Labeled Profile Editor");
});

test("category D: DashboardGroupSubnav never double-renders a company tab bar on /dashboard/company/* routes", () => {
  const src = readSource("components/dashboard-group-subnav.tsx");
  // /dashboard/company/* already gets CompanySubnav from its own
  // app/dashboard/company/layout.tsx. If DashboardGroupSubnav also rendered
  // one, two tab bars (each potentially disagreeing on which tab is active)
  // would stack on the same page.
  assert.match(src, /isDashboardRouteWithin\(pathname, "\/dashboard\/company"\)\)\s*return null/, "DashboardGroupSubnav must return null on /dashboard/company/* to avoid a duplicate tab bar");
});

// ─── Category E: sidebar icon identities or action meanings overlap ────────

test("category E: no two primary sidebar links share an iconName", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  const iconCounts = new Map<string, string[]>();
  for (const link of links) {
    const existing = iconCounts.get(link.iconName) ?? [];
    existing.push(link.href);
    iconCounts.set(link.iconName, existing);
  }
  const duplicates = [...iconCounts.entries()].filter(([, hrefs]) => hrefs.length > 1);
  assert.deepEqual(duplicates, [], `duplicate sidebar icons: ${duplicates.map(([icon, hrefs]) => `${icon} used by ${hrefs.join(", ")}`).join("; ")}`);
});

test("category E: engine-action-panel's two actions use visually and semantically distinct icons", () => {
  const src = readSource("components/engine-action-panel.tsx");
  // Safe Mode = BoltIcon (fast/deterministic), Full AI in background =
  // ClockIcon (long-running/background) — they must not both use the same
  // icon, which would make the two buttons look like the same action twice
  // even though their button text differs.
  assert.match(src, /import \{ BoltIcon, ClockIcon \} from "\.\/icons"/, "expected exactly BoltIcon + ClockIcon imported (no PlayIcon revival, no shared single icon for both actions)");

  const safeModeButtonMatch = src.match(/onClick=\{\(\) => runEngineAsync\(false, \{ safe: "true", skipAiRematch: "true" \}\)\}[\s\S]*?<\/button>/);
  assert.ok(safeModeButtonMatch, "expected to find the Safe Mode button block");
  assert.match(safeModeButtonMatch![0], /<BoltIcon \/> Run Safe Mode — Recommended/, "idle Safe Mode button must show BoltIcon, not share an icon with the background button");

  const backgroundButtonMatch = src.match(/onClick=\{\(\) => runEngineAsync\(false\)\}[\s\S]*?<\/button>/);
  assert.ok(backgroundButtonMatch, "expected to find the Full AI in Background button block");
  assert.match(backgroundButtonMatch![0], /Run Full AI in Background/);
});
