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

const groups: DashboardNavGroup[] = [
  {
    title: "Workspace",
    roles: null,
    links: [
      { href: "/dashboard", label: "Overview", iconName: "HomeIcon" },
      { href: "/dashboard/tenders", label: "Tenders", iconName: "ListIcon" },
    ],
  },
  {
    title: "Knowledge",
    roles: ["ADMIN", "PROPOSAL_MANAGER"],
    links: [
      { href: "/dashboard/company", label: "Company", iconName: "DatabaseIcon" },
      { href: "/dashboard/company/readiness", label: "Readiness", iconName: "TrendingUpIcon" },
      { href: "/dashboard/company/review", label: "Review", iconName: "CodeIcon" },
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

test("canonical navigation keeps route and icon identities unique and complete", () => {
  const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
  assert.equal(links.length, 23);
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
  assert.ok(links.every((link) => link.iconName.endsWith("Icon")));
  assert.ok(links.some((link) => link.href === "/dashboard/admin/ai-readiness"));
  assert.ok(links.some((link) => link.href === "/dashboard/documents"));
});

test("role presentation filtering preserves shared groups and hides restricted groups", () => {
  const viewerGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "VIEWER");
  assert.deepEqual(viewerGroups.map((group) => group.title), ["Workspace", "Engine"]);

  const managerGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "PROPOSAL_MANAGER");
  assert.deepEqual(managerGroups.map((group) => group.title), ["Workspace", "Knowledge", "Engine"]);

  const adminGroups = filterDashboardNavGroupsByRole(DASHBOARD_NAV_GROUPS, "ADMIN");
  assert.deepEqual(adminGroups.map((group) => group.title), ["Workspace", "Knowledge", "Engine", "Admin"]);
});
