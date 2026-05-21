import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, submissionPlanFileCount } from "../lib/engine/submission-plan";

type Verdict = "BID_READY" | "BID_READY_WITH_WARNINGS" | "NOT_READY" | "NO_BID";

function verdictLabel(verdict: Verdict) {
  if (verdict === "BID_READY") return "BID READY";
  if (verdict === "BID_READY_WITH_WARNINGS") return "BID READY WITH WARNINGS";
  if (verdict === "NO_BID") return "NO BID";
  return "NOT READY";
}

function verdictClass(verdict: Verdict) {
  if (verdict === "BID_READY") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (verdict === "BID_READY_WITH_WARNINGS") return "border-amber-200 bg-amber-50 text-amber-800";
  if (verdict === "NO_BID") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-red-200 bg-red-50 text-red-800";
}

function statusText(value?: string | null) {
  return (value ?? "UNKNOWN").replace(/_/g, " ");
}

export async function BidControlVerdictPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;
  await prismaReady;

  const [generationReadiness, tender] = await Promise.all([
    getTenderGenerationReadiness(prisma, userId, tenderId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        complianceGaps: { where: { isResolved: false }, orderBy: { createdAt: "desc" } },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true },
        },
      },
    }),
  ]);

  if (!tender || !generationReadiness) return null;

  const plan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements: tender.requirements,
  });
  // Exclude NOT_EXPORTABLE (quick drafts, markdown previews) from all export/plan checks.
  // These are saved for user convenience but are intentionally not part of the final package.
  const exportableDocs = tender.generatedDocuments.filter((doc) => doc.reviewStatus !== "NOT_EXPORTABLE");
  const missingPlanFiles = findMissingGeneratedDocuments(plan, exportableDocs);
  const extraPlanFiles = findExtraGeneratedDocuments(plan, exportableDocs);
  const requiredPlanCount = submissionPlanFileCount(plan);
  const activeDocs = exportableDocs.length;
  const ungeneratedDocs = exportableDocs.filter((doc) => doc.generationStatus !== "GENERATED");
  const unvalidatedDocs = exportableDocs.filter((doc) => doc.validationStatus !== "VALIDATED");
  const unreviewedDocs = exportableDocs.filter((doc) => doc.reviewStatus !== "READY_FOR_EXPORT");
  const criticalGaps = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL");
  const highGaps = tender.complianceGaps.filter((gap) => gap.severity === "HIGH");

  // Gap 15 fix — pull full-proposal blockers in addition to legacy blockers.
  // This is what makes the verdict text actually consistent: the panel can
  // no longer say "Generation Ready" while NOT_READY because the same
  // gate decides both the header and the metric below.
  const fullProposalReady = generationReadiness.fullProposalReady ?? generationReadiness.ready;
  const supportPackageReady = generationReadiness.supportPackageReady ?? generationReadiness.ready;
  const fullProposalBlockers = generationReadiness.fullProposalBlockers ?? [];

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (tender.status === "NO_BID") blockers.push("Tender is marked NO_BID.");
  // Use the STRICT full-proposal blockers — these include the legacy
  // support-package blockers PLUS the stricter gates (matching=0,
  // client-name invalid, no reviewed evidence). Avoids duplicate
  // listings while ensuring the BID READY verdict requires the strict
  // gate to pass.
  if (!fullProposalReady) blockers.push(...fullProposalBlockers.map((item) => item.message));
  if (requiredPlanCount > 0 && missingPlanFiles.length > 0) blockers.push(`${missingPlanFiles.length} required planned file(s) are missing.`);
  if (activeDocs === 0) blockers.push("No active generated documents exist yet.");
  if (ungeneratedDocs.length > 0) blockers.push(`${ungeneratedDocs.length} document(s) are not generated.`);
  if (unvalidatedDocs.length > 0) blockers.push(`${unvalidatedDocs.length} document(s) are not validated.`);
  if (unreviewedDocs.length > 0) blockers.push(`${unreviewedDocs.length} document(s) are not marked READY_FOR_EXPORT.`);
  if (criticalGaps.length > 0) blockers.push(`${criticalGaps.length} unresolved critical compliance gap(s).`);

  warnings.push(...generationReadiness.warnings.map((item) => item.message));
  if (extraPlanFiles.length > 0) warnings.push(`${extraPlanFiles.length} generated file(s) are outside the tender submission plan.`);
  if (highGaps.length > 0) warnings.push(`${highGaps.length} unresolved high-severity review gap(s).`);

  const verdict: Verdict = tender.status === "NO_BID"
    ? "NO_BID"
    : blockers.length > 0
      ? "NOT_READY"
      : warnings.length > 0
        ? "BID_READY_WITH_WARNINGS"
        : "BID_READY";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${verdictClass(verdict)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Bid control verdict</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{verdictLabel(verdict)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Consolidates generation readiness, submission-plan reconciliation, compliance gaps, document validation, and review status into one final bid-control signal.</p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-xs text-slate-500">Tender status</p>
          <p className="text-sm font-bold text-slate-900">{statusText(tender.status)}</p>
        </div>
      </div>

      {/* Gap 15 fix — split "Generation" into the two readiness gates so
          the metric row can never show green while the verdict says
          NOT_READY. Full proposal is the strict gate; Support pkg is
          the legacy/vault-fallback gate. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="rounded-xl bg-white p-3" title="Strict gate — full proposal generation. Requires valid client metadata, real tender-specific matches with reviewed selections, non-zero matching score, and analysis quality not POOR.">
          <p className="text-xs text-slate-500">Full proposal</p>
          <p className={`text-lg font-bold ${fullProposalReady ? "text-emerald-700" : "text-red-700"}`}>{fullProposalReady ? "Ready" : "Blocked"}</p>
        </div>
        <div className="rounded-xl bg-white p-3" title="Lenient gate — support / compliance file generation. Allows vault fallback evidence.">
          <p className="text-xs text-slate-500">Support pkg</p>
          <p className={`text-lg font-bold ${supportPackageReady ? "text-emerald-700" : "text-red-700"}`}>{supportPackageReady ? "Ready" : "Blocked"}</p>
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Plan files</p><p className="text-lg font-bold text-slate-900">{Math.max(0, requiredPlanCount - missingPlanFiles.length)}/{requiredPlanCount}</p></div>
        <div className="rounded-xl bg-white p-3" title={`${activeDocs} non-superseded GeneratedDocument row(s). Includes ${extraPlanFiles.length} row(s) outside the current submission plan that should be reconciled or superseded.`}><p className="text-xs text-slate-500">Active rows{extraPlanFiles.length > 0 ? ` (${extraPlanFiles.length} stale)` : ""}</p><p className="text-lg font-bold text-slate-900">{activeDocs}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Critical gaps</p><p className="text-lg font-bold text-slate-900">{criticalGaps.length}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Ready for export</p><p className="text-lg font-bold text-slate-900">{activeDocs > 0 && ungeneratedDocs.length + unvalidatedDocs.length + unreviewedDocs.length === 0 ? "Yes" : "No"}</p></div>
      </div>

      {blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800">
          <p className="font-semibold">Blockers to fix before submission</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{blockers.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800">
          <p className="font-semibold">Warnings requiring senior review</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
