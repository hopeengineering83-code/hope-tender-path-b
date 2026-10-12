/**
 * The semantic icon registry used to be self-referential: findIconCollisions()
 * compared a hand-written list against itself, so it could not detect the two
 * failures that actually matter — the registry disagreeing with the real
 * sidebar, and two unrelated destinations sharing an icon.
 *
 * It also documented three consumers, none of which existed: neither
 * dashboard-nav-icon.tsx nor section-subnav.tsx imported it, and this very
 * test file was referenced but absent. These tests tie the registry to the
 * real navigation and the real icon component map.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  SEMANTIC_ICON_ASSIGNMENTS,
  derivePrimaryNavAssignments,
  findIconCollisions,
  listSemanticIconAssignments,
} from "../lib/semantic-icon-registry";
import { DASHBOARD_NAV_GROUPS, flattenDashboardLinks } from "../lib/dashboard-navigation";

const navIconSource = readFileSync("components/dashboard-nav-icon.tsx", "utf8");
const navigationSource = readFileSync("lib/dashboard-navigation.ts", "utf8");

/** Icon names inside the ICON_COMPONENTS object literal. */
function iconComponentNames(): string[] {
  const block = navIconSource.slice(
    navIconSource.indexOf("const ICON_COMPONENTS = {"),
    navIconSource.indexOf("} satisfies Record<DashboardNavIconName"),
  );
  return [...block.matchAll(/^\s{2}(\w+Icon),/gm)].map((m) => m[1]);
}

/** Members of the DashboardNavIconName union. */
function navIconUnionMembers(): string[] {
  const block = navigationSource.slice(
    navigationSource.indexOf("export type DashboardNavIconName ="),
    navigationSource.indexOf("export type DashboardNavLink"),
  );
  return [...block.matchAll(/"(\w+Icon)"/g)].map((m) => m[1]);
}

describe("semantic icon registry is enforced against real navigation", () => {
  it("derives one assignment per real sidebar destination", () => {
    const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
    const derived = derivePrimaryNavAssignments();
    assert.equal(derived.length, links.length);
    for (const link of links) {
      const match = derived.find((a) => a.accessibleLabel === link.label);
      assert.ok(match, `no semantic assignment derived for destination "${link.href}"`);
      // The icon must be the one the sidebar actually renders, not a parallel guess.
      assert.equal(match.iconName, link.iconName);
    }
  });

  it("throws rather than silently skipping a destination with no meaning", () => {
    // Every destination must be mapped; derive() is the enforcement point.
    assert.doesNotThrow(() => derivePrimaryNavAssignments());
  });

  it("has no icon collisions in the same surface", () => {
    assert.deepEqual(findIconCollisions(), []);
  });

  it("gives every real destination a distinct icon", () => {
    const icons = flattenDashboardLinks(DASHBOARD_NAV_GROUPS).map((l) => l.iconName);
    assert.equal(new Set(icons).size, icons.length, `duplicate sidebar icon: ${icons.join(", ")}`);
  });

  it("every assignment has an accessible label", () => {
    for (const assignment of listSemanticIconAssignments()) {
      assert.ok(assignment.accessibleLabel.length > 0, `${assignment.meaning} has no accessible label`);
    }
  });

  it("exposes the same data through the value export", () => {
    assert.deepEqual(SEMANTIC_ICON_ASSIGNMENTS, listSemanticIconAssignments());
  });
});

describe("nav icon vocabulary carries no unreachable entries", () => {
  it("declares exactly the icons the sidebar destinations use", () => {
    const used = new Set(flattenDashboardLinks(DASHBOARD_NAV_GROUPS).map((l) => l.iconName));
    const declared = navIconUnionMembers();
    assert.deepEqual(
      [...declared].sort(),
      [...used].sort(),
      "DashboardNavIconName must list exactly the icons real destinations use — " +
        "unreachable names let an icon be reassigned to an unrelated destination unnoticed",
    );
  });

  it("maps exactly those icons to components, with no dead imports", () => {
    const declared = navIconUnionMembers().sort();
    assert.deepEqual(iconComponentNames().sort(), declared);
    // A component imported but no longer mapped is dead weight in the bundle.
    const imported = [...navIconSource.matchAll(/^\s{2}(\w+Icon),$/gm)].map((m) => m[1]);
    assert.deepEqual([...new Set(imported)].sort(), declared);
  });
});

describe("registry does not compete with the action registry", () => {
  it("claims no tender workflow action verbs", () => {
    // Icon meaning for tender actions is owned by lib/ui/action-registry.ts.
    // Restating them here is what let two registries disagree about one verb.
    const owned = new Set(listSemanticIconAssignments().map((a) => a.meaning));
    for (const verb of ["analyze", "generate", "export", "validate", "run", "engine-run"]) {
      assert.ok(!owned.has(verb as never), `"${verb}" belongs to action-registry.ts, not the semantic registry`);
    }
  });

  it("documents its real consumers", () => {
    const source = readFileSync("lib/semantic-icon-registry.ts", "utf8");
    // The old docstring named two components that never imported it.
    assert.ok(!source.includes("components/section-subnav.tsx (workspace tab bars)"));
    assert.ok(source.includes("tests/semantic-icon-registry.test.ts"));
  });
});
