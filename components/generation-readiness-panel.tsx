import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";

function actionHref(tenderId: string, action?: string): string {
  if (action === "OPEN_COMPANY_READINESS") return "/dashboard/company/readiness";
  if (action === "RUN_ENGINE") return `/dashboard/tenders/${tenderId}`;
  if (action === "REVIEW_MATCHES") return `/dashboard/tenders/${tenderId}`;
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "/dashboard/company/review-board";
  if (action === "OPEN_COMPLIANCE_REVIEW") return "/dashboard/compliance";
  if (action === "RESOLVE_COMPLIANCE_GAPS") return "/dashboard/compliance";
  return `/dashboard/tenders/${tenderId}`;
}

function buildActionLabel(action?: string): string {
  if (action === "OPEN_COMPANY_READINESS") return "Open company readiness";
  if (action === "RUN_ENGINE") return "Run engine";
  if (action === "REVIEW_MATCHES") return "Review matches";
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "Open review board";
  if (action === "OPEN_COMPLIANCE_REVIEW" || action === "RESOLVE_COMPLIANCE_GAPS") return "Open compliance";
  return "Open tender";
}

export async function GenerationReadinessPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const readiness = await getTenderGenerationReadiness(prisma, userId, tenderId);
  if (!readiness) return null;

  const { ready, blockers, warnings } = readiness;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Generation readiness</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Ready to generate" : "Generation blockers found"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for company knowledge, tender analysis, compliance blockers, and selected reviewed evidence.</p>
        </div>
        <Link href={`/api/tenders/${tenderId}/generation-readiness`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Open JSON
        </Link>
      </div>

      {blockers.length > 0 && (
        <div className="mt-4 space-y-2">
          {blockers.map((item, index) => (
            <div key={`${item.code}-${index}`} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.message}</span>
                <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-red-700 underline">{buildActionLabel(item.nextAction)}</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.slice(0, 5).map((item, index) => (
            <div key={`${item.code}-${index}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.message}</span>
                <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-amber-700 underline">{buildActionLabel(item.nextAction)}</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
