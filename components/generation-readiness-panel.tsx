import Link from "next/link";
import { getSession } from "../lib/auth";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { prisma, prismaReady } from "../lib/prisma";

type ReadinessItem = { code: string; message: string; nextAction?: string };

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

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
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        complianceGaps: { where: { isResolved: false }, select: { title: true, description: true, mitigationPlan: true, severity: true } },
        expertMatches: { include: { expert: { select: { trustLevel: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true } } } },
      },
    }),
  ]);
  if (!tender) return null;

  const companyReadiness = await getCompanyIngestionReadiness(company.id);
  const blockers: ReadinessItem[] = companyReadiness.blockers.map((message) => ({ code: "COMPANY_INGESTION_NOT_READY", message, nextAction: "OPEN_COMPANY_READINESS" }));
  const warnings: ReadinessItem[] = companyReadiness.warnings.map((message) => ({ code: "COMPANY_INGESTION_WARNING", message, nextAction: "OPEN_COMPANY_READINESS" }));

  if (tender.status === "NO_BID") blockers.push({ code: "NO_BID_BLOCK", message: "Tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generation." });
  if (tender.requirements.length === 0) blockers.push({ code: "NO_REQUIREMENTS", message: "No tender requirements are extracted. Run AI Analyze / Run Engine first, or add requirements manually.", nextAction: "RUN_ENGINE" });

  const hardBlocks = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && criticalGapIsHardBlock(gap));
  for (const gap of hardBlocks) blockers.push({ code: "HARD_COMPLIANCE_BLOCKER", message: gap.title, nextAction: "RESOLVE_COMPLIANCE_GAPS" });

  const seniorReviewGaps = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && !criticalGapIsHardBlock(gap));
  if (seniorReviewGaps.length > 0) warnings.push({ code: "SENIOR_REVIEW_GAPS", message: `${seniorReviewGaps.length} critical evidence/review gap(s) need senior bid review.`, nextAction: "OPEN_COMPLIANCE_REVIEW" });

  const expertRequirementExists = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = tender.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = tender.projectMatches.filter((match) => match.isSelected);
  const reviewedSelectedExperts = selectedExperts.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedSelectedProjects = selectedProjects.filter((match) => match.project.trustLevel === "REVIEWED");

  if (expertRequirementExists && tender.expertMatches.length === 0) blockers.push({ code: "NO_EXPERT_MATCHES_FOUND", message: "Tender requires experts but no expert matches exist yet.", nextAction: "RUN_ENGINE" });
  else if (expertRequirementExists && selectedExperts.length === 0) blockers.push({ code: "NO_EXPERT_MATCHES_SELECTED", message: "Tender requires experts but no expert matches are selected.", nextAction: "REVIEW_MATCHES" });
  else if (expertRequirementExists && reviewedSelectedExperts.length === 0) blockers.push({ code: "ALL_EXPERTS_UNREVIEWED", message: "Selected expert matches are unreviewed. Review at least one selected expert before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });

  if (projectRequirementExists && tender.projectMatches.length === 0) blockers.push({ code: "NO_PROJECT_MATCHES_FOUND", message: "Tender requires project references but no project matches exist yet.", nextAction: "RUN_ENGINE" });
  else if (projectRequirementExists && selectedProjects.length === 0) blockers.push({ code: "NO_PROJECT_MATCHES_SELECTED", message: "Tender requires project references but no project matches are selected.", nextAction: "REVIEW_MATCHES" });
  else if (projectRequirementExists && reviewedSelectedProjects.length === 0) blockers.push({ code: "ALL_PROJECTS_UNREVIEWED", message: "Selected project matches are unreviewed. Review at least one selected project before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });

  const ready = blockers.length === 0;

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
