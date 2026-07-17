import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { LogoutButton } from "../../components/logout-button";
import { NavLinks } from "../../components/nav-links";
import { MobileSidebarToggle } from "../../components/mobile-sidebar-toggle";
import type { ReactNode } from "react";
import { NotificationBell } from "../components/notification-bell";
import { BuildVersionBadge } from "../../components/build-version-badge";
import {
  HomeIcon, ListIcon, ClockIcon, CalendarIcon, DatabaseIcon, TrendingUpIcon,
  UploadIcon, ClipboardCheckIcon, CodeIcon, ImageIcon, SparklesIcon, SettingsIcon,
  BrainIcon, PuzzleIcon, ShieldIcon, DocumentIcon, PackageIcon, BarChartIcon,
  SearchIcon, UsersIcon, GaugeIcon,
} from "../../components/icons";

// Nav icons were previously raw emoji characters (🏠 📋 🕘 etc). Emoji glyph
// rendering depends entirely on the viewer's OS/browser having a full-color
// emoji font installed — a client-side concern no server deploy can fix.
// Environments without one (many headless browsers, screenshot/automation
// tools, some desktop Linux setups) show blank "tofu" boxes for every single
// nav item, on every single page. Inline SVGs (components/icons.tsx) render
// identically everywhere.
const NAV_GROUPS_BASE = [
  {
    title: "Workspace",
    roles: null as string[] | null,
    links: [
      { href: "/dashboard", label: "Overview", icon: <HomeIcon /> },
      { href: "/dashboard/tenders", label: "Active Tenders", icon: <ListIcon /> },
      { href: "/dashboard/history", label: "Tender History", icon: <ClockIcon /> },
      { href: "/dashboard/calendar", label: "Deadline Calendar", icon: <CalendarIcon /> },
    ],
  },
  {
    title: "Knowledge",
    roles: ["ADMIN", "PROPOSAL_MANAGER"] as string[] | null,
    links: [
      { href: "/dashboard/company", label: "Knowledge Vault", icon: <DatabaseIcon /> },
      { href: "/dashboard/company/readiness", label: "Profile Readiness", icon: <TrendingUpIcon /> },
      { href: "/dashboard/company/plan-b-import", label: "Legacy Data Import", icon: <UploadIcon /> },
      { href: "/dashboard/company/review-board", label: "Review Board", icon: <ClipboardCheckIcon /> },
      { href: "/dashboard/company/review", label: "Data Diagnostics", icon: <CodeIcon /> },
      { href: "/dashboard/assets", label: "Brand Assets", icon: <ImageIcon /> },
      { href: "/dashboard/setup", label: "Setup Wizard", icon: <SparklesIcon /> },
      { href: "/dashboard/settings", label: "Settings", icon: <SettingsIcon /> },
    ],
  },
  {
    title: "Engine",
    roles: null as string[] | null,
    links: [
      { href: "/dashboard/analysis", label: "Global Analysis", icon: <BrainIcon /> },
      { href: "/dashboard/matching", label: "Global Matching", icon: <PuzzleIcon /> },
      { href: "/dashboard/compliance", label: "Global Compliance", icon: <ShieldIcon /> },
      { href: "/dashboard/documents", label: "Document Archive", icon: <DocumentIcon /> },
      { href: "/dashboard/export", label: "Export Hub", icon: <PackageIcon /> },
      { href: "/dashboard/activity", label: "Activity Logs", icon: <ListIcon /> },
      { href: "/dashboard/analytics", label: "System Analytics", icon: <BarChartIcon /> },
      { href: "/dashboard/search", label: "Global Search", icon: <SearchIcon /> },
    ],
  },
  {
    title: "Admin",
    roles: ["ADMIN"] as string[] | null,
    links: [
      { href: "/dashboard/users", label: "User Management", icon: <UsersIcon /> },
      { href: "/dashboard/admin/ai-readiness", label: "AI Readiness", icon: <SparklesIcon /> },
      { href: "/dashboard/system", label: "System Status", icon: <GaugeIcon /> },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const [user, company, unreadCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.company.findUnique({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }).catch(() => 0),
  ]);
  if (!user) redirect("/login");

  const groups = NAV_GROUPS_BASE
    .filter((group) => !group.roles || group.roles.includes(user.role))
    .map((group) => ({ title: group.title, links: group.links }));

  return (
    <div className="min-h-screen min-w-0 bg-slate-50 xl:flex">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <div className="flex min-w-0 items-center justify-between border-b bg-white px-4 py-3 xl:hidden">
        <p className="min-w-0 truncate text-sm font-bold text-slate-900">Hope Tender</p>
        <MobileSidebarToggle
          groups={groups}
          user={{ email: user.email, role: user.role, name: user.name }}
          company={company}
        />
      </div>

      <aside
        className="hidden xl:sticky xl:top-0 xl:flex xl:h-screen xl:w-72 xl:shrink-0 xl:flex-col xl:border-r xl:bg-white"
        aria-label="Primary navigation"
      >
        <div className="border-b px-5 py-5">
          <h1 className="text-base font-bold leading-tight text-slate-900">Hope Tender</h1>
          <p className="mt-0.5 text-xs leading-snug text-slate-400">
            {company?.name ?? "Hope Urban Planning Architectural and Engineering Consultancy"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <NavLinks groups={groups} />
        </div>

        <div className="border-t px-4 py-4">
          <Link href="/dashboard/account" className="block rounded-xl bg-slate-50 px-3 py-3 transition-colors hover:bg-slate-100">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Signed in as</p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{user.name ?? user.email}</p>
            <p className="text-xs text-slate-500">{String(user.role).replaceAll("_", " ")} · <span className="text-slate-400">account settings</span></p>
          </Link>
          <div className="mt-3">
            <LogoutButton />
          </div>
          <BuildVersionBadge />
        </div>
      </aside>

      <main id="main-content" className="min-w-0 flex-1" tabIndex={-1}>
        <div className="sticky top-0 z-30 flex min-w-0 justify-end border-b bg-white/90 px-4 py-2 backdrop-blur-sm xl:px-8">
          <NotificationBell initialUnread={unreadCount} />
        </div>
        <div className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 xl:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
