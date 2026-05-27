// G10 — Tender Command Center.
//
// Single dashboard per tender that surfaces every state the engine has
// computed: readiness, bid/no-bid, blockers, current best team / projects,
// generated docs status, evaluator score, Copilot actions, export gate
// status — and a "Next best action" at the top.
//
// Lives at /dashboard/tenders/[id]/command-center so the existing detail
// page stays untouched. Linked from the tender detail navigation.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkExportReadiness, checkTenderLevelExportBlockers } from "../../../../../lib/engine/export-readiness";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { VersionActionsTable } from "./version-actions";

export const dynamic = "force-dynamic";

export default async function TenderCommandCenter({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      requirements: true,
      complianceGaps: true,
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { id: true, fullName: true, title: true } } }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { id: true, name: true, clientName: true } } }, orderBy: { score: "desc" } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
    },
  });
  if (!tender) notFound();

  // ─── Readiness, blockers, evaluator state ───────────────────────────
  const docReadiness = checkExportReadiness(tender.generatedDocuments);
  const canonical = await getFinalSubmissionReadiness(id);
  const tenderReadiness = await checkTenderLevelExportBlockers(id);
  const tenderBlockers = canonical?.tenderLevelBlockers ?? tenderReadiness.blockers;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objections: any[] = await (prisma as any).evaluatorObjection.findMany({
    where: { tenderId: id },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: 25,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openHigh = objections.filter((o: any) => o.status === "OPEN" && o.severity === "HIGH");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openMedium = objections.filter((o: any) => o.status === "OPEN" && o.severity === "MEDIUM");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposalVersions: any[] = await (prisma as any).proposalVersion.findMany({
    where: { tenderId: id },
    orderBy: { version: "desc" },
    take: 5,
    select: { id: true, version: true, qualityScore: true, winProbabilityScore: true, mode: true, createdAt: true },
  });
  const latestVersion = proposalVersions[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workbook: any = await (prisma as any).pricingWorkbook.findUnique({
    where: { tenderId: id },
    include: { lines: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentJobs: any[] = await (prisma as any).aiJob.findMany({
    where: { OR: [{ tenderId: id }, { userId }] },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, jobType: true, status: true, createdAt: true, finishedAt: true },
  });

  // ─── Next best action heuristic ─────────────────────────────────────
  let nextAction: { title: string; href?: string; rationale: string };
  if (tenderBlockers.length > 0) {
    nextAction = {
      title: "Resolve tender-level export blockers",
      href: `#blockers`,
      rationale: `${tenderBlockers.length} unresolved tender-level blocker(s) — export gate is closed.`,
    };
  } else if (docReadiness.failures.length > 0) {
    nextAction = {
      title: "Bring documents to READY_FOR_EXPORT",
      href: `/dashboard/tenders/${id}#documents`,
      rationale: `${docReadiness.failures.length} document(s) still need review/validation.`,
    };
  } else if (openHigh.length > 0) {
    nextAction = {
      title: "Close HIGH-severity evaluator objections",
      href: `#evaluator`,
      rationale: `${openHigh.length} HIGH objection(s) open from the last evaluator simulation.`,
    };
  } else if (tender.expertMatches.length === 0) {
    nextAction = {
      title: "Select experts for this tender",
      href: `/dashboard/tenders/${id}#matching`,
      rationale: "No experts are selected yet — the engine will not generate a meaningful proposal.",
    };
  } else if (tender.projectMatches.length === 0) {
    nextAction = {
      title: "Select reference projects for this tender",
      href: `/dashboard/tenders/${id}#matching`,
      rationale: "No projects are selected yet — the proposal needs comparable evidence.",
    };
  } else if (!latestVersion) {
    nextAction = {
      title: "Generate the technical proposal",
      href: `/dashboard/tenders/${id}#generate`,
      rationale: "Selections are in place. Run the proposal engine.",
    };
  } else {
    nextAction = {
      title: "Run evaluator simulation on the latest version",
      href: `/dashboard/tenders/${id}#evaluator`,
      rationale: "Last engine run produced a proposal; red-team it before final review.",
    };
  }

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <Link href={`/dashboard/tenders/${id}`} className="text-sm text-slate-500 hover:text-slate-800 no-underline">
            ← Tender detail
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{tender.title}</h1>
          <p className="text-sm text-slate-500">Command Center — single view of readiness, blockers, and next best action.</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          <div className="text-xs text-slate-500">Status / Stage</div>
          <div className="font-semibold text-slate-800">{tender.status} / {tender.stage}</div>
          <div className="text-xs text-slate-500 mt-1">Readiness: {Math.round(tender.readinessScore ?? 0)}/100</div>
        </div>
      </div>

      {/* Next best action banner */}
      <section className="rounded-xl bg-blue-700 text-white p-5 mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest opacity-80">Next best action</div>
        <div className="mt-1 text-lg font-semibold">{nextAction.title}</div>
        <div className="mt-1 text-sm opacity-90">{nextAction.rationale}</div>
        {nextAction.href && (
          <a
            href={nextAction.href}
            className="mt-3 inline-block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 no-underline"
          >
            Take action →
          </a>
        )}
      </section>

      {/* 4-column status grid — responsive */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <StatCard title="Selected experts" value={tender.expertMatches.length} caption={tender.expertMatches.slice(0, 2).map((m) => m.expert.fullName).join(" · ") || "None"} />
        <StatCard title="Selected projects" value={tender.projectMatches.length} caption={tender.projectMatches.slice(0, 2).map((m) => m.project.name).join(" · ") || "None"} />
        <StatCard title="Documents" value={tender.generatedDocuments.length} caption={`${canonical?.summary.documentBlockers ?? docReadiness.failures.length} final blockers`} />
        <StatCard title="Open HIGH objections" value={openHigh.length} caption={openHigh.length > 0 ? "Export gate is closed" : "Export gate clear"} highlight={openHigh.length > 0} />
      </section>

      {/* Export gate */}
      <section id="blockers" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Export gate</h2>
        {(canonical?.ok ?? (docReadiness.ok && tenderBlockers.length === 0)) ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
            ✓ Export gate is open. All documents READY_FOR_EXPORT and no tender-level blockers.
          </div>
        ) : (
          <div className="space-y-2">
            {tenderBlockers.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                <p className="font-semibold mb-2">Tender-level blockers ({tenderBlockers.length})</p>
                {tenderBlockers.map((b, i) => (
                  <div key={i} className="mb-1.5 text-xs">
                    <span className="font-semibold">[{b.severity}]</span> {b.title}
                    {b.recommendedAction && <div className="text-red-600 mt-0.5">Action: {b.recommendedAction}</div>}
                  </div>
                ))}
              </div>
            )}
            {docReadiness.failures.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                <p className="font-semibold mb-2">Documents not ready ({docReadiness.failures.length})</p>
                {docReadiness.failures.slice(0, 6).map((f) => (
                  <div key={f.documentId} className="mb-1 text-xs">• {f.fileName} — {f.reasons.join("; ")}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Evaluator objections */}
      <section id="evaluator" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Evaluator objections</h2>
        {objections.length === 0 ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
            No evaluator simulation has been run yet for this tender.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200 rounded-lg border-collapse bg-white text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Severity</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Title</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Status</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200 hidden sm:table-cell">Section</th>
                </tr>
              </thead>
              <tbody>
                {objections.slice(0, 15).map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${o.severity === "HIGH" ? "bg-red-100 text-red-700" : o.severity === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {o.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800">{o.title}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{o.status}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 hidden sm:table-cell">{o.sectionRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openMedium.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">{openMedium.length} MEDIUM objection(s) open — non-blocking but worth closing before submission.</p>
        )}
      </section>

      {/* Proposal version history — with restore + preview actions */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent proposal versions</h2>
        <VersionActionsTable versions={proposalVersions} tenderId={id} />
      </section>

      {/* Pricing workbook */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Pricing workbook</h2>
        {!workbook ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
            No pricing workbook created yet.
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700 space-y-1.5">
            <div>Currency: <strong>{workbook.currency}</strong> · Validity: {workbook.validityDays} days · Scenario: <strong>{workbook.scenario}</strong></div>
            <div>VAT {workbook.vatPercent}% · Withholding {workbook.withholdingPct}% · Contingency {workbook.contingencyPct}%</div>
            <div>Cost lines: <strong>{workbook.lines.length}</strong></div>
            <div>
              Price leakage check:{" "}
              {workbook.noPriceLeakage
                ? <span className="text-emerald-700 font-medium">✓ clear</span>
                : <span className="text-red-700 font-semibold">✗ flagged — export blocked</span>
              }
            </div>
          </div>
        )}
      </section>

      {/* Recent AI jobs */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent background AI jobs</h2>
        {recentJobs.length === 0 ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
            No background AI jobs have been queued yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200 rounded-lg border-collapse bg-white text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Job type</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Status</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Created</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200 hidden md:table-cell">Finished</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-700">{j.jobType}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${j.status === "DONE" ? "bg-green-100 text-green-700" : j.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(j.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell">{j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ title, value, caption, highlight }: { title: string; value: number | string; caption?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 text-2xl font-bold ${highlight ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {caption && <div className="mt-1 text-xs text-slate-500 truncate">{caption}</div>}
    </div>
  );
}
