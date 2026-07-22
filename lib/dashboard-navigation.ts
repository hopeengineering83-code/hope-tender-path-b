export type DashboardNavIconName =
  | "HomeIcon" | "ListIcon" | "ClockIcon" | "CalendarIcon" | "DatabaseIcon"
  | "TrendingUpIcon" | "UploadIcon" | "ClipboardCheckIcon" | "CodeIcon"
  | "ImageIcon" | "SparklesIcon" | "SettingsIcon" | "BrainIcon" | "PuzzleIcon"
  | "ShieldIcon" | "DocumentIcon" | "PackageIcon" | "BarChartIcon" | "SearchIcon"
  | "UsersIcon" | "GaugeIcon" | "FlagIcon" | "BellIcon";

export type DashboardNavLink = {
  href: string;
  label: string;
  iconName: DashboardNavIconName;
  memberHrefs?: string[];
};

export type DashboardNavGroup = { title: string; links: DashboardNavLink[]; roles: string[] | null };

function normalizePath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "") || "/";
}

export function flattenDashboardLinks(groups: DashboardNavGroup[]): DashboardNavLink[] {
  return groups.flatMap((group) => group.links);
}

export function isDashboardRouteWithin(pathname: string, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);
  return target === "/dashboard" ? current === target : current === target || current.startsWith(`${target}/`);
}

export function getActiveDashboardHref(pathname: string, groups: DashboardNavGroup[]): string | null {
  const current = normalizePath(pathname);
  const links = flattenDashboardLinks(groups);
  const exact = links.find((link) => normalizePath(link.href) === current);
  if (exact) return exact.href;
  const memberMatch = links.find((link) => link.memberHrefs?.some((member) => isDashboardRouteWithin(current, member)));
  if (memberMatch) return memberMatch.href;
  return links
    .filter((link) => isDashboardRouteWithin(current, link.href))
    .sort((a, b) => normalizePath(b.href).length - normalizePath(a.href).length)[0]?.href ?? null;
}

/**
 * Five permanent product workspaces. Overview remains available at /dashboard
 * from the product logo/header but is not a competing primary destination.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    title: "Tender work",
    roles: null,
    links: [
      {
        href: "/dashboard/tenders",
        label: "Tenders",
        iconName: "ListIcon",
        memberHrefs: ["/dashboard", "/dashboard/history", "/dashboard/calendar"],
      },
      {
        href: "/dashboard/analysis",
        label: "Tender Engine",
        iconName: "BrainIcon",
        memberHrefs: ["/dashboard/matching", "/dashboard/compliance"],
      },
      {
        href: "/dashboard/documents",
        label: "Outputs",
        iconName: "PackageIcon",
        memberHrefs: ["/dashboard/export"],
      },
    ],
  },
  {
    title: "Company",
    roles: ["ADMIN", "PROPOSAL_MANAGER"],
    links: [
      {
        href: "/dashboard/company",
        label: "Company Vault",
        iconName: "DatabaseIcon",
        memberHrefs: [
          "/dashboard/company/readiness", "/dashboard/company/plan-b-import",
          "/dashboard/company/review-board", "/dashboard/company/review",
          "/dashboard/assets", "/dashboard/setup", "/dashboard/settings",
        ],
      },
    ],
  },
  {
    title: "Administration",
    roles: ["ADMIN"],
    links: [
      {
        href: "/dashboard/activity",
        label: "Administration",
        iconName: "GaugeIcon",
        memberHrefs: [
          "/dashboard/analytics", "/dashboard/admin/ai-readiness", "/dashboard/system",
          "/dashboard/admin/safety-center", "/dashboard/users", "/dashboard/admin",
        ],
      },
    ],
  },
];

export function filterDashboardNavGroupsByRole(groups: DashboardNavGroup[], userRole: string): DashboardNavGroup[] {
  return groups
    .filter((group) => group.roles === null || group.roles.includes(userRole))
    .map((group) => ({ ...group, links: [...group.links], roles: group.roles ? [...group.roles] : null }));
}

const SUPPLEMENTARY_ROUTE_LABELS: Array<{ route: string; label: string }> = [
  { route: "/dashboard", label: "Overview" },
  { route: "/dashboard/account", label: "Account" },
  { route: "/dashboard/admin", label: "Admin" },
  { route: "/dashboard/admin/safety-center", label: "System Safety Center" },
  { route: "/dashboard/company/profile", label: "Company Profile Editor" },
  { route: "/dashboard/history", label: "Tender History" },
  { route: "/dashboard/calendar", label: "Deadline Calendar" },
  { route: "/dashboard/company/readiness", label: "Profile Readiness" },
  { route: "/dashboard/company/plan-b-import", label: "Legacy Data Import" },
  { route: "/dashboard/company/review-board", label: "Review Board" },
  { route: "/dashboard/company/review", label: "Data Diagnostics" },
  { route: "/dashboard/assets", label: "Brand Assets" },
  { route: "/dashboard/setup", label: "Setup Wizard" },
  { route: "/dashboard/settings", label: "Settings" },
  { route: "/dashboard/matching", label: "Global Matching" },
  { route: "/dashboard/compliance", label: "Global Compliance" },
  { route: "/dashboard/export", label: "Export Hub" },
  { route: "/dashboard/analytics", label: "System Analytics" },
  { route: "/dashboard/admin/ai-readiness", label: "AI Readiness" },
  { route: "/dashboard/system", label: "System Status" },
  { route: "/dashboard/users", label: "User Management" },
];

export function getDashboardPageLabel(pathname: string): string {
  const current = normalizePath(pathname);
  const candidates = [
    ...flattenDashboardLinks(DASHBOARD_NAV_GROUPS),
    ...SUPPLEMENTARY_ROUTE_LABELS.map(({ route, label }) => ({ href: route, label, iconName: "HomeIcon" as const })),
  ];
  const exact = candidates.find((link) => normalizePath(link.href) === current);
  if (exact) return exact.label;
  const parent = candidates
    .filter((link) => isDashboardRouteWithin(current, link.href))
    .sort((a, b) => normalizePath(b.href).length - normalizePath(a.href).length)[0];
  if (parent) return parent.label;
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/command-center")) return "Tender Command Center";
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/report")) return "Tender Report";
  if (pathname.startsWith("/dashboard/tenders/")) return "Tender Detail";
  if (pathname.startsWith("/dashboard/admin/")) return "Admin";
  if (pathname.startsWith("/dashboard/company/")) return "Company";
  return "Dashboard";
}
