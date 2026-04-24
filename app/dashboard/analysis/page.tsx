import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { formatDate } from "../../../lib/tender-workflow";

export default async function AnalysisPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      requirements: true,
      files: { select: { id:true } },
      complianceGaps: { select: { id:true, isResolved:true, severity:true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const totalReqs = tenders.reduce((s,t) => s+t.requirements.length, 0);
  const totalFiles = tenders.reduce((s,t) => s+t.files.length, 0);
  const totalGaps = tenders.reduce((s,t) => s+t.complianceGaps.filter(g=>!g.isResolved).length, 0);
  const analyzed = tenders.filter(t => t.requirements.length>0).length;

  const reqByType: Record<string,number> = {};
  const reqByPriority: Record<string,number> = {};
  for (const t of tenders) {
    for (const r of t.requirements) {
      reqByType[r.requirementType] = (reqByType[r.requirementType]||0)+1;
      reqByPriority[r.priority] = (reqByPriority[r.priority]||0)+1;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tender Analysis</h1>
          <p className="mt-1 text-sm text-slate-500">AI-powered requirement extraction across all tenders.</p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
          + New Tender
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {[
          { label:"Tenders Analyzed", value:analyzed, sub:`of ${tenders.length} total`, color:"text-blue-600" },
          { label:"Total Requirements", value:totalReqs, sub:"extracted", color:"text-purple-600" },
          { label:"Tender Files", value:totalFiles, sub:"uploaded", color:"text-slate-700" },
          { label:"Open Gaps", value:totalGaps, sub:"compliance", color:totalGaps>0?"text-red-600":"text-green-600" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`mt-1.5 text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Requirement breakdown */}
      {totalReqs > 0 && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4">By Requirement Type</h3>
            <div className="space-y-2.5">
              {Object.entries(reqByType).sort((a,b)=>b[1]-a[1]).map(([type,count]) => {
                const pct = Math.round((count/totalReqs)*100);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-700 font-medium">{type.replace(/_/g," ")}</span>
                      <span className="text-slate-500">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-500" style={{width:`${pct}%`}} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4">By Priority</h3>
            <div className="space-y-2.5">
              {[["MANDATORY","bg-red-500"],["HIGH","bg-orange-400"],["MEDIUM","bg-amber-400"],["LOW","bg-slate-300"]].map(([priority,color]) => {
                const count = reqByPriority[priority]||0;
                const pct = totalReqs>0?Math.round((count/totalReqs)*100):0;
                return (
                  <div key={priority}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-700 font-medium">{priority}</span>
                      <span className="text-slate-500">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${color}`} style={{width:`${pct}%`}} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tender table */}
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4">
          <h3 className="font-semibold text-slate-900">All Tenders</h3>
        </div>
        {tenders.length===0 ? (
          <div className="py-12 text-center text-slate-400">
            <p>No tenders yet.</p>
            <Link href="/dashboard/tenders/new" className="mt-2 inline-block text-sm text-black underline">Create your first tender</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 text-xs">
              <tr>
                <th className="px-5 py-3 font-medium">Tender</th>
                <th className="px-5 py-3 font-medium">Files</th>
                <th className="px-5 py-3 font-medium">Requirements</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">Mandatory</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">Open Gaps</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map(tender => {
                const mandatory = tender.requirements.filter(r=>r.priority==="MANDATORY").length;
                const gaps = tender.complianceGaps.filter(g=>!g.isResolved).length;
                const critGaps = tender.complianceGaps.filter(g=>!g.isResolved&&g.severity==="CRITICAL").length;
                return (
                  <tr key={tender.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{tender.title}</p>
                      {tender.analysisSummary
                        ? <p className="text-xs text-slate-400 truncate max-w-xs">{tender.analysisSummary}</p>
                        : <p className="text-xs text-slate-300">No analysis yet</p>
                      }
                    </td>
                    <td className="px-5 py-3 text-slate-500">{tender.files.length}</td>
                    <td className="px-5 py-3">
                      <span className={`text-sm font-medium ${tender.requirements.length>0?"text-blue-600":"text-slate-400"}`}>
                        {tender.requirements.length}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {mandatory>0 ? <span className="text-xs font-medium text-red-600">{mandatory} mandatory</span> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {gaps>0
                        ? <span className={`text-xs font-medium ${critGaps>0?"text-red-600":"text-amber-600"}`}>{gaps} open</span>
                        : <span className="text-xs text-green-600">✓ Clear</span>
                      }
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={tender.status} /></td>
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/tenders/${tender.id}`} className="text-xs text-blue-600 hover:underline">Open workspace →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
