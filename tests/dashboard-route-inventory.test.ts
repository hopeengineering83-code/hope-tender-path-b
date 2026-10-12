import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Navigation routes were centralized into lib/dashboard-navigation.ts by
// PR #1219 (nav icon registry). The test previously read app/dashboard/layout.tsx
// for href patterns — now reads from the canonical navigation module.
const navSource = readFileSync("lib/dashboard-navigation.ts", "utf8");
const advertisedRoutes = [...navSource.matchAll(/href:\s*["'](\/dashboard(?:\/[^"']*)?)["']/g)].map((match) => match[1]);

function pageFileFor(route: string): string {
  const suffix = route === "/dashboard" ? "" : route.slice("/dashboard/".length);
  return join("app", "dashboard", suffix, "page.tsx");
}

test("every statically advertised dashboard route has a page", () => {
  assert.ok(advertisedRoutes.length > 0, "expected dashboard navigation routes");
  assert.equal(new Set(advertisedRoutes).size, advertisedRoutes.length, "dashboard navigation must not advertise duplicate routes");
  for (const route of advertisedRoutes) {
    assert.equal(existsSync(pageFileFor(route)), true, `${route} must resolve to ${pageFileFor(route)}`);
  }
});

test("dashboard admin root is implemented (ADMIN-gated) but intentionally not advertised in nav", () => {
  // SCREENSHOT-R2 fixed the /dashboard/admin 404 (a documented critical
  // screenshot gap): the route now resolves to a real ADMIN-gated landing
  // page linking to its sub-pages, guarded by the same shared
  // requireDashboardRole helper as settings/assets/setup/users. It remains
  // deliberately absent from the main nav — it's reached directly or via
  // its sub-pages' breadcrumbs, not as a top-level nav item.
  assert.equal(advertisedRoutes.includes("/dashboard/admin"), false);
  assert.equal(existsSync("app/dashboard/admin/page.tsx"), true);
  assert.equal(existsSync("app/dashboard/admin/layout.tsx"), true, "admin root must use the shared role guard, not an inline check");
  assert.equal(existsSync("app/dashboard/admin/ai-readiness/page.tsx"), true, "authorized child admin route remains available");
});

test("owned restricted routes use the shared server-side role guard", () => {
  const expected: Record<string, string[]> = {
    "app/dashboard/settings/layout.tsx": ["ADMIN", "PROPOSAL_MANAGER"],
    "app/dashboard/assets/layout.tsx": ["ADMIN", "PROPOSAL_MANAGER"],
    "app/dashboard/setup/layout.tsx": ["ADMIN", "PROPOSAL_MANAGER"],
    "app/dashboard/users/layout.tsx": ["ADMIN"],
  };

  for (const [path, roles] of Object.entries(expected)) {
    assert.equal(existsSync(path), true, `${path} must exist`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireDashboardRole/);
    for (const role of roles) assert.match(source, new RegExp(`["']${role}["']`));
  }
});
