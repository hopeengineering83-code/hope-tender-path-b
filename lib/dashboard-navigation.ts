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
  /**
   * Sibling routes consolidated under this one sidebar destination (see the
   * app-wide route/panel consolidation) that are NOT nested under `href` as
   * a path prefix — e.g. "/dashboard/history" under the "Tenders" entry
   * whose href is "/dashboard/tenders". Members that already share a path
   * prefix with `href` (like "/dashboard/company/profile" under
   * "/dashboard/company") don't need to be listed here; prefix matching in
   * getActiveDashboardHref already covers them. Every member route still
   * exists exactly where it always did — nothing here changes routing,
   * only which single sidebar item is shown as active.
   */
  memberHrefs?: string[];
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
 * Exact matches win. Then an exact match against a link's memberHrefs
 * (consolidated sibling routes that aren't a path-prefix of the link's own
 * href). Otherwise the longest path-segment-safe parent wins.
 */
export function getActiveDashboardHref(
  pathname: string,
  groups: DashboardNavGroup[],
): string | null {
  const current = normalizePath(pathname);
  const links = flattenDashboardLinks(groups);

  const exact = links.find((link) => normalizePath(link.href) === current);
  if (exact) return exact.href;

  const memberMatch = links.find((link) =>
    link.memberHrefs?.some((member) => normalizePath(member) === current),
  );
  if (memberMatch) return memberMatch.href;

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
 *
 * Consolidated (app-wide route/panel consolidation) from 23 top-level items
 * down to 5: Overview is represented by the Tenders workspace, and related
 * destinations that used to compete for separate sidebar slots are now one
 * destination each, with the other routes in the group reachable via that
 * page's cross-navigation tab bar (components/section-subnav.tsx,
 * components/company-subnav.tsx, components/dashboard-group-subnav.tsx)
 * instead of the sidebar. No route was renamed, moved, or removed — every href
 * below and every memberHref resolves exactly where it always did, so no
 * redirect was needed. Global Search moved to the header (see
 * app/dashboard/layout.tsx) since it isn't a workspace destination.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    title: "Workspace",
    roles: null,
    links: [
      {
        href: "/dashboard/tenders",
        label: "Tenders",
        iconName: "ListIcon",
        memberHrefs: ["/dashboard", "/dashboard/history", "/dashboard/calendar"],
      },
    ],
  },
  {
    title: "Knowledge",
    roles: ["ADMIN", "PROPOSAL_MANAGER"],
    links: [
      {
        href: "/dashboard/company",
        label: "Company Vault",
        iconName: "DatabaseIcon",
        memberHrefs: [
          "/dashboard/company/readiness",
          "/dashboard/company/plan-b-import",
          "/dashboard/company/review-board",
          "/dashboard/company/review",
          "/dashboard/assets",
          "/dashboard/setup",
          "/dashboard/settings",
        ],
      },
    ],
  },
  {
    title: "Engine",
    roles: null,
    links: [
      {
        href: "/dashboard/analysis",
        label: "Engine",
        iconName: "BrainIcon",
        memberHrefs: ["/dashboard/matching", "/dashboard/compliance"],
      },
      {
        href: "/dashboard/documents",
        label: "Documents & Export",
        iconName: "DocumentIcon",
        memberHrefs: ["/dashboard/export"],
      },
    ],
  },
  {
    title: "Admin",
    roles: ["ADMIN"],
    links: [
      {
        href: "/dashboard/activity",
        label: "Administration",
        iconName: "GaugeIcon",
        memberHrefs: [
          "/dashboard/analytics",
          "/dashboard/admin/ai-readiness",
          "/dashboard/system",
          "/dashboard/admin/safety-center",
          "/dashboard/users",
          "/dashboard/admin",
        ],
      },
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
 *
 * Also covers every consolidated memberHref above: each keeps its own
 * specific header title (e.g. "Tender History", not the group's "Tenders")
 * even though it's no longer its own sidebar item.
 */
const SUPPLEMENTARY_ROUTE_LABELS: Array<{ route: string; label: string }> = [
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
