"use client";

// Page title shown in the sticky header so the user always knows which page
// they're on — especially on mobile where the sidebar is hidden and the only
// other context is the "Hope Tender" wordmark in the mobile top bar.
//
// Label resolution lives in lib/dashboard-navigation.ts's getDashboardPageLabel
// so the nav sidebar, mobile menu, and this header all resolve a pathname to
// exactly one label from the same canonical registry, instead of each
// maintaining its own copy of the route list.

import { usePathname } from "next/navigation";
import { getDashboardPageLabel } from "../lib/dashboard-navigation";

export function HeaderPageTitle() {
  const pathname = usePathname();
  const label = getDashboardPageLabel(pathname);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="truncate text-sm font-semibold text-slate-700" aria-label="Current page">
        {label}
      </h2>
    </div>
  );
}
