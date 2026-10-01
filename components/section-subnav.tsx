"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isDashboardRouteWithin } from "../lib/dashboard-navigation";

export type SectionSubnavTab = { href: string; label: string };

// Longest matching href wins — the same rule getActiveDashboardHref uses for
// the primary sidebar, so a more specific nested route can never be shadowed
// by a shorter sibling prefix.
function activeTabHref(pathname: string, tabs: SectionSubnavTab[]): string | null {
  const matches = tabs.filter((tab) => isDashboardRouteWithin(pathname, tab.href));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.href.length - a.href.length)[0].href;
}

/**
 * Cross-navigation tabs for a group of sibling routes consolidated under one
 * primary-sidebar destination (e.g. Tenders, Engine, Documents & Export,
 * Administration). Each group's primary sidebar link now points at only the
 * first tab's route; this bar is how the other routes in the group stay one
 * click away instead of requiring a trip back to a since-removed sidebar
 * entry. No route was moved or renamed — every href here already existed
 * before this consolidation, so no redirect is required for any of them.
 */
export function SectionSubnav({ tabs, label }: { tabs: SectionSubnavTab[]; label: string }) {
  const pathname = usePathname();
  const active = activeTabHref(pathname, tabs);

  return (
    <nav aria-label={label} className="mb-5 flex min-w-0 flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium ${
              isActive ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
