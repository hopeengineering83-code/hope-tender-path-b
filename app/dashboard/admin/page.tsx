import Link from "next/link";
import { UsersIcon, SparklesIcon, ShieldIcon, GaugeIcon } from "../../../components/icons";

// SCREENSHOT-R2: Fix 404 on /dashboard/admin
// The directory app/dashboard/admin/ existed with sub-pages (ai-readiness,
// safety-center) but had NO index page.tsx, causing a 404 across all
// viewports (desktop/tablet/mobile screenshots 020).
// This page provides a simple admin landing with links to sub-pages.
// Role gating lives in app/dashboard/admin/layout.tsx (shared
// requireDashboardRole guard, consistent with settings/assets/setup/users).

export default async function AdminIndexPage() {
  const adminLinks = [
    {
      href: "/dashboard/users",
      label: "User Management",
      description: "Manage team access, roles, and invitations",
      icon: <UsersIcon />,
    },
    {
      href: "/dashboard/admin/ai-readiness",
      label: "AI Readiness",
      description: "Check AI provider configuration and environment readiness",
      icon: <SparklesIcon />,
    },
    {
      href: "/dashboard/admin/safety-center",
      label: "System Safety Center",
      description: "Release guardian report and critical blocker checks",
      icon: <ShieldIcon />,
    },
    {
      href: "/dashboard/system",
      label: "System Status",
      description: "Production gap analysis, database, and provider health",
      icon: <GaugeIcon />,
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
