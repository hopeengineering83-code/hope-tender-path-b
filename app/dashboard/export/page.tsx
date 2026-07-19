import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { ExportTenderCard } from "./export-tender-card";
import { getFinalSubmissionReadiness, type FinalSubmissionReadiness } from "../../../lib/engine/final-submission-readiness";

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

  // ── Canonical readiness per tender ──────────────────────────────────
  // The export page must NOT compute readiness locally from generated count
  // and persisted CRITICAL gaps. The canonical server authority
  // (getFinalSubmissionReadiness) checks extraction, analysis, source
  // grounding, reviewed evidence, Build Plan, approvals, storage, manifest,
  // and byte integrity. We call it for each tender and pass the result
  // (blocker codes + next action) to the card.
  const readinessResults: Array<{ tenderId: string; readiness: FinalSubmissionReadiness | null }> = [];
  for (const tender of tenders) {
    const readiness = await getFinalSubmissionReadiness(prisma, {
      tenderId: tender.id,
      userId,
    }).catch(() => null);
    readinessResults.push({ tenderId: tender.id, readiness });
  }
  const readinessByTenderId = new Map(readinessResults.map((r) => [r.tenderId, r.readiness]));

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
          // ── Filter to GENERATED rows only for the "generated count" ──
          // Planned/PENDING/FAILED rows must NOT count as generated, ready,
          // downloadable, or included in ZIP. They may appear in a separate
          // "pending/planned" section for visibility but never as ready.
          const generated = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
          const allPassed = generated.every((d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED");
          const criticalGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
          const highGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH");
          const unresolvedMediumLow = tender.complianceGaps.filter((g) => !g.isResolved && !["CRITICAL", "HIGH"].includes(g.severity));
          const blockingGaps = criticalGaps.length;
          const warningGaps = highGaps.length + unresolvedMediumLow.length;
          const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY").length;

          // ── Canonical readiness from server authority ──────────────
          const canonical = readinessByTenderId.get(tender.id) ?? null;
          const canonicalBlockers = canonical?.tenderLevelBlockers ?? [];
          const isCanonicalReady = canonical?.ok === true && canonicalBlockers.length === 0;
          // FinalReadinessTenderBlocker has {category, severity, title, recommendedAction}.
          // Use category as the blocker code and title/recommendedAction for the next action.
          const canonicalBlockerCodes = canonicalBlockers.map((b) => b.category);
          const canonicalNextAction = canonicalBlockers.length > 0
            ? canonicalBlockers[0]?.recommendedAction ?? canonicalBlockers[0]?.title ?? "Resolve the primary blocker below."
            : "All canonical gates passed. Download the final package.";

          const checks = [
            // Checks generatedDocuments (system-authored output rows), not the
            // source tender file uploads — label matches what's actually measured
            // to avoid implying "0 source files uploaded" when only output
            // generation hasn't started yet.
            { label: "Document workspace initialized", done: tender.generatedDocuments.length > 0 },
            { label: `${generated.length} document${generated.length !== 1 ? "s" : ""} generated`, done: generated.length > 0 },
            { label: "All documents validated", done: generated.length > 0 && allPassed, warn: generated.length > 0 && !allPassed },
            { label: `No critical compliance gaps (${blockingGaps} remaining)`, done: blockingGaps === 0, blocking: blockingGaps > 0 },
            { label: `${highGaps.length + unresolvedMediumLow.length} warning gap${warningGaps !== 1 ? "s" : ""} (non-blocking)`, done: warningGaps === 0, warn: warningGaps > 0 },
            { label: `${mandatoryReqs} mandatory requirement${mandatoryReqs !== 1 ? "s" : ""} covered`, done: mandatoryReqs > 0 },
            // Canonical gate check — surfaces extraction/analysis/grounding/plan/storage/manifest/integrity
            {
              label: isCanonicalReady
                ? "Canonical final-submission readiness passed"
                : `Canonical readiness: ${canonicalBlockerCodes.length} blocker(s)`,
              done: isCanonicalReady,
              blocking: !isCanonicalReady,
            },
          ];

          // isReady is now derived from canonical authority, not local computation
          const isReady = isCanonicalReady;
          const isExported = tender.status === "EXPORTED";

          return (
            <ExportTenderCard
              key={tender.id}
              tenderId={tender.id}
              tenderTitle={tender.title}
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
              canonicalBlockerCodes={canonicalBlockerCodes}
              canonicalNextAction={canonicalNextAction}
            />
          );
        })}
      </div>
    </div>
  );
}
