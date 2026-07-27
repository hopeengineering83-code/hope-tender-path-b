import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessMatchingQuality } from "../lib/matching-quality";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { VAULT_REVIEW_CONSUMER_SELECT } from "../lib/vault-review-provenance";

export async function MatchingQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const [company, tender, latestCompletedEngineJob] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        expertMatches: { include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } },
        projectMatches: { include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } },
      },
    }),
    prisma.aiJob.findFirst({
      where: {
        tenderId,
        userId,
        jobType: "ENGINE_RUN",
        status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
  ]);
  if (!tender) return null;

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const quality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });

  const engineRanWithoutMatches = Boolean(latestCompletedEngineJob) &&
    quality.state === "VAULT_AWAITS_ENGINE" &&
    quality.expertMatches === 0 &&
    quality.projectMatches === 0;

  type PanelStyle = { color: "green" | "amber" | "red"; title: string };
  const panelStyle: PanelStyle = (() => {
    if (engineRanWithoutMatches) {
      return {
        color: "amber",
        title: "Engine ran but produced no usable tender-specific matches",
      };
    }
    switch (quality.state) {
      case "MATCHES_REVIEWED":
        return { color: "green", title: "Matches appear usable" };
      case "MATCHING_NOT_REQUIRED":
        return { color: "green", title: "Matching not required by this tender" };
      case "VAULT_AWAITS_ENGINE":
        return {
          color: "amber",
          title: `Run Engine to create ${quality.vaultReviewedExperts} expert + ${quality.vaultReviewedProjects} project match(es) from the vault`,
        };
      case "MATCHES_WEAK":
        return { color: "red", title: "Matching quality is weak — review/import stronger evidence" };
      case "NO_VAULT":
        return { color: "red", title: "No vault evidence to match against — import experts / projects first" };
      default:
        return { color: "red", title: "Matching quality is weak" };
    }
  })();
  const sectionCls = panelStyle.color === "green"
    ? "border-green-200 bg-green-50"
    : panelStyle.color === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  const labelCls = panelStyle.color === "green"
    ? "text-green-700"
    : panelStyle.color === "amber"
      ? "text-amber-700"
      : "text-red-700";

  const displayedWarnings = engineRanWithoutMatches
    ? [
        `A completed engine job exists, but it created no expert or project match rows from ${quality.vaultReviewedExperts} reviewed expert(s) and ${quality.vaultReviewedProjects} reviewed project(s) in the vault.`,
      ]
    : quality.warnings;
  const displayedRecommendations = engineRanWithoutMatches
    ? [
        "Review the extracted expert/project requirements and vault classifications, then rerun Safe Mode for deterministic matching.",
        "Use Full AI in Background only after deterministic match rows exist or when the tender terminology needs semantic refinement.",
      ]
    : quality.recommendations;

  return (
    <div id="match-evidence" className="scroll-mt-24">
      <section id="matching-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionCls}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${labelCls}`}>Matching quality</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{panelStyle.title}</h2>
            <p className="mt-1 text-sm text-slate-600">Checks selected and reviewed expert/project matches before proposal generation.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Matching score</p><p className="text-xl font-bold text-slate-900">{quality.score}/100</p></div>
          <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Expert matches</p><p className="text-xl font-bold text-slate-900">{quality.expertMatches}</p></div>
          <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Project matches</p><p className="text-xl font-bold text-slate-900">{quality.projectMatches}</p></div>
          <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected experts</p><p className="text-xl font-bold text-slate-900">{quality.selectedExperts}</p></div>
          <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected projects</p><p className="text-xl font-bold text-slate-900">{quality.selectedProjects}</p></div>
        </div>

        {displayedWarnings.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {displayedWarnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {displayedRecommendations.length > 0 && panelStyle.color !== "green" && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended actions</p>
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
              {displayedRecommendations.slice(0, 4).map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
