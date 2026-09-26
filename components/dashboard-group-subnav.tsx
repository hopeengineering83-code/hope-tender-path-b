"use client";

import { usePathname } from "next/navigation";
import { isDashboardRouteWithin } from "../lib/dashboard-navigation";
import { CompanySubnav } from "./company-subnav";
import { SectionSubnav, type SectionSubnavTab } from "./section-subnav";

type Group = { label: string; tabs: SectionSubnavTab[] };

// Every group the primary sidebar now consolidates into one destination
// (see lib/dashboard-navigation.ts) except Company Vault, which is handled
// below as a special case. No route here moved or was renamed — every href
// already existed before this consolidation.
const GROUPS: Group[] = [
  {
    label: "Tenders workspace",
    tabs: [
      { href: "/dashboard/tenders", label: "Active Tenders" },
      { href: "/dashboard/history", label: "Tender History" },
      { href: "/dashboard/calendar", label: "Deadline Calendar" },
    ],
  },
  {
    label: "Engine workspace",
    tabs: [
      { href: "/dashboard/analysis", label: "Global Analysis" },
      { href: "/dashboard/matching", label: "Global Matching" },
      { href: "/dashboard/compliance", label: "Global Compliance" },
    ],
  },
  {
    label: "Documents workspace",
    tabs: [
      { href: "/dashboard/documents", label: "Document Archive" },
      { href: "/dashboard/export", label: "Export Hub" },
    ],
  },
  {
    label: "Administration workspace",
    tabs: [
      { href: "/dashboard/admin", label: "Admin" },
      { href: "/dashboard/activity", label: "Activity Logs" },
      { href: "/dashboard/analytics", label: "System Analytics" },
      { href: "/dashboard/admin/ai-readiness", label: "AI Readiness" },
      { href: "/dashboard/system", label: "System Status" },
      { href: "/dashboard/admin/safety-center", label: "Safety Center" },
      { href: "/dashboard/users", label: "User Management" },
    ],
  },
];

// Company Vault routes nested under /dashboard/company/* already render
// CompanySubnav from their own layout (app/dashboard/company/layout.tsx),
// which also knows the real setupComplete flag server-side — rendering it
// again here would duplicate the bar. Assets/Setup/Settings are part of the
// same consolidated group but are sibling top-level routes outside that
// layout, so this is the only place they can pick up the same tab bar. They
// don't have a reliable server-fetched setupComplete signal available to
// this client component, so Setup Wizard always renders here; it is hidden
// once complete only when reached via the true Knowledge Vault layout.
const COMPANY_VAULT_OUTSIDE_LAYOUT_PREFIXES = ["/dashboard/assets", "/dashboard/setup", "/dashboard/settings"];

export function DashboardGroupSubnav({ setupComplete = false }: { setupComplete?: boolean }) {
  const pathname = usePathname();

  if (isDashboardRouteWithin(pathname, "/dashboard/company")) return null;
  if (COMPANY_VAULT_OUTSIDE_LAYOUT_PREFIXES.some((prefix) => isDashboardRouteWithin(pathname, prefix))) {
    return <CompanySubnav setupComplete={setupComplete} />;
  }

  for (const group of GROUPS) {
    if (group.tabs.some((tab) => isDashboardRouteWithin(pathname, tab.href))) {
      return <SectionSubnav tabs={group.tabs} label={group.label} />;
    }
  }
  return null;
}
