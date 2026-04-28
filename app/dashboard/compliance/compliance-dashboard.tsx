"use client";
import { useState } from "react";
import Link from "next/link";

type Gap = {
  id: string; title: string; description: string; severity: string;
  isResolved: boolean; mitigationPlan?: string|null; resolvedNote?: string|null;
};
type MatrixRow = {
  id: string; requirementId?: string|null; evidenceType: string;
  evidenceSource: string; supportLevel: string; notes?: string|null;
};
type Tender = {
  id: string; title: string; status: string;
  requirements: { id: string }[];
  complianceGaps: Gap[];
  complianceMatrix?: MatrixRow[];
};

const SEV: Record<string,string> = {
  CRITICAL:"bg-red-100 text-red-700 border-red-200",HIGH:"bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM:"bg-amber-100 text-amber-700 border-amber-200",LOW:"bg-slate-100 text-slate-600 border-slate-200",
};
const SUPP: Record<string,string> = {
  SUPPORTED:"bg-green-100 text-green-700",
  EVIDENCE_PENDING_REVIEW:"bg-blue-100 text-blue-700",
  PARTIAL:"bg-amber-100 text-amber-700",
  UNSUPPORTED:"bg-red-100 text-red-700",
};

type SubTab = "gaps"|"matrix";

export function ComplianceDashboard({ tenders: initial }: { tenders: Tender[] }) {
  const [tenders, setTenders] = useState(initial);
  const [resolvingId, setResolvingId] = useState<string|null>(null);
  const [noteMap, setNoteMap] = useState<Record<string,string>>({});
  const [filterTender, setFilterTender] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("unresolved");
  const [subTab, setSubTab] = useState<SubTab>("gaps");

  async function toggleGap(tenderId: string, gapId: string, isResolved: boolean, note: string) {
    setResolvingId(gapId);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gaps/${gapId}`, {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ isResolved, resolvedNote: note }),
      });
      if (res.ok) {
        const updated = await res.json() as Gap;
        setTenders(prev => prev.map(t => t.id!==tenderId ? t : {
          ...t, complianceGaps: t.complianceGaps.map(g => g.id!==gapId ? g : { ...g, isResolved:updated.isResolved, resolvedNote:updated.resolvedNote }),
        }));
        setNoteMap(m => { const n={...m}; delete n[gapId]; return n; });
      }
    } finally { setResolvingId(null); }
  }

  const allGaps = tenders.flatMap(t => t.complianceGaps.map(g => ({ ...g, tenderId:t.id, tenderTitle:t.title })));
  const allMatrix = tenders.flatMap(t => (t.complianceMatrix||[]).map(m => ({ ...m, tenderId:t.id, tenderTitle:t.title })));
  const filtered = allGaps.filter(g => {
    if (filterTender!=="all" && g.tenderId!==filterTender) return false;
    if (filterSeverity!=="all" && g.severity!==filterSeverity) return false;
    if (filterStatus==="unresolved" && g.isResolved) return false;
    if (filterStatus==="resolved" && !g.isResolved) return false;
    return true;
  });
  const totalCritical = allGaps.filter(g=>!g.isResolved&&g.severity==="CRITICAL").length;
  const totalHigh = allGaps.filter(g=>!g.isResolved&&g.severity==="HIGH").length;
  const totalUnresolved = allGaps.filter(g=>!g.isResolved).length;
  const totalResolved = allGaps.filter(g=>g.isResolved).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance</h1>
        <p className="mt-1 text-sm text-slate-500">Compliance gaps, evidence mapping, and submission readiness.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {[
          { label:"Critical", value:totalCritical, color:"text-red-600" },
          { label:"High", value:totalHigh, color:"text-orange-600" },
          { label:"Total Open", value:totalUnresolved, color:"text-amber-600" },
          { label:"Resolved", value:totalResolved, color:"text-green-600" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label} Gaps</p>
            <p className={`mt-1.5 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {([["gaps","Compliance Gaps"],["matrix","Evidence Matrix"]] as [SubTab,string][]).map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${subTab===id?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {subTab==="gaps" && (
        <>
          <div className="flex flex-wrap gap-2">
            <select value={filterTender} onChange={e=>setFilterTender(e.target.value)} className="rounded-lg border px-3 py-1.5 text-xs bg-white">
              <option value="all">All tenders</option>
              {tenders.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <select value={filterSeverity} onChange={e=>setFilterSeverity(e.target.value)} className="rounded-lg border px-3 py-1.5 text-xs bg-white">
              <option value="all">All severities</option>
              {["CRITICAL","HIGH","MEDIUM","LOW"].map(s=><option key={s}>{s}</option>)}
            </select>
            <div className="flex rounded-lg border overflow-hidden text-xs">
              {[["unresolved","Open"],["resolved","Resolved"],["all","All"]].map(([v,l])=>(
                <button key={v} onClick={()=>setFilterStatus(v)} className={`px-3 py-1.5 ${filterStatus===v?"bg-black text-white":"bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
              ))}
            </div>
          </div>

          {filtered.length===0 ? (
            <div className="rounded-2xl border bg-white p-10 text-center shadow-sm">
              <p className="text-slate-400 text-sm">{allGaps.length===0 ? "No compliance gaps. Run the engine on a tender first." : "No gaps match current filters."}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(gap => (
                <div key={gap.id} className={`rounded-2xl border p-5 bg-white shadow-sm ${gap.isResolved?"opacity-60":""}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEV[gap.severity]??"bg-slate-100 text-slate-500"}`}>{gap.severity}</span>
                        <span className="text-xs text-slate-400">{gap.tenderTitle}</span>
                        {gap.isResolved && <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Resolved</span>}
                      </div>
                      <p className="font-semibold text-slate-900 text-sm">{gap.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{gap.description}</p>
                      {gap.mitigationPlan && <p className="mt-1.5 text-xs text-slate-500 italic">Mitigation: {gap.mitigationPlan}</p>}
                      {gap.resolvedNote && <p className="mt-1 text-xs text-green-700">✓ {gap.resolvedNote}</p>}
                    </div>
                    <div className="flex flex-col gap-2 sm:items-end shrink-0">
                      {!gap.isResolved ? (
                        <>
                          <input value={noteMap[gap.id]??""} onChange={e=>setNoteMap(m=>({...m,[gap.id]:e.target.value}))}
                            placeholder="Resolution note…" className="rounded-lg border px-2 py-1.5 text-xs w-48" />
                          <button onClick={()=>toggleGap(gap.tenderId,gap.id,true,noteMap[gap.id]??"")} disabled={resolvingId===gap.id}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                            {resolvingId===gap.id?"…":"Mark Resolved"}
                          </button>
                        </>
                      ) : (
                        <button onClick={()=>toggleGap(gap.tenderId,gap.id,false,"")} disabled={resolvingId===gap.id}
                          className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                          {resolvingId===gap.id?"…":"Reopen"}
                        </button>
                      )}
                      <Link href={`/dashboard/tenders/${gap.tenderId}`} className="text-xs text-blue-600 hover:underline">View tender →</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {subTab==="matrix" && (
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          {allMatrix.length===0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No evidence matrix data yet. Run the engine on a tender to generate compliance mapping.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Tender</th>
                  <th className="px-5 py-3 font-medium">Evidence Type</th>
                  <th className="px-5 py-3 font-medium">Evidence Source</th>
                  <th className="px-5 py-3 font-medium">Support</th>
                  <th className="px-5 py-3 font-medium hidden lg:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allMatrix.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs text-slate-500 truncate max-w-[120px]">{row.tenderTitle}</td>
                    <td className="px-5 py-3 text-xs font-medium text-slate-700">{row.evidenceType}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{row.evidenceSource}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SUPP[row.supportLevel]??"bg-slate-100 text-slate-500"}`}>{row.supportLevel}</span></td>
                    <td className="px-5 py-3 text-xs text-slate-400 hidden lg:table-cell">{row.notes??"-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
