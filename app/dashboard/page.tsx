import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between rounded-2xl border bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-slate-600 mt-1">Welcome, {user.name || user.email}</p>
          </div>
          <LogoutButton />
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Company Vault</h2>
            <p className="text-sm text-slate-600 mt-2">Company documents and assets will go here.</p>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Tenders</h2>
            <p className="text-sm text-slate-600 mt-2">Tender list and tender analysis will go here.</p>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Compliance</h2>
            <p className="text-sm text-slate-600 mt-2">Compliance matrix and generation status will go here.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
