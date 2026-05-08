import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { LogoutButton } from "../../components/logout-button";
import { NavLinks } from "../../components/nav-links";
import { MobileSidebarToggle } from "../../components/mobile-sidebar-toggle";
import type { ReactNode } from "react";
import { NotificationBell } from "../components/notification-bell";

const NAV_GROUPS_BASE = [
  {
    title: "Workspace",
    roles: null as string[] | null,
    links: [
      { href: "/dashboard", label: "Overview", icon: "◼" },
      { href: "/dashboard/tenders", label: "Tenders", icon: "📋" },
      { href: "/dashboard/history", label: "Tender History", icon: "🕘" },
    ],
  },
  {
    title: "Company",
    roles: ["ADMIN", "PROPOSAL_MANAGER"] as string[] | null,
    links: [
      { href: "/dashboard/company", label: "Knowledge Vault", icon: "🏢" },
      { href: "/dashboard/company/plan-b-import", label: "Plan B Exact Import", icon: "🧾" },
      { href: "/dashboard/company/review-board", label: "Review Board", icon: "✅" },
      { href: "/dashboard/company/review", label: "Knowledge Diagnostics", icon: "🔍" },
      { href: "/dashboard/assets", label: "Brand Assets", icon: "🖼️" },
      { href: "/dashboard/setup", label: "Setup Wizard", icon: "✨" },
      { href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
    ],
  },
  {
    title: "Engine",
    roles: null as string[] | null,
    links: [
      { href: "/dashboard/analysis", label: "Tender Analysis", icon: "🔎" },
      { href: "/dashboard/matching", label: "Matching", icon: "🧩" },
      { href: "/dashboard/compliance", label: "Compliance", icon: "✅" },
      { href: "/dashboard/documents", label: "Generated Docs", icon: "📄" },
      { href: "/dashboard/export", label: "Export Packages", icon: "📦" },
      { href: "/dashboard/activity", label: "Activity Logs", icon: "📝" },
    ],
  },
  {
    title: "Admin",
    roles: ["ADMIN"] as string[] | null,
    links: [
      { href: "/dashboard/users", label: "User Management", icon: "👥" },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  // PR #253 — parallelize the user + company fetch. These two queries
  // are independent; running them in parallel saves ~1 round-trip
  // (typically 30-80ms) on every dashboard page load.
  const [user, company, unreadCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.company.findUnique({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }).catch(() => 0),
  ]);
  if (!user) redirect("/login");

  const groups = NAV_GROUPS_BASE
    .filter((g) => !g.roles || g.roles.includes(user.role))
    .map((g) => ({ title: g.title, links: g.links }));

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Skip-link for keyboard users (PR #253). Hidden until focused;
          jumping past the nav directly to main content is a WCAG 2.4.1
          requirement. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <div className="flex items-center justify-between border-b bg-white px-4 py-3 lg:hidden">
        <div>
          <p className="text-sm font-bold text-slate-900">Hope Tender</p>
        </div>
        <MobileSidebarToggle groups={groups} user={{ email: user.email, role: user.role, name: user.name }} company={company} />
      </div>

      <aside
        className="hidden lg:flex lg:min-h-screen lg:w-72 lg:flex-col lg:border-r lg:bg-white"
        aria-label="Primary navigation"
      >
        <div className="border-b px-5 py-5">
          <h1 className="text-base font-bold text-slate-900 leading-tight">Hope Tender</h1>
          <p className="mt-0.5 text-xs text-slate-400 leading-snug">
            {company?.name ?? "Hope Urban Planning Architectural and Engineering Consultancy"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavLinks groups={groups} />
        </div>

        <div className="border-t px-4 py-4">
          <Link href="/dashboard/account" className="block rounded-xl bg-slate-50 px-3 py-3 hover:bg-slate-100 transition-colors">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Signed in as</p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{user.name ?? user.email}</p>
            <p className="text-xs text-slate-500">{String(user.role).replaceAll("_", " ")} · <span className="text-slate-400">account settings</span></p>
          </Link>
          <div className="mt-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
        <div className="sticky top-0 z-30 flex justify-end border-b bg-white/90 px-4 py-2 backdrop-blur-sm lg:px-8">
          <NotificationBell initialUnread={unreadCount} />
        </div>
        <div className="mx-auto max-w-7xl p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
