"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveDashboardHref,
  type DashboardNavGroup,
} from "../lib/dashboard-navigation";
import { DashboardNavIcon } from "./dashboard-nav-icon";

export function NavLinks({ groups }: { groups: DashboardNavGroup[] }) {
  const pathname = usePathname();
  const activeHref = getActiveDashboardHref(pathname, groups);

  return (
    <nav aria-label="Primary navigation" className="space-y-6 px-4 py-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.links.map((link) => {
              const active = activeHref === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-slate-900 font-medium text-white"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    <DashboardNavIcon iconName={link.iconName} />
                  </span>
                  <span className="min-w-0 truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
