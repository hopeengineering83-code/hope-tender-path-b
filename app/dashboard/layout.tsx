import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { LogoutButton } from "../../components/logout-button";
import type { ReactNode } from "react";

const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: "⬛" },
  { href: "/dashboard/tenders", label: "Tenders", icon: "📋" },
  { href: "/dashboard/company", label: "Company Vault", icon: "🏢" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-white border-r flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-lg font-bold text-gray-900">Hope Tender</h1>
          <p className="text-xs text-gray-500 mt-0.5">Proposal Engine</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <span>{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t">
          <p className="text-xs text-gray-500 px-3 mb-1 truncate">{user.email}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
