import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export default async function ExportPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      generatedDocuments: {
        select: {
          id: true, name: true, generationStatus: true, validationStatus: true,
          reviewStatus: true, exactFileName: true, exactOrder: true,
        },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "desc" }],
      },
      complianceGaps: {
        select: { id: true, title: true, severity: true, isResolved: true },
      },
      requirements: { select: { id: true, priority: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Export Packages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review submission readiness and download the full package for each tender.
        </p>
      </div>

      {tenders.length === 0 && (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-400">No tenders found. Create a tender to get started.</p>
        </div>
      )}

      <div className="space-y-6">
        {tenders.map((tender) => {
          const generated = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
          const allPassed = generated.every((d) => d.validationStatus === "PASSED");
          const criticalGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
          const highGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH");
          const unresolvedMediumLow = tender.complianceGaps.filter((g) => !g.isResolved && !["CRITICAL", "HIGH"].includes(g.severity));
          const blockingGaps = criticalGaps.length + highGaps.length;
          const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY").length;

          const checks = [
            { label: "Tender documents uploaded", done: tender.generatedDocuments.length > 0 },
            { label: `${generated.length} document${generated.length !== 1 ? "s" : ""} generated`, done: generated.length > 0 },
            { label: "All documents validated", done: generated.length > 0 && allPassed, warn: generated.length > 0 && !allPassed },
            { label: `No critical/high compliance gaps (${blockingGaps} remaining)`, done: blockingGaps === 0, blocking: blockingGaps > 0 },
            { label: `${mandatoryReqs} mandatory requirement${mandatoryReqs !== 1 ? "s" : ""} covered`, done: mandatoryReqs > 0 },
          ];

          const isReady = blockingGaps === 0 && generated.length > 0;
          const isExported = tender.status === "EXPORTED";

          return (
            <div key={tender.id} className="rounded-2xl border bg-white shadow-sm">
              <div className="flex items-start justify-between gap-4 p-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                    {isExported && <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700">Exported</span>}
                    {isReady && !isExported && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs text-emerald-700">Ready</span>}
                    {!isReady && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700">Not ready</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {generated.length} / {tender.generatedDocuments.length} docs generated
                    {blockingGaps > 0 && <span className="ml-2 text-red-600">{blockingGaps} blocking gap{blockingGaps !== 1 ? "s" : ""}</span>}
                    {unresolvedMediumLow.length > 0 && <span className="ml-2 text-amber-600">{unresolvedMediumLow.length} warning{unresolvedMediumLow.length !== 1 ? "s" : ""}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isReady && (
                    <a
                      href={`/api/tenders/${tender.id}/download?type=zip`}
                      target="_blank"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
                    >
                      ↓ Download ZIP
                    </a>
                  )}
                  <Link href={`/dashboard/tenders/${tender.id}`}
                    className="rounded border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    Open workspace
                  </Link>
                </div>
              </div>

              <div className="border-t px-6 pb-6 pt-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Submission checklist</p>
                <ul className="space-y-2">
                  {checks.map((check, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        check.blocking ? "bg-red-500 text-white" :
                        check.done ? "bg-green-500 text-white" :
                        check.warn ? "bg-amber-400 text-white" :
                        "border-2 border-slate-200 text-slate-300"
                      }`}>
                        {check.blocking ? "✕" : check.done ? "✓" : check.warn ? "!" : ""}
                      </span>
                      <span className={check.blocking ? "text-red-600 font-medium" : check.done ? "text-slate-700" : "text-slate-400"}>
                        {check.label}
                      </span>
                    </li>
                  ))}
                </ul>

                {(criticalGaps.length > 0 || highGaps.length > 0) && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm font-medium text-red-800 mb-2">Blocking compliance gaps</p>
                    <ul className="space-y-1">
                      {[...criticalGaps, ...highGaps].map((gap) => (
                        <li key={gap.id} className="flex items-center gap-2 text-sm text-red-700">
                          <span className="text-xs font-bold">[{gap.severity}]</span>
                          {gap.title}
                        </li>
                      ))}
                    </ul>
                    <Link href="/dashboard/compliance" className="mt-2 inline-block text-xs text-red-600 underline hover:no-underline">
                      Resolve in Compliance Dashboard →
                    </Link>
                  </div>
                )}

                {generated.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium text-slate-600">Document checklist ({generated.length} ready)</p>
                    <div className="space-y-1">
                      {tender.generatedDocuments.map((doc) => {
                        const isGen = doc.generationStatus === "GENERATED";
                        return (
                          <div key={doc.id} className="flex items-center gap-3 text-sm">
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] ${isGen ? "bg-green-500 text-white" : "border border-slate-200 text-slate-300"}`}>
                              {isGen ? "✓" : ""}
                            </span>
                            <span className={isGen ? "text-slate-700" : "text-slate-400"}>
                              {doc.exactOrder ? `${doc.exactOrder}. ` : ""}{doc.exactFileName || doc.name}
                            </span>
                            {isGen && (
                              <a
                                href={`/api/tenders/${tender.id}/download?docId=${doc.id}`}
                                target="_blank"
                                className="ml-auto text-xs text-blue-500 hover:underline"
                              >
                                ↓
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
