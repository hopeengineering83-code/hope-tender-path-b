import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { ExportTenderCard } from "./export-tender-card";

export default async function ExportPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
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
          const allPassed = generated.every((d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED");
          const criticalGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
          const highGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH");
          const unresolvedMediumLow = tender.complianceGaps.filter((g) => !g.isResolved && !["CRITICAL", "HIGH"].includes(g.severity));
          const blockingGaps = criticalGaps.length;
          const warningGaps = highGaps.length + unresolvedMediumLow.length;
          const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY").length;

          const checks = [
            { label: "Tender documents uploaded", done: tender.generatedDocuments.length > 0 },
            { label: `${generated.length} document${generated.length !== 1 ? "s" : ""} generated`, done: generated.length > 0 },
            { label: "All documents validated", done: generated.length > 0 && allPassed, warn: generated.length > 0 && !allPassed },
            { label: `No critical compliance gaps (${blockingGaps} remaining)`, done: blockingGaps === 0, blocking: blockingGaps > 0 },
            { label: `${highGaps.length + unresolvedMediumLow.length} warning gap${warningGaps !== 1 ? "s" : ""} (non-blocking)`, done: warningGaps === 0, warn: warningGaps > 0 },
            { label: `${mandatoryReqs} mandatory requirement${mandatoryReqs !== 1 ? "s" : ""} covered`, done: mandatoryReqs > 0 },
          ];

          const isReady = blockingGaps === 0 && generated.length > 0;
          const isExported = tender.status === "EXPORTED";

          return (
            <ExportTenderCard
              key={tender.id}
              tenderId={tender.id}
              tenderTitle={tender.title}
              tenderStatus={tender.status}
              isReady={isReady}
              isExported={isExported}
              generatedCount={generated.length}
              totalDocs={tender.generatedDocuments.length}
              blockingGaps={blockingGaps}
              warningGaps={warningGaps}
              checks={checks}
              criticalGaps={criticalGaps}
              highGaps={highGaps}
              documents={tender.generatedDocuments}
            />
          );
        })}
      </div>
    </div>
  );
}
