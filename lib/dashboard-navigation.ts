import type { ReactNode } from "react";

export type DashboardNavLink = {
  href: string;
  label: string;
  // A rendered icon element (inline SVG), not a raw emoji/Unicode string —
  // emoji glyph coverage depends on the viewer's OS/browser font stack and
  // renders as blank "tofu" boxes in many environments (see components/icons.tsx).
  icon: ReactNode;
};

export type DashboardNavGroup = {
  title: string;
  links: DashboardNavLink[];
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
 * This prevents `/dashboard/company` from appearing active at the same time as
 * `/dashboard/company/readiness`, and prevents similarly-prefixed routes from
 * matching accidentally.
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
