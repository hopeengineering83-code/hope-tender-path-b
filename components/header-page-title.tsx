"use client";

// Page title shown in the sticky header so the user always knows which page
// they're on — especially on mobile where the sidebar is hidden and the only
// other context is the "Hope Tender" wordmark in the mobile top bar.
//
// Derives the page title from the current pathname using the same navigation
// groups defined in lib/dashboard-navigation.ts. Falls back to "Dashboard"
// for unknown routes.

import { usePathname } from "next/navigation";
import { DASHBOARD_NAV_GROUPS, type DashboardNavGroup } from "../lib/dashboard-navigation";

function findPageLabel(pathname: string, groups: DashboardNavGroup[]): string {
  for (const group of groups) {
    for (const link of group.links) {
      if (pathname === link.href || pathname.startsWith(link.href + "/")) {
        return link.label;
      }
    }
  }
  // Special cases for tender detail and sub-routes
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/command-center")) {
    return "Tender Command Center";
  }
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/report")) {
    return "Tender Report";
  }
  if (pathname.startsWith("/dashboard/tenders/")) {
    return "Tender Detail";
  }
  if (pathname.startsWith("/dashboard/company/")) {
    return "Company";
  }
  if (pathname.startsWith("/dashboard/admin/")) {
    return "Admin";
  }
  return "Dashboard";
}

export function HeaderPageTitle() {
  const pathname = usePathname();
  const label = findPageLabel(pathname, DASHBOARD_NAV_GROUPS);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="truncate text-sm font-semibold text-slate-700" aria-label="Current page">
        {label}
      </h2>
    </div>
  );
}
