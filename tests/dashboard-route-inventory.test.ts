import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const layoutSource = readFileSync("app/dashboard/layout.tsx", "utf8");
const advertisedRoutes = [...layoutSource.matchAll(/href:\s*["'](\/dashboard(?:\/[^"']*)?)["']/g)].map((match) => match[1]);

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

test("dead dashboard admin root is neither advertised nor implemented", () => {
  assert.equal(advertisedRoutes.includes("/dashboard/admin"), false);
  assert.equal(existsSync("app/dashboard/admin/page.tsx"), false);
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
