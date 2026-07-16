import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";

// SCREENSHOT-R2: Fix 404 on /dashboard/admin
// The directory app/dashboard/admin/ existed with sub-pages (ai-readiness,
// safety-center) but had NO index page.tsx, causing a 404 across all
// viewports (desktop/tablet/mobile screenshots 020).
// This page provides a simple admin landing with links to sub-pages.

export default async function AdminIndexPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  // Only ADMIN role can access admin pages
  const { prisma, prismaReady } = await import("../../../lib/prisma");
  await prismaReady;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const adminLinks = [
    {
      href: "/dashboard/users",
      label: "User Management",
      description: "Manage team access, roles, and invitations",
      icon: "👥",
    },
    {
      href: "/dashboard/admin/ai-readiness",
      label: "AI Readiness",
      description: "Check AI provider configuration and environment readiness",
      icon: "🤖",
    },
    {
      href: "/dashboard/admin/safety-center",
      label: "System Safety Center",
      description: "Release guardian report and critical blocker checks",
      icon: "🛡️",
    },
    {
      href: "/dashboard/system",
      label: "System Status",
      description: "Production gap analysis, database, and provider health",
      icon: "🌡️",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Administration tools and system diagnostics
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {adminLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-2xl border bg-white p-6 shadow-sm transition-colors hover:border-slate-400"
          >
            <div className="flex items-start gap-4">
              <span className="text-2xl" aria-hidden="true">{link.icon}</span>
              <div>
                <h2 className="font-semibold text-slate-900 group-hover:text-blue-600">
                  {link.label}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{link.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
