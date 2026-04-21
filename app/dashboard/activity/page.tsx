import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { formatDate } from "../../../lib/tender-workflow";

export default async function ActivityPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const logs = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload, engine, generation, and export activity across the tender workflow.
        </p>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        {logs.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No activity logs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">When</th>
                <th className="px-6 py-3 font-medium">Action</th>
                <th className="px-6 py-3 font-medium">Entity</th>
                <th className="px-6 py-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-slate-500">{formatDate(log.createdAt)}</td>
                  <td className="px-6 py-4 font-medium text-slate-900">{log.action}</td>
                  <td className="px-6 py-4 text-slate-500">{log.entityType}</td>
                  <td className="px-6 py-4 text-slate-500">{log.entityId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
