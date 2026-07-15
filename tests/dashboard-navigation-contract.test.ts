import assert from "node:assert/strict";
import test from "node:test";
import { getActiveDashboardHref, isDashboardRouteWithin, type DashboardNavGroup } from "../lib/dashboard-navigation";

const groups: DashboardNavGroup[] = [
  { title: "Workspace", links: [
    { href: "/dashboard", label: "Overview", icon: "home" },
    { href: "/dashboard/tenders", label: "Tenders", icon: "list" },
  ] },
  { title: "Knowledge", links: [
    { href: "/dashboard/company", label: "Company", icon: "vault" },
    { href: "/dashboard/company/readiness", label: "Readiness", icon: "chart" },
    { href: "/dashboard/company/review", label: "Review", icon: "review" },
  ] },
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
