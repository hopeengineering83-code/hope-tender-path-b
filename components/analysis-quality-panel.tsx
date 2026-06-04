import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { assessMatchingQuality } from "../lib/matching-quality";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { detectAnalysisSourceWithApproval } from "../lib/engine/analysis-source";

function analysisSourceSummary(source: Awaited<ReturnType<typeof detectAnalysisSourceWithApproval>>) {
  if (source === "AI") return { label: "AI", risk: "LOW" as const, detail: "Analysis produced by AI provider." };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return { label: "Regex fallback (approved)", risk: "MEDIUM" as const, detail: "Regex fallback was used, but a human reviewer has approved it as sufficient." };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Regex fallback", risk: "HIGH" as const, detail: "AI providers failed or were unavailable — regex extraction was used. Review carefully before submission." };
  return { label: "Unknown", risk: "MEDIUM" as const, detail: "Analysis source not yet determined. Run AI Analyze to classify the source." };
}

export async function AnalysisQualityPanel({ tenderId }: { tenderId: string }) {
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

  const [{ extractedChars, totalPageCount }] = await prisma.$queryRaw<Array<{ extractedChars: number; totalPageCount: number }>>`
    SELECT
      COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedChars",
      COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
    FROM "TenderFile"
    WHERE "tenderId" = ${tenderId}
  `;

  // Pass vault counts so analysis-quality matching sub-score matches the
  // matching-quality panel — both should show VAULT_AWAITS_ENGINE (−18)
  // not NO_VAULT (−35) when reviewed vault evidence is ready but the
  // engine hasn't been run on this tender yet.
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
    // Gap 4 — metadata + matching state. Now this panel matches the
    // readiness gate instead of disagreeing with it.
    clientName: tender.clientName,
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

  const analysisSource = analysisSourceSummary(rawSource);
  const ready = quality.severity !== "POOR" && quality.severity !== "UNSAFE" && analysisSource.risk !== "HIGH";
  const sourceRiskClass = analysisSource.risk === "LOW" ? "bg-emerald-100 text-emerald-700" : analysisSource.risk === "HIGH" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Analysis quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Tender analysis appears usable" : "Tender analysis needs review"}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks whether extracted requirements include mandatory criteria, scoring methodology, submission rules, file naming/order, source references, and whether analysis used AI or fallback rules.</p>
        </div>
        <Link href={`/api/tenders/${tenderId}/analysis-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Open JSON
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-xl font-bold text-slate-900">{quality.score}/100</p>
          {quality.isRegexFallback && <p className="text-[10px] text-amber-700 leading-tight">Score capped — regex fallback</p>}
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Requirements</p><p className="text-xl font-bold text-slate-900">{quality.requirementCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Mandatory</p><p className="text-xl font-bold text-slate-900">{quality.mandatoryCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Source refs</p><p className="text-xl font-bold text-slate-900">{quality.sourceReferencedCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Extracted text</p><p className="text-xl font-bold text-slate-900">{extractedChars.toLocaleString()}</p></div>
      </div>

      <div className="mt-4 rounded-xl border border-white/70 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">Analysis source:</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceRiskClass}`}>{analysisSource.label}</span>
        </div>
        <p className="mt-1 text-slate-600">{analysisSource.detail}</p>
        {analysisSource.risk === "HIGH" && (
          <p className="mt-2 text-red-700">High risk: regex fallback can miss exact forms, evaluation scoring, file names, submission instructions, and expert/project requirements. Re-check extraction quality and AI provider health, then re-run Engine.</p>
        )}
      </div>

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
