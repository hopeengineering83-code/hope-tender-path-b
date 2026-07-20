export type DashboardNavIconName =
  | "HomeIcon"
  | "ListIcon"
  | "ClockIcon"
  | "CalendarIcon"
  | "DatabaseIcon"
  | "TrendingUpIcon"
  | "UploadIcon"
  | "ClipboardCheckIcon"
  | "CodeIcon"
  | "ImageIcon"
  | "SparklesIcon"
  | "SettingsIcon"
  | "BrainIcon"
  | "PuzzleIcon"
  | "ShieldIcon"
  | "DocumentIcon"
  | "PackageIcon"
  | "BarChartIcon"
  | "SearchIcon"
  | "UsersIcon"
  | "GaugeIcon";

export type DashboardNavLink = {
  href: string;
  label: string;
  iconName: DashboardNavIconName;
};

export type DashboardNavGroup = {
  title: string;
  links: DashboardNavLink[];
  roles: string[] | null;
};

function normalizePath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function flattenDashboardLinks(groups: DashboardNavGroup[]): DashboardNavLink[] {
  return groups.flatMap((group) => group.links);
}

export function isDashboardRouteWithin(pathname: string, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);

  if (target === "/dashboard") return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/**
 * Returns one authoritative active navigation href.
 *
 * Exact matches win. Otherwise the longest path-segment-safe parent wins.
 */
export function getActiveDashboardHref(
  pathname: string,
  groups: DashboardNavGroup[],
): string | null {
  const current = normalizePath(pathname);
  const links = flattenDashboardLinks(groups);

  const exact = links.find((link) => normalizePath(link.href) === current);
  if (exact) return exact.href;

  const parents = links
    .filter((link) => isDashboardRouteWithin(current, link.href))
    .sort((a, b) => normalizePath(b.href).length - normalizePath(a.href).length);

  return parents[0]?.href ?? null;
}

/**
 * Canonical dashboard navigation registry.
 *
 * Keep route labels, role visibility, and icon identities together so desktop
 * and mobile navigation cannot drift. Route and API authorization remain
 * server-side security boundaries; this registry controls presentation only.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    title: "Workspace",
    roles: null,
    links: [
      { href: "/dashboard", label: "Overview", iconName: "HomeIcon" },
      { href: "/dashboard/tenders", label: "Active Tenders", iconName: "ListIcon" },
      { href: "/dashboard/history", label: "Tender History", iconName: "ClockIcon" },
      { href: "/dashboard/calendar", label: "Deadline Calendar", iconName: "CalendarIcon" },
    ],
  },
  {
    title: "Knowledge",
    roles: ["ADMIN", "PROPOSAL_MANAGER"],
    links: [
      { href: "/dashboard/company", label: "Knowledge Vault", iconName: "DatabaseIcon" },
      { href: "/dashboard/company/readiness", label: "Profile Readiness", iconName: "TrendingUpIcon" },
      { href: "/dashboard/company/plan-b-import", label: "Legacy Data Import", iconName: "UploadIcon" },
      { href: "/dashboard/company/review-board", label: "Review Board", iconName: "ClipboardCheckIcon" },
      { href: "/dashboard/company/review", label: "Data Diagnostics", iconName: "CodeIcon" },
      { href: "/dashboard/assets", label: "Brand Assets", iconName: "ImageIcon" },
      { href: "/dashboard/setup", label: "Setup Wizard", iconName: "SparklesIcon" },
      { href: "/dashboard/settings", label: "Settings", iconName: "SettingsIcon" },
    ],
  },
  {
    title: "Engine",
    roles: null,
    links: [
      { href: "/dashboard/analysis", label: "Global Analysis", iconName: "BrainIcon" },
      { href: "/dashboard/matching", label: "Global Matching", iconName: "PuzzleIcon" },
      { href: "/dashboard/compliance", label: "Global Compliance", iconName: "ShieldIcon" },
      { href: "/dashboard/documents", label: "Document Archive", iconName: "DocumentIcon" },
      { href: "/dashboard/export", label: "Export Hub", iconName: "PackageIcon" },
      { href: "/dashboard/activity", label: "Activity Logs", iconName: "ListIcon" },
      { href: "/dashboard/analytics", label: "System Analytics", iconName: "BarChartIcon" },
      { href: "/dashboard/search", label: "Global Search", iconName: "SearchIcon" },
    ],
  },
  {
    title: "Admin",
    roles: ["ADMIN"],
    links: [
      { href: "/dashboard/users", label: "User Management", iconName: "UsersIcon" },
      { href: "/dashboard/admin/ai-readiness", label: "AI Readiness", iconName: "SparklesIcon" },
      { href: "/dashboard/system", label: "System Status", iconName: "GaugeIcon" },
    ],
  },
];

export function filterDashboardNavGroupsByRole(
  groups: DashboardNavGroup[],
  userRole: string,
): DashboardNavGroup[] {
  return groups
    .filter((group) => group.roles === null || group.roles.includes(userRole))
    .map((group) => ({
      ...group,
      links: [...group.links],
      roles: group.roles ? [...group.roles] : null,
    }));
}
