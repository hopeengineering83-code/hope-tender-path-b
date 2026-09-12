"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "../../../components/icons";

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
  MEDIUM:"bg-amber-100 text-amber-800 border-amber-200",LOW:"bg-slate-100 text-slate-600 border-slate-200",
};
const SUPP: Record<string,string> = {
  SUPPORTED:"bg-green-100 text-green-700",
  EVIDENCE_PENDING_REVIEW:"bg-blue-100 text-blue-700",
  SUBSTANTIAL:"bg-emerald-100 text-emerald-700",
  FULL:"bg-emerald-100 text-emerald-700",
  PARTIAL:"bg-amber-100 text-amber-800",
  UNSUPPORTED:"bg-red-100 text-red-700",
};

type SubTab = "gaps"|"matrix";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function ComplianceDashboard({ tenders: initial }: { tenders: Tender[] }) {
  const [tenders, setTenders] = useState(initial);
  const [resolvingId, setResolvingId] = useState<string|null>(null);
  const [noteMap, setNoteMap] = useState<Record<string,string>>({});
  const [mitigationMap, setMitigationMap] = useState<Record<string,string>>({});
  const [filterTender, setFilterTender] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("unresolved");
  const [subTab, setSubTab] = useState<SubTab>("gaps");
  const [expandedGapIds, setExpandedGapIds] = useState<Set<string>>(new Set());
  const [expandedMatrixTenders, setExpandedMatrixTenders] = useState<Set<string>>(new Set());

  function toggleGapCard(id: string) {
    setExpandedGapIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleMatrixTender(id: string) {
    setExpandedMatrixTenders((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function patchGap(tenderId: string, gapId: string, body: { isResolved?: boolean; resolvedNote?: string; mitigationPlan?: string }) {
    setResolvingId(gapId);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gaps/${gapId}`, {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json() as Gap;
        setTenders(prev => prev.map(t => t.id!==tenderId ? t : {
          ...t, complianceGaps: t.complianceGaps.map(g => g.id!==gapId ? g : { ...g, isResolved:updated.isResolved, resolvedNote:updated.resolvedNote, mitigationPlan:updated.mitigationPlan }),
        }));
        if (body.resolvedNote !== undefined) setNoteMap(m => { const n={...m}; delete n[gapId]; return n; });
        if (body.mitigationPlan !== undefined) setMitigationMap(m => { const n={...m}; delete n[gapId]; return n; });
      }
    } finally { setResolvingId(null); }
  }

  function toggleGap(tenderId: string, gapId: string, isResolved: boolean, note: string) {
    return patchGap(tenderId, gapId, { isResolved, resolvedNote: note });
  }

  function saveMitigation(tenderId: string, gapId: string, prefix = "") {
    const text = (mitigationMap[gapId] ?? "").trim();
    if (text.length === 0) return;
    return patchGap(tenderId, gapId, { mitigationPlan: `${prefix}${text}`.slice(0, 2000) });
  }
  function markNotApplicable(tenderId: string, gapId: string) {
    const note = (noteMap[gapId] ?? "").trim();
    if (note.length === 0) { window.alert("Add an audit note explaining why this requirement is not applicable."); return; }
    return patchGap(tenderId, gapId, { isResolved: true, resolvedNote: `NOT_APPLICABLE: ${note}`.slice(0, 2000) });
  }

  const allGaps = tenders.flatMap(t => t.complianceGaps.map(g => ({ ...g, tenderId:t.id, tenderTitle:t.title })));
  const allMatrix = tenders.flatMap(t => (t.complianceMatrix||[]).map(m => ({ ...m, tenderId:t.id, tenderTitle:t.title })));
  // Count tenders with no requirements (unanalyzed) — these represent
  // implicit compliance risks. Missing gap rows are NOT proof of compliance.
  const unanalyzedCount = tenders.filter(t => !t.requirements || t.requirements.length === 0).length;
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

  // Group matrix rows by tender for accordion
  const matrixByTender = tenders
    .filter(t => (t.complianceMatrix?.length ?? 0) > 0)
    .map(t => ({ tender: t, rows: t.complianceMatrix! }));

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
        {([["gaps","Compliance Gaps"],["matrix","Evidence Mapping"]] as [SubTab,string][]).map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${subTab===id?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {subTab==="gaps" && (
        <>
          <div className="flex flex-wrap gap-2">
            {/* max-w-full + min-w-0 so the select shrinks to fit its flex
                container on mobile instead of expanding to the width of the
                longest tender title (which caused the 131px mobile overflow
                on /dashboard/compliance found by the live audit). The
                option text is truncated with max-w-[60ch] so long titles
                don't force the dropdown list itself to be wider than the
                viewport. */}
            <select value={filterTender} onChange={e=>setFilterTender(e.target.value)} className="max-w-full min-w-0 rounded-lg border px-3 py-1.5 text-xs bg-white">
              <option value="all">All tenders</option>
              {tenders.map(t=><option key={t.id} value={t.id} className="max-w-[60ch] truncate">{t.title}</option>)}
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
              <p className="text-slate-400 text-sm">
                {allGaps.length===0 && unanalyzedCount>0
                  ? `${unanalyzedCount} tender(s) have not been analyzed. Missing gap rows are not proof of compliance — run the engine on each tender first.`
                  : allGaps.length===0
                    ? "No compliance gaps recorded. Run the engine on a tender first."
                    : "No gaps match current filters."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(gap => {
                const isOpen = expandedGapIds.has(gap.id);
                return (
                  <div key={gap.id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${gap.isResolved?"opacity-70":""}`}>
                    {/* Always-visible header row — click to expand */}
                    <button
                      type="button"
                      onClick={() => toggleGapCard(gap.id)}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                    >
                      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEV[gap.severity]??"bg-slate-100 text-slate-500"}`}>{gap.severity}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-sm truncate">{gap.title}</p>
                        <p className="text-xs text-slate-400 truncate">{gap.tenderTitle}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {gap.isResolved && <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Resolved</span>}
                        {gap.mitigationPlan && !gap.isResolved && <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">Has mitigation</span>}
                        <ChevronIcon open={isOpen} />
                      </div>
                    </button>

                    {/* Expanded body */}
                    {isOpen && (
                      <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-3">
                        <p className="text-sm text-slate-700">{gap.description}</p>
                        {gap.mitigationPlan && <p className="text-xs text-slate-500 italic bg-slate-50 rounded-lg px-3 py-2">Mitigation: {gap.mitigationPlan}</p>}
                        {gap.resolvedNote && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2"><CheckIcon /> {gap.resolvedNote}</p>}

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:flex-wrap">
                          {!gap.isResolved ? (
                            <>
                              <input value={noteMap[gap.id]??""} onChange={e=>setNoteMap(m=>({...m,[gap.id]:e.target.value}))}
                                placeholder="Resolution / audit note…" className="rounded-lg border px-2 py-1.5 text-xs flex-1 min-w-[180px]" />
                              <button onClick={()=>toggleGap(gap.tenderId,gap.id,true,noteMap[gap.id]??"")} disabled={resolvingId===gap.id}
                                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60 shrink-0">
                                {resolvingId===gap.id?"…":"Mark covered with evidence"}
                              </button>
                              <button onClick={()=>markNotApplicable(gap.tenderId,gap.id)} disabled={resolvingId===gap.id}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 shrink-0">
                                Mark not applicable
                              </button>
                              <input value={mitigationMap[gap.id]??""} onChange={e=>setMitigationMap(m=>({...m,[gap.id]:e.target.value}))}
                                placeholder="Mitigation / JV plan…" className="rounded-lg border px-2 py-1.5 text-xs flex-1 min-w-[180px]" />
                              <div className="flex gap-1 shrink-0">
                                <button onClick={()=>saveMitigation(gap.tenderId,gap.id)} disabled={resolvingId===gap.id}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                                  Add mitigation
                                </button>
                                <button onClick={()=>saveMitigation(gap.tenderId,gap.id,"JV/Subcontractor: ")} disabled={resolvingId===gap.id}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                                  JV / subcontractor
                                </button>
                              </div>
                            </>
                          ) : (
                            <button onClick={()=>toggleGap(gap.tenderId,gap.id,false,"")} disabled={resolvingId===gap.id}
                              className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                              {resolvingId===gap.id?"…":"Reopen"}
                            </button>
                          )}
                          <Link href={`/dashboard/tenders/${gap.tenderId}`} className="text-xs text-blue-600 hover:underline self-center ml-auto">View tender <ArrowRightIcon /></Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {subTab==="matrix" && (
        <div className="space-y-3">
          {allMatrix.length===0 ? (
            <div className="rounded-2xl border bg-white p-10 text-center shadow-sm">
              <div className="text-slate-400 text-sm">No evidence mapping data yet. Run the engine on a tender to generate compliance mapping.</div>
            </div>
          ) : matrixByTender.length > 0 ? (
            matrixByTender.map(({ tender, rows }) => {
              const isOpen = expandedMatrixTenders.has(tender.id);
              // Rows written before the Engine spoke the gates' vocabulary still say
              // SUPPORTED, so both are counted here rather than silently dropping
              // the history.
              const supported = rows.filter(r => ["SUBSTANTIAL", "FULL", "SUPPORTED"].includes(r.supportLevel)).length;
              return (
                <div key={tender.id} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleMatrixTender(tender.id)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{tender.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{rows.length} evidence entries · {supported}/{rows.length} supported</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${supported === rows.length ? "bg-green-100 text-green-700" : supported > 0 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                        {Math.round((supported / rows.length) * 100)}% supported
                      </span>
                      <ChevronIcon open={isOpen} />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 overflow-hidden">
                      {/* overflow-x-auto so the evidence table scrolls
                          horizontally on narrow viewports (mobile / tablet)
                          instead of pushing the page width past the viewport
                          — fixed the 131px mobile overflow on
                          /dashboard/compliance found by the live audit. */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-5 py-3 font-medium">Evidence Type</th>
                            <th className="px-5 py-3 font-medium">Evidence Source</th>
                            <th className="px-5 py-3 font-medium">Support</th>
                            <th className="px-5 py-3 font-medium hidden lg:table-cell">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map(row => (
                            <tr key={row.id} className="hover:bg-slate-50">
                              <td className="px-5 py-3 text-xs font-medium text-slate-700">{row.evidenceType}</td>
                              <td className="px-5 py-3 text-xs text-slate-600">{row.evidenceSource}</td>
                              <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SUPP[row.supportLevel]??"bg-slate-100 text-slate-500"}`}>{row.supportLevel}</span></td>
                              <td className="px-5 py-3 text-xs text-slate-400 hidden lg:table-cell">{row.notes??"-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            // Fallback: show flat table when tenders have no complianceMatrix but allMatrix has data
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
              {/* overflow-x-auto so the fallback evidence table scrolls
                  horizontally on narrow viewports — same fix as the
                  per-tender matrix table above. */}
              <div className="overflow-x-auto">
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
