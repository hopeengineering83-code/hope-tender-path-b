import Link from "next/link";
import { getCurrentUser } from "../lib/auth";
import { canMutateTender } from "../lib/recovery-command-actions";
import { prisma, prismaReady } from "../lib/prisma";
import { findExtraGeneratedDocuments, findMissingGeneratedDocuments, submissionPlanFileCount, submissionPlanFileKey, type SubmissionEnvelope } from "../lib/engine/submission-plan";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "../lib/engine/build-plan";
import { BuildSubmissionPlanButton } from "./build-submission-plan-button";
import { GenerateMissingPlanFilesButton } from "./generate-missing-plan-files-button";
import { ReconcileStaleFilesButton } from "./reconcile-stale-files-button";
import { clientLogger } from "@/lib/ui/client-logger";
import { PanelErrorFallback } from "./panel-error-fallback";

function statusClass(ok: boolean) {
  return ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
}

function docStatusLabel(status?: string | null) {
  return (status ?? "PLANNED").replace(/_/g, " ");
}

const ENVELOPE_BADGE: Record<SubmissionEnvelope, string> = {
  TECHNICAL: "bg-blue-100 text-blue-700",
  FINANCIAL: "bg-amber-100 text-amber-800",
  ADMIN:     "bg-slate-100 text-slate-600",
};

export async function SubmissionPlanReconciliationPanel({ tenderId }: { tenderId: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const userId = user.id;
  const canMutate = canMutateTender(user.role);

  try {
  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, generationStatus: true, validationStatus: true, reviewStatus: true },
      },
    },
  });
  if (!tender) return null;

  const confirmed = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
  if (!confirmed.ok) {
    return (
      <section id="submission-plan-reconciliation" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Submission plan reconciliation</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">No current confirmed Build Plan</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{confirmed.blocker} Document counts, export eligibility, and reconciliation are unavailable until a Build Plan is rebuilt and confirmed.</p>
          </div>
          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            {canMutate && <BuildSubmissionPlanButton tenderId={tenderId} />}
          </div>
        </div>
        {tender.generatedDocuments.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3 text-sm">
            <p className="font-semibold text-amber-900">{tender.generatedDocuments.length} existing document(s) are NOT part of a confirmed plan</p>
            <p className="mt-1 text-xs text-amber-800">These rows are preserved for audit but excluded from final-export counts until they match a current confirmed Build Plan.</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Link href={`/api/tenders/${tenderId}/export-readiness`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">Open export readiness JSON</Link>
        </div>
      </section>
    );
  }
  const planItems: BuildPlanItem[] = confirmed.items;
  const requiredItems = planItems.filter((item) => item.required);
  const requiredCount = requiredItems.length;
  const missing = findMissingGeneratedDocuments({ files: planItems, warnings: [] } as any, tender.generatedDocuments);
  const extra = findExtraGeneratedDocuments({ files: planItems, warnings: [] } as any, tender.generatedDocuments);
  const generatedCount = Math.max(0, requiredCount - missing.length);
  const ok = requiredCount > 0 && missing.length === 0 && extra.length === 0;
  const plan = { files: planItems, warnings: [] as string[] };
  if (requiredCount === 0) return null;

  return (
    <section id="submission-plan-reconciliation" className={`mb-4 rounded-2xl border p-5 shadow-sm ${statusClass(ok)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Submission plan reconciliation</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ok ? "Submission file plan is reconciled" : "Submission file plan needs action"}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Compares tender-required file names/order against active generated documents so missing or extra package files are visible before export.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 lg:items-end">
          <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
            <p className="text-xs text-slate-500">Required generated files</p>
            <p className="text-2xl font-bold text-slate-900">{generatedCount}/{requiredCount}</p>
          </div>
          {missing.length > 0 && canMutate && <GenerateMissingPlanFilesButton tenderId={tenderId} missingCount={missing.length} />}
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {requiredCount > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/70 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Tender-required file</th>
                <th className="px-3 py-2">Envelope</th>
                <th className="px-3 py-2">Format</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {requiredItems.map((file) => {
                const generated = tender.generatedDocuments.find((doc) => submissionPlanFileKey(doc.exactFileName ?? doc.name) === submissionPlanFileKey(file.exactFileName));
                return (
                  <tr key={file.canonicalId}>
                    <td className="px-3 py-2 font-medium">{file.exactOrder}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-slate-900">{file.exactFileName}</p>
                      <p className="text-xs text-slate-500">{file.documentType}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ENVELOPE_BADGE[file.envelope ?? "TECHNICAL"]}`}>
                        {file.envelope ?? "TECHNICAL"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{file.format}</td>
                    <td className="px-3 py-2">{generated ? docStatusLabel(generated.generationStatus) : "MISSING"}</td>
                    <td className="px-3 py-2">{generated ? docStatusLabel(generated.reviewStatus) : "Not generated"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(missing.length > 0 || extra.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {missing.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm">
              <p className="font-semibold text-amber-900">Missing required files</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800">
                {missing.slice(0, 8).map((file) => <li key={file.canonicalId}>{file.exactFileName}</li>)}
              </ul>
            </div>
          )}
          {extra.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-white p-3 text-sm">
              <p className="font-semibold text-red-900">Extra generated files outside plan</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-800">
                {extra.slice(0, 8).map((doc) => <li key={doc.id ?? doc.exactFileName ?? doc.name ?? "extra"}>{doc.exactFileName ?? doc.name ?? doc.documentType}</li>)}
              </ul>
              {/* One-click reconciliation. POSTs /api/tenders/[id]/reconcile-docs
                  (built in PR #371). For each stale row, the reconciler decides
                  KEEP / RELINK / SUPERSEDE / NEEDS_REVALIDATION and writes
                  the result back. Audit-logged via TENDER_DOCS_RECONCILED. */}
              {canMutate && <ReconcileStaleFilesButton tenderId={tenderId} staleCount={extra.length} />}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Link href={`/api/tenders/${tenderId}/export-readiness`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">Open export readiness JSON</Link>
        <span className="rounded-lg bg-white px-3 py-2 text-slate-600">Use the missing-file action above to create planned package files, then review and validate before export.</span>
      </div>
    </section>
  );
  } catch (err) {
    clientLogger.error("[SubmissionPlanReconciliationPanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="Submissionplanreconciliationpanel" />
  }
}
