/**
 * Semantic Icon Registry — navigation and generic UI affordance icons.
 *
 * Scope, and what this file deliberately does NOT own:
 *
 * Icon meaning for **tender workflow actions** (run engine, analyze, generate,
 * export, …) is owned exclusively by `lib/ui/action-registry.ts`. This file
 * must never restate those, or the two registries can disagree about the same
 * verb. What lives here is the complement: sidebar destinations and the
 * generic affordances (close/expand/collapse/refresh) that are not tender
 * actions at all.
 *
 * Primary-nav assignments are **derived** from DASHBOARD_NAV_GROUPS rather than
 * hand-listed. They used to be hand-listed, which let them drift: the list
 * still declared a `home`/"Overview" destination with its own icon long after
 * the route consolidation folded `/dashboard` into Tenders, and nothing caught
 * it because the collision check only compared the hand-written list against
 * itself.
 *
 * Enforced by `tests/semantic-icon-registry.test.ts`, which checks this
 * registry against the real navigation and the real icon component map — not
 * against itself.
 */

import { DASHBOARD_NAV_GROUPS, flattenDashboardLinks } from "./dashboard-navigation";

/**
 * Meanings owned by this registry. Workflow/action verbs are intentionally
 * absent — see the module docstring.
 */
export type SemanticIconMeaning =
  // Navigation destinations (derived from DASHBOARD_NAV_GROUPS)
  | "tenders"
  | "company"
  | "engine"
  | "documents"
  | "admin"
  // Header affordances
  | "search"
  | "notifications"
  // Generic UI affordances (not tender actions)
  | "close"
  | "expand"
  | "collapse"
  | "refresh";

export type SemanticIconAssignment = {
  meaning: SemanticIconMeaning;
  iconName: string;
  surface: string;
  accessibleLabel: string;
};

/**
 * Maps a sidebar destination href to its semantic meaning. Every destination in
 * DASHBOARD_NAV_GROUPS must appear here; the regression test fails otherwise,
 * so adding a destination without giving it a meaning is caught immediately.
 */
const NAV_MEANING_BY_HREF: Record<string, SemanticIconMeaning> = {
  "/dashboard/tenders": "tenders",
  "/dashboard/company": "company",
  "/dashboard/analysis": "engine",
  "/dashboard/documents": "documents",
  "/dashboard/activity": "admin",
};

/**
 * Primary-nav assignments, derived from the navigation itself so the icon and
 * label can never disagree with what the sidebar actually renders.
 */
export function derivePrimaryNavAssignments(): SemanticIconAssignment[] {
  return flattenDashboardLinks(DASHBOARD_NAV_GROUPS).map((link) => {
    const meaning = NAV_MEANING_BY_HREF[link.href];
    if (!meaning) {
      throw new Error(
        `Navigation destination "${link.href}" has no semantic meaning. ` +
          `Add it to NAV_MEANING_BY_HREF in lib/semantic-icon-registry.ts.`,
      );
    }
    return {
      meaning,
      iconName: link.iconName,
      surface: "primary-nav",
      accessibleLabel: link.label,
    };
  });
}

/** Assignments that are not derivable from navigation. */
const STATIC_ASSIGNMENTS: SemanticIconAssignment[] = [
  { meaning: "search", iconName: "SearchIcon", surface: "header", accessibleLabel: "Global Search" },
  { meaning: "notifications", iconName: "BellIcon", surface: "header", accessibleLabel: "Notifications" },
  { meaning: "close", iconName: "CrossIcon", surface: "action", accessibleLabel: "Close" },
  { meaning: "expand", iconName: "ChevronDownIcon", surface: "action", accessibleLabel: "Expand" },
  { meaning: "collapse", iconName: "ChevronUpIcon", surface: "action", accessibleLabel: "Collapse" },
  { meaning: "refresh", iconName: "RefreshIcon", surface: "action", accessibleLabel: "Refresh" },
];

/** Canonical semantic icon assignments: derived navigation plus static surfaces. */
export function listSemanticIconAssignments(): SemanticIconAssignment[] {
  return [...derivePrimaryNavAssignments(), ...STATIC_ASSIGNMENTS];
}

/**
 * Kept as a value export for existing callers. Evaluated once at module load;
 * navigation is a static constant, so this cannot go stale at runtime.
 */
export const SEMANTIC_ICON_ASSIGNMENTS: SemanticIconAssignment[] = listSemanticIconAssignments();

/**
 * Two assignments sharing a surface and icon but meaning different things is a
 * collision. Because navigation entries are derived, this now catches a real
 * duplicate icon in the real sidebar, not just a typo in a parallel list.
 */
export function findIconCollisions(): string[] {
  const collisions: string[] = [];
  const seen = new Map<string, SemanticIconAssignment>();

  for (const assignment of listSemanticIconAssignments()) {
    const key = `${assignment.surface}:${assignment.iconName}`;
    const existing = seen.get(key);
    if (existing && existing.meaning !== assignment.meaning) {
      collisions.push(
        `Icon collision in surface "${assignment.surface}": icon "${assignment.iconName}" ` +
        `is assigned to both "${existing.meaning}" and "${assignment.meaning}"`
      );
    }
    seen.set(key, assignment);
  }

  return collisions;
}
