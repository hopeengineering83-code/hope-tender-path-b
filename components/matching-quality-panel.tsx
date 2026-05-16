import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessMatchingQuality } from "../lib/matching-quality";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";

export async function MatchingQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);
  if (!tender) return null;

  // Gap 5 — pass vault counts so this panel returns state=VAULT_AWAITS_ENGINE
  // (softer score, with the "engine hasn't run yet" message) when the company
  // vault has reviewed evidence ready but engine hasn't been run on this
  // tender. Without these counts the panel hard-deducted -35-35 → 30/100
  // POOR while the Bid Control Verdict (which DID pass vault counts via
  // getTenderGenerationReadiness) showed 64/100 WARNING. PR #371 fixed
  // the dedicated API route but missed this server-component path which
  // calls assessMatchingQuality directly — that's why the May 16
  // screenshot still showed 30/100 in the panel even after the route fix.
  const companyReadiness = await getCompanyIngestionReadiness(company.id, prisma);
  const quality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const ready = quality.severity !== "POOR";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Matching quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Matches appear usable" : "Matching quality is weak"}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks selected and reviewed expert/project matches before proposal generation.</p>
        </div>
        <Link href={`/api/tenders/${tenderId}/matching-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Open JSON
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Score</p><p className="text-xl font-bold text-slate-900">{quality.score}/100</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Expert matches</p><p className="text-xl font-bold text-slate-900">{quality.expertMatches}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Project matches</p><p className="text-xl font-bold text-slate-900">{quality.projectMatches}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected experts</p><p className="text-xl font-bold text-slate-900">{quality.selectedExperts}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected projects</p><p className="text-xl font-bold text-slate-900">{quality.selectedProjects}</p></div>
      </div>

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
