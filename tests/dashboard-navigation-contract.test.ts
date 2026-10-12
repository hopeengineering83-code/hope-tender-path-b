import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_NAV_GROUPS,
  filterDashboardNavGroupsByRole,
  flattenDashboardLinks,
  getActiveDashboardHref,
  isDashboardRouteWithin,
  type DashboardNavGroup,
} from "../lib/dashboard-navigation";

// Synthetic fixture for the pure active-href/containment helpers. The hrefs and
// nesting are the subject here; the icon names are arbitrary valid values and
// carry no meaning — real icon semantics are covered by
// tests/semantic-icon-registry.test.ts.
const groups: DashboardNavGroup[] = [
  {
    title: "Workspace",
    roles: null,
    links: [
      { href: "/dashboard", label: "Overview", iconName: "BrainIcon" },
      { href: "/dashboard/tenders", label: "Tenders", iconName: "ListIcon" },
    ],
  },
  {
    title: "Knowledge",
    roles: ["ADMIN", "PROPOSAL_MANAGER"],
    links: [
      { href: "/dashboard/company", label: "Company", iconName: "DatabaseIcon" },
      { href: "/dashboard/company/readiness", label: "Readiness", iconName: "DocumentIcon" },
      { href: "/dashboard/company/review", label: "Review", iconName: "GaugeIcon" },
    ],
  },
];

test("overview is exact and a child route has one active authority", () => {
  assert.equal(getActiveDashboardHref("/dashboard", groups), "/dashboard");
  assert.equal(getActiveDashboardHref("/dashboard/tenders", groups), "/dashboard/tenders");
  assert.equal(getActiveDashboardHref("/dashboard/company/readiness", groups), "/dashboard/company/readiness");
});

test("the deepest path-segment-safe parent wins", () => {
  assert.equal(getActiveDashboardHref("/dashboard/company/readiness/details", groups), "/dashboard/company/readiness");
  assert.equal(isDashboardRouteWithin("/dashboard/company-review", "/dashboard/company"), false);
  assert.equal(isDashboardRouteWithin("/dashboard/companyish", "/dashboard/company"), false);
});

test("unadvertised admin root has no active item", () => {
  assert.equal(getActiveDashboardHref("/dashboard/admin", groups), null);
});

test("canonical navigation keeps route and icon identities unique and complete (post-consolidation: 5 primary destinations)", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  // Consolidated from 23 top-level items down to 5 — Tenders (includes
  // Overview, History, Calendar), Company Vault (+7 members), Engine
  // (+2 members), Documents & Export (+1 member), Administration
  // (+6 members). Overview was merged into Tenders per the product-goal
  // consolidation (maximum five primary navigation destinations).
  assert.equal(links.length, 5);
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
  assert.ok(links.every((link) => link.iconName.endsWith("Icon")));
  assert.ok(links.some((link) => link.href === "/dashboard/documents"));

  // Every nav item must render a visually distinct icon. Two links sharing an
  // iconName is a real user-facing bug (the sidebar shows the identical glyph
  // for two unrelated pages) that the href-uniqueness check above cannot
  // catch, since it only asserts routes are unique, not icons.
  const iconCounts = new Map<string, string[]>();
  for (const link of links) {
    const existing = iconCounts.get(link.iconName) ?? [];
    existing.push(link.href);
    iconCounts.set(link.iconName, existing);
  }
  const duplicates = [...iconCounts.entries()].filter(([, hrefs]) => hrefs.length > 1);
  assert.deepEqual(
    duplicates,
    [],
    `duplicate nav icons: ${duplicates.map(([icon, hrefs]) => `${icon} used by ${hrefs.join(", ")}`).join("; ")}`,
  );
});

test("no route is advertised as a primary href in one link and also listed as a memberHref of another", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  const primaryHrefs = new Set(links.map((link) => link.href));
  for (const link of links) {
    for (const member of link.memberHrefs ?? []) {
      assert.ok(!primaryHrefs.has(member), `"${member}" is both a primary href and a memberHref of "${link.href}" — one active destination only`);
    }
  }
});

test("consolidated member routes (not path-nested under their group's primary href) still resolve to the one correct sidebar destination", () => {
  // These pairs are exactly the "combine under one destination" cases from
  // the app-wide consolidation — none of them share a path prefix with
  // their group's primary href, so only the memberHrefs mechanism (not
  // ordinary prefix matching) can attribute them correctly.
  const cases: Array<[string, string]> = [
    ["/dashboard/history", "/dashboard/tenders"],
    ["/dashboard/calendar", "/dashboard/tenders"],
    ["/dashboard/assets", "/dashboard/company"],
    ["/dashboard/setup", "/dashboard/company"],
    ["/dashboard/settings", "/dashboard/company"],
    ["/dashboard/matching", "/dashboard/analysis"],
    ["/dashboard/compliance", "/dashboard/analysis"],
    ["/dashboard/export", "/dashboard/documents"],
    ["/dashboard/analytics", "/dashboard/activity"],
    ["/dashboard/admin/ai-readiness", "/dashboard/activity"],
    ["/dashboard/system", "/dashboard/activity"],
    ["/dashboard/admin/safety-center", "/dashboard/activity"],
    ["/dashboard/users", "/dashboard/activity"],
    ["/dashboard/admin", "/dashboard/activity"],
  ];
  for (const [memberRoute, expectedPrimary] of cases) {
    assert.equal(
      getActiveDashboardHref(memberRoute, DASHBOARD_NAV_GROUPS),
      expectedPrimary,
      `visiting ${memberRoute} must activate the ${expectedPrimary} sidebar destination`,
    );
  }
});

test("role presentation filtering preserves shared groups and hides restricted groups", () => {
  const viewerGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "VIEWER");
  assert.deepEqual(viewerGroups.map((group) => group.title), ["Workspace", "Engine"]);

  const managerGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "PROPOSAL_MANAGER");
  assert.deepEqual(managerGroups.map((group) => group.title), ["Workspace", "Knowledge", "Engine"]);

  const adminGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "ADMIN");
  assert.deepEqual(adminGroups.map((group) => group.title), ["Workspace", "Knowledge", "Engine", "Admin"]);
});
