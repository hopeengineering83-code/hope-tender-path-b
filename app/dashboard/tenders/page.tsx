import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";

const STATUSES = ["all", "draft", "active", "submitted", "awarded", "closed"];

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { status = "all", q = "" } = await searchParams;

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      ...(status !== "all" ? { status } : {}),
      ...(q ? { title: { contains: q } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenders</h1>
          <p className="text-gray-500 mt-1">{tenders.length} tender{tenders.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/dashboard/tenders/new" className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800">
          + New Tender
        </Link>
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3">
          <form className="flex-1" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search tenders..."
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
            <input type="hidden" name="status" value={status} />
          </form>
          <div className="flex gap-1 flex-wrap">
            {STATUSES.map((s) => (
              <Link
                key={s}
                href={`/dashboard/tenders?status=${s}${q ? `&q=${q}` : ""}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  status === s ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {tenders.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No tenders found</p>
            <Link href="/dashboard/tenders/new" className="mt-3 inline-block text-sm text-black underline">
              Create your first tender
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Budget</th>
                <th className="px-6 py-3 font-medium">Deadline</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900 max-w-xs truncate">{t.title}</td>
                  <td className="px-6 py-4 text-gray-500">{t.reference || "—"}</td>
                  <td className="px-6 py-4 text-gray-500">{t.category}</td>
                  <td className="px-6 py-4 text-gray-500">
                    {t.budget ? `${t.currency} ${t.budget.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{t.deadline || "—"}</td>
                  <td className="px-6 py-4"><StatusBadge status={t.status} /></td>
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/tenders/${t.id}`} className="text-blue-600 hover:underline mr-3">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
