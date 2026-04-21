import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { StatusBadge } from "../../components/status-badge";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const [tenders, company] = await Promise.all([
    prisma.tender.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.company.findUnique({ where: { userId } }),
  ]);

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const stats = {
    total: tenders.length,
    active: tenders.filter((t) => t.status === "active").length,
    submitted: tenders.filter((t) => ["submitted", "awarded"].includes(t.status)).length,
    dueSoon: tenders.filter((t) => {
      if (!t.deadline) return false;
      const d = new Date(t.deadline);
      return d >= now && d <= in7days;
    }).length,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome back{company ? `, ${company.name}` : ""}.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Tenders", value: stats.total, color: "text-gray-900" },
          { label: "Active", value: stats.active, color: "text-blue-600" },
          { label: "Submitted / Awarded", value: stats.submitted, color: "text-green-600" },
          { label: "Due in 7 Days", value: stats.dueSoon, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border p-5">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Recent Tenders</h2>
          <Link href="/dashboard/tenders/new" className="text-sm bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800">
            + New Tender
          </Link>
        </div>
        {tenders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p>No tenders yet.</p>
            <Link href="/dashboard/tenders/new" className="mt-2 inline-block text-sm text-black underline">Create your first tender</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium">Ref</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Deadline</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.slice(0, 5).map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{t.title}</td>
                  <td className="px-6 py-4 text-gray-500">{t.reference || "—"}</td>
                  <td className="px-6 py-4 text-gray-500">{t.category}</td>
                  <td className="px-6 py-4 text-gray-500">{t.deadline || "—"}</td>
                  <td className="px-6 py-4"><StatusBadge status={t.status} /></td>
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/tenders/${t.id}`} className="text-blue-600 hover:underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/dashboard/tenders/new" className="bg-white rounded-xl border p-5 hover:border-black transition-colors">
          <p className="font-semibold text-gray-900">Create Tender</p>
          <p className="text-sm text-gray-500 mt-1">Add a new tender opportunity</p>
        </Link>
        <Link href="/dashboard/tenders" className="bg-white rounded-xl border p-5 hover:border-black transition-colors">
          <p className="font-semibold text-gray-900">View All Tenders</p>
          <p className="text-sm text-gray-500 mt-1">Manage your tender pipeline</p>
        </Link>
        <Link href="/dashboard/company" className="bg-white rounded-xl border p-5 hover:border-black transition-colors">
          <p className="font-semibold text-gray-900">Company Vault</p>
          <p className="text-sm text-gray-500 mt-1">Update your company profile</p>
        </Link>
      </div>
    </div>
  );
}
