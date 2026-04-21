import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { LogoutButton } from "../../components/logout-button";
import type { ReactNode } from "react";

const navGroups = [
  {
    title: "Workspace",
    links: [
      { href: "/dashboard", label: "Overview", icon: "⬛" },
      { href: "/dashboard/tenders", label: "Tenders", icon: "📋" },
      { href: "/dashboard/history", label: "Tender History", icon: "🕘" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/dashboard/company", label: "Knowledge Vault", icon: "🏢" },
      { href: "/dashboard/assets", label: "Assets Manager", icon: "🖼️" },
      { href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
    ],
  },
  {
    title: "Engine",
    links: [
      { href: "/dashboard/analysis", label: "Tender Analysis", icon: "🔎" },
      { href: "/dashboard/matching", label: "Matching", icon: "🧩" },
      { href: "/dashboard/compliance", label: "Compliance", icon: "✅" },
      { href: "/dashboard/documents", label: "Generated Docs", icon: "📄" },
      { href: "/dashboard/export", label: "Export Packages", icon: "📦" },
      { href: "/dashboard/activity", label: "Activity Logs", icon: "📝" },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="w-full border-b bg-white lg:min-h-screen lg:w-80 lg:border-b-0 lg:border-r">
        <div className="border-b px-6 py-6">
          <h1 className="text-lg font-bold text-slate-900">Hope Tender Proposal Generator</h1>
          <p className="mt-1 text-sm text-slate-500">Real tender engine foundation</p>
        </div>

        <nav className="space-y-6 px-4 py-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                  >
                    <span>{link.icon}</span>
                    <span>{link.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t px-4 py-4">
          <div className="rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Signed in as</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900">{user.email}</p>
            <p className="text-xs text-slate-500">{String(user.role).replaceAll("_", " ")}</p>
          </div>
          <div className="mt-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
