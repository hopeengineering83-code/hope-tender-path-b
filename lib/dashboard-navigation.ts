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
  | "GaugeIcon"
  | "FlagIcon"
  | "BellIcon";

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
      { href: "/dashboard/setup", label: "Setup Wizard", iconName: "FlagIcon" },
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
      { href: "/dashboard/activity", label: "Activity Logs", iconName: "BellIcon" },
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

/**
 * Routes with a real, specific page title that are intentionally not (or not
 * only) reached from the primary sidebar — e.g. the account menu, the admin
 * index cards, or a workspace sub-nav rather than DASHBOARD_NAV_GROUPS. Keyed
 * as "route", not "href": dashboard-route-inventory.test.ts scans this file
 * for every literal `href:` key to build its nav-advertised-routes list, and
 * these routes are deliberately NOT advertised in the primary nav — reusing
 * "href" here would silently (and wrongly) enroll them in that list.
 * getDashboardPageLabel below applies the same longest-prefix-match rule to
 * these as it does to the primary registry, so a route being here doesn't
 * let it accidentally win over a more specific primary nav entry, or lose to
 * a shorter one.
 */
const SUPPLEMENTARY_ROUTE_LABELS: Array<{ route: string; label: string }> = [
  { route: "/dashboard/account", label: "Account" },
  { route: "/dashboard/admin", label: "Admin" },
  { route: "/dashboard/admin/safety-center", label: "System Safety Center" },
  { route: "/dashboard/company/profile", label: "Company Profile Editor" },
];

/**
 * One canonical page-title resolver for the sticky header, combining the
 * primary nav registry with the supplementary routes above. Longest matching
 * route wins — the same rule getActiveDashboardHref already uses — so this
 * can't regress into the first-match bug where a short prefix like
 * "/dashboard/company" silently wins over a longer, more specific route
 * such as "/dashboard/company/readiness" listed later in the same group.
 */
export function getDashboardPageLabel(pathname: string): string {
  const current = normalizePath(pathname);
  const candidates: Array<{ href: string; label: string }> = [
    ...flattenDashboardLinks(DASHBOARD_NAV_GROUPS),
    ...SUPPLEMENTARY_ROUTE_LABELS.map(({ route, label }) => ({ href: route, label })),
  ];

  const exact = candidates.find((link) => normalizePath(link.href) === current);
  if (exact) return exact.label;

  const parents = candidates
    .filter((link) => isDashboardRouteWithin(current, link.href))
    .sort((a, b) => normalizePath(b.href).length - normalizePath(a.href).length);
  if (parents[0]) return parents[0].label;

  // Dynamic tender sub-routes aren't static hrefs, so they can't live in the
  // registry above — matched here instead, most specific first.
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/command-center")) {
    return "Tender Command Center";
  }
  if (pathname.startsWith("/dashboard/tenders/") && pathname.includes("/report")) {
    return "Tender Report";
  }
  if (pathname.startsWith("/dashboard/tenders/")) return "Tender Detail";
  if (pathname.startsWith("/dashboard/admin/")) return "Admin";
  if (pathname.startsWith("/dashboard/company/")) return "Company";

  return "Dashboard";
}
