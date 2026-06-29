import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { assessMatchingQuality } from "../lib/matching-quality";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { detectAnalysisSourceWithApproval } from "../lib/engine/analysis-source";
import { statusToSeverity, severityBgClass, severityBorderClass, severityTextClass } from "../lib/ui-tokens";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { CanonicalStatusIcon } from "./canonical-status-badge";

type AnalysisQualityPanelProps = {
  tenderId: string;
  snapshot?: TenderReleaseSnapshot | null;
};

export async function AnalysisQualityPanel({ tenderId, snapshot }: AnalysisQualityPanelProps) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);
  if (!tender) return null;

  const rawMetrics = await prisma.$queryRaw<Array<{ extractedChars: number; totalPageCount: number }>>`
    SELECT
      COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedChars",
      COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
    FROM "TenderFile"
    WHERE "tenderId" = ${tenderId}
  `.catch(() => [{ extractedChars: 0, totalPageCount: 0 }]);

  const metrics = (Array.isArray(rawMetrics) && rawMetrics.length > 0)
    ? rawMetrics[0]
    : { extractedChars: 0, totalPageCount: 0 };

  const extractedChars = Number(metrics.extractedChars || 0);
  const totalPageCount = Number(metrics.totalPageCount || 0);

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });

  const rawSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender).catch(() => "UNKNOWN" as const);

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    clientName: tender.clientName || (tender as any).procuringEntityName as string | null | undefined,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength: extractedChars,
    totalPageCount,
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource: rawSource,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert?.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project?.trustLevel === "REVIEWED").length,
  });

  const ready = snapshot ? snapshot.analysis.eligibleForExport : (quality.severity !== "POOR" && quality.severity !== "UNSAFE" && rawSource === "AI");
  const sectionSev = ready ? "good" as const : "poor" as const;
  const sectionClass = `${severityBorderClass(sectionSev)} ${severityBgClass(sectionSev)}`;
  const headerTone = severityTextClass(sectionSev);

  const severityClass: Record<string, string> = {
    GOOD: "bg-emerald-100 text-emerald-700",
    WARNING: "bg-amber-100 text-amber-700",
    POOR: "bg-red-100 text-red-700",
    UNSAFE: "bg-red-200 text-red-800",
  };

  return (
    <section id="analysis-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${headerTone}`}>
             {snapshot && <CanonicalStatusIcon status={snapshot.analysis.state as any} />} Analysis quality
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Tender analysis appears usable" : "Tender analysis needs review"}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks whether extracted requirements include mandatory criteria, scoring methodology, submission rules, file naming/order, source references, and whether analysis used AI or fallback rules.</p>
        </div>
        <div className="flex gap-2">
           <Link href={`/dashboard/tenders/${tenderId}/recovery`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Recovery
          </Link>
          <Link href={`/api/tenders/${tenderId}/analysis-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open JSON
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-xl font-bold text-slate-900">{quality.score}/100</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass[quality.severity as string] ?? "bg-slate-100 text-slate-600"}`}>{quality.severity}</span>
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Requirements</p><p className="text-xl font-bold text-slate-900">{quality.requirementCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Mandatory</p><p className="text-xl font-bold text-slate-900">{quality.mandatoryCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Source refs</p><p className="text-xl font-bold text-slate-900">{quality.sourceReferencedCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Extracted text</p><p className="text-xl font-bold text-slate-900">{extractedChars.toLocaleString()}</p></div>
      </div>

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning: string) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {snapshot?.analysis.blocker && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Export blocker:</strong> {snapshot.analysis.blocker}
        </div>
      )}
    </section>
  );
}
