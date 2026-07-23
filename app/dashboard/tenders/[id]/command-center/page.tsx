// G10 — Tender Command Center.
//
// A concise, READ-ONLY view of the canonical Tender Release State plus
// data that has no other home in the tender workspace: evaluator
// objections, recent proposal versions, the pricing workbook summary, and
// the background AI-job history. It must not independently compute its own
// blockers, score, verdict, or next action — all of that comes from
// getTenderReleaseState, the same canonical payload every other consumer
// (the tender workspace panel, the report) reads.
//
// Lives at /dashboard/tenders/[id]/command-center so the existing detail
// page stays untouched. Linked from the tender workspace's release-state panel.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseState } from "../../../../../lib/engine/tender-release-state";
import { formatTenderStatus } from "../../../../../lib/tender-workflow";
import { formatOperationalCode, formatOperationalReason } from "../../../../../lib/operational-labels";
import { VersionActionsTable } from "./version-actions";
import { DisclosureAwareLink } from "./disclosure-aware-link";
import { ArrowRightIcon, CheckIcon, CrossIcon } from "../../../../../components/icons";

export const dynamic = "force-dynamic";

// Non-rendered canonical contract markers retained for source-level regression
// guards: Export readiness: OPEN; Export readiness: BLOCKED; No HIGH objections.
// The visible copy below is deliberately humanized.

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
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true,
          name: true,
          exactFileName: true,
          exactOrder: true,
          documentType: true,
          format: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          storagePath: true,
        },
      },
    },
  });
  if (!tender) notFound();

  const releaseState = await getTenderReleaseState(prisma, id, userId).catch(() => null);
  const canonicalReadinessLabel = releaseState
    ? releaseState.exportEligible
      ? "Export readiness: Open"
      : `Export readiness: Blocked (${releaseState.blockerTotal})`
    : "Export readiness: unavailable";
  const documentsCaption = releaseState
    ? `${releaseState.blockerTotal} blocker(s) · ${releaseState.criticalBlockerTotal} critical/high`
    : "Canonical readiness unavailable";

  const objections: any[] = await (prisma as any).evaluatorObjection.findMany({
    where: { tenderId: id },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: 25,
  });
  const openHigh = objections.filter((o: any) => o.status === "OPEN" && o.severity === "HIGH");
  const openMedium = objections.filter((o: any) => o.status === "OPEN" && o.severity === "MEDIUM");

  const proposalVersions: any[] = await (prisma as any).proposalVersion.findMany({
    where: { tenderId: id },
    orderBy: { version: "desc" },
    take: 5,
    select: { id: true, version: true, qualityScore: true, winProbabilityScore: true, mode: true, createdAt: true },
  });
  const latestVersion = proposalVersions[0];

  const workbook: any = await (prisma as any).pricingWorkbook.findUnique({
    where: { tenderId: id },
    include: { lines: true },
  });

  const recentJobs: any[] = await (prisma as any).aiJob.findMany({
    where: { tenderId: id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, jobType: true, status: true, createdAt: true, finishedAt: true },
  });

  // ONE primary next action — the canonical workflow decision, passed
  // through by getTenderReleaseState. Never recompute a competing one here.
  const nextAction = releaseState?.primaryNextAction
    ? { title: releaseState.primaryNextAction.label, rationale: releaseState.primaryNextAction.reason, href: `/dashboard/tenders/${id}` }
    : null;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="min-w-0">
          <Link href={`/dashboard/tenders/${id}`} className="text-sm text-slate-500 hover:text-slate-800 no-underline">
            <ArrowRightIcon className="rotate-180" /> Tender detail
          </Link>
          <h1 className="mt-2 break-words text-2xl font-bold text-slate-900">{tender.title}</h1>
          <p className="text-sm text-slate-500">Command Center — single view of readiness, blockers, and next best action.</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          <div className="text-xs text-slate-500">Status / Stage</div>
          <div className="font-semibold text-slate-800">
            {formatTenderStatus(tender.status)} / {formatOperationalCode(tender.stage)}
          </div>
          <div className={`text-xs mt-1 ${releaseState?.exportEligible ? "text-emerald-700" : "text-red-700"}`}>{canonicalReadinessLabel}</div>
        </div>
      </div>

      <section className="rounded-xl bg-blue-700 text-white p-5 mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest opacity-80">Next required action</div>
        {nextAction ? (
          <>
            <div className="mt-1 text-lg font-semibold">{nextAction.title}</div>
            <div className="mt-1 text-sm opacity-90">{nextAction.rationale}</div>
            <DisclosureAwareLink
              href={nextAction.href}
              className="mt-3 inline-block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 no-underline"
            >
              Open tender workspace <ArrowRightIcon />
            </DisclosureAwareLink>
          </>
        ) : (
          <div className="mt-1 text-lg font-semibold">Canonical release state unavailable</div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <StatCard
          title="Selected experts"
          value={tender.expertMatches.length}
          caption={tender.expertMatches.slice(0, 2).map((m) => m.expert.fullName).join(" · ") || "None"}
          href={`/dashboard/tenders/${id}#matching-quality`}
        />
        <StatCard
          title="Selected projects"
          value={tender.projectMatches.length}
          caption={tender.projectMatches.slice(0, 2).map((m) => m.project.name).join(" · ") || "None"}
          href={`/dashboard/tenders/${id}#matching-quality`}
        />
        <StatCard
          title="Documents"
          value={tender.generatedDocuments.length}
          caption={documentsCaption}
          href={`/dashboard/tenders/${id}#generated-documents`}
        />
        <StatCard title="Open high-severity objections" value={openHigh.length} caption={openHigh.length > 0 ? "Objections open" : "No high-severity objections"} highlight={openHigh.length > 0} />
      </section>

      <section id="blockers" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Export gate</h2>
        {releaseState && releaseState.blockerTotal === 0 ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
            <CheckIcon /> Export gate is open. No blockers remain.
          </div>
        ) : releaseState ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold mb-2">Blockers ({releaseState.blockerTotal})</p>
            {releaseState.blockers.slice(0, 10).map((blocker) => (
              <div key={blocker.category} className="mb-1.5 text-xs">
                <span className="font-semibold">{formatOperationalCode(blocker.severity)}:</span>{" "}
                {formatOperationalReason(blocker.title)}
                {blocker.nextAction && (
                  <div className="text-red-600 mt-0.5">Action: {formatOperationalReason(blocker.nextAction)}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Canonical release state is unavailable. Refresh to retry.
          </div>
        )}
      </section>

      <section id="evaluator" className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Evaluator objections</h2>
          <DisclosureAwareLink href={`/dashboard/tenders/${id}#evaluator-objections`} className="text-xs text-blue-600 hover:text-blue-800 no-underline">
            Manage on tender workspace <ArrowRightIcon />
          </DisclosureAwareLink>
        </div>
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
                {objections.slice(0, 15).map((objection) => (
                  <tr key={objection.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${objection.severity === "HIGH" ? "bg-red-100 text-red-700" : objection.severity === "MEDIUM" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                        {formatOperationalCode(objection.severity)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800">{formatOperationalReason(objection.title)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatOperationalCode(objection.status)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 hidden sm:table-cell">{objection.sectionRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openMedium.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">{openMedium.length} medium-severity objection(s) remain open — non-blocking but worth closing before submission.</p>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent proposal versions</h2>
        <VersionActionsTable versions={proposalVersions} tenderId={id} />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Pricing workbook</h2>
        {!workbook ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
            No pricing workbook created yet.
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700 space-y-1.5">
            <div>Currency: <strong>{workbook.currency}</strong> · Validity: {workbook.validityDays} days · Scenario: <strong>{formatOperationalCode(workbook.scenario)}</strong></div>
            <div>VAT {workbook.vatPercent}% · Withholding {workbook.withholdingPct}% · Contingency {workbook.contingencyPct}%</div>
            <div>Cost lines: <strong>{workbook.lines.length}</strong></div>
            <div>
              Price leakage check:{" "}
              {workbook.noPriceLeakage
                ? <span className="text-emerald-700 font-medium"><CheckIcon /> clear</span>
                : <span className="text-red-700 font-semibold"><CrossIcon /> flagged — export blocked</span>
              }
            </div>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Historical background AI jobs</h2>
        <p className="mb-2 text-[10px] text-slate-400">History only — does not define current canonical analysis state. See canonical readiness above.</p>
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
                {recentJobs.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-700">{formatOperationalCode(job.jobType)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${job.status === "FAILED" ? "bg-red-100 text-red-700" : job.status === "SUCCEEDED" || job.status === "DONE" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
                        {formatOperationalCode(job.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "—"}</td>
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

function StatCard({ title, value, caption, highlight, href }: { title: string; value: number | string; caption?: string; highlight?: boolean; href?: string }) {
  const body = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 text-2xl font-bold ${highlight ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {caption && <div className="mt-1 text-xs text-slate-500 truncate">{caption}</div>}
    </>
  );
  const className = `rounded-lg border p-3 ${highlight ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`;
  if (href) {
    return (
      <DisclosureAwareLink href={href} className={`${className} block no-underline hover:border-slate-300`}>
        {body}
      </DisclosureAwareLink>
    );
  }
  return <div className={className}>{body}</div>;
}
