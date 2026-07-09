import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { assessMatchingQuality } from "../lib/matching-quality";
import { ensureCompanyForUser } from "../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { detectAnalysisSourceWithApproval } from "../lib/engine/analysis-source";
import { inferSector } from "../lib/engine/proposal-intelligence";
import { getEffectiveTenderFacts } from "../lib/engine/effective-tender-facts";
import { statusToSeverity, severityBadgeClasses, severityBgClass, severityBorderClass, severityTextClass, scoreToSeverity } from "../lib/ui-tokens";

function analysisSourceSummary(source: Awaited<ReturnType<typeof detectAnalysisSourceWithApproval>>) {
  if (source === "AI") return { label: "AI", risk: "LOW" as const, detail: "Analysis produced by AI provider." };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return { label: "Regex fallback (draft-approved)", risk: "MEDIUM" as const, detail: "Approved for draft review only. Not approved for final export because extraction is weak; final export requires reliable extraction or an explicit admin override." };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Regex fallback", risk: "HIGH" as const, detail: "AI providers failed or were unavailable — regex extraction was used. Review carefully before submission." };
  return { label: "Unknown", risk: "MEDIUM" as const, detail: "Analysis source not yet determined. Run AI Analyze only after extraction is reliable enough for analysis." };
}

function isUntrustedAnalysisStatus(status?: string | null) {
  return status === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" ||
    status === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
    status === "OCR_REQUIRED" ||
    status === "EXTRACTION_WEAK_REVIEW_REQUIRED" ||
    status === "AI_ANALYSIS_PARTIAL" ||
    status === "PARTIAL_EXTRACTION_AI_ANALYZED";
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

  const rawMetrics = await prisma.$queryRaw<Array<{ extractedChars: number; totalPageCount: number }>>`
    SELECT
      COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedChars",
      COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
    FROM "TenderFile"
    WHERE "tenderId" = ${tenderId}
  `.catch(() => [{ extractedChars: 0, totalPageCount: 0 }]);
  const [{ extractedChars, totalPageCount }] = rawMetrics.length > 0 ? rawMetrics : [{ extractedChars: 0, totalPageCount: 0 }];

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });

  const rawSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender).catch(() => "UNKNOWN" as const);

  // ── Effective tender facts — use parser/ledger facts, not raw scalars ──
  // This fixes the contradiction where Tender Detail shows a parsed deadline
  // but Analysis Quality says "deadline missing" because tender.deadline is null.
  // The effective facts combine ledger → parser → scalar fallback.
  const effectiveFacts = await getEffectiveTenderFacts(prisma, tenderId, userId).catch(() => null);

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: effectiveFacts?.evaluationMethodology ?? tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    clientName: effectiveFacts?.clientOrProcuringEntity ?? (tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined),
    referenceNumber: effectiveFacts?.referenceNumber ?? tender.reference,
    country: effectiveFacts?.country ?? tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength: extractedChars,
    totalPageCount,
    // Use effective deadline/method/emails/address from parser/ledger when available
    deadline: effectiveFacts?.deadlineIso ?? effectiveFacts?.deadlineDisplay ?? tender.deadline,
    submissionMethod: effectiveFacts?.submissionMethod && effectiveFacts.submissionMethod !== "Unknown"
      ? effectiveFacts.submissionMethod
      : tender.submissionMethod,
    submissionAddress: effectiveFacts?.submissionAddress ?? tender.submissionAddress,
    submissionEmails: effectiveFacts?.submissionEmails.length
      ? effectiveFacts.submissionEmails.join(", ")
      : tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource: rawSource,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert?.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project?.trustLevel === "REVIEWED").length,
  });

  const analysisSource = analysisSourceSummary(rawSource);
  const sourceIsFallbackOrUnknown = rawSource !== "AI";
  const untrustedStatus = isUntrustedAnalysisStatus(tender.analysisExtractionStatus);
  const fallbackOnly = quality.isRegexFallback || sourceIsFallbackOrUnknown || untrustedStatus;
  const ready = quality.severity !== "POOR" && quality.severity !== "UNSAFE" && analysisSource.risk === "LOW" && !fallbackOnly;
  const sectorProbeText = [tender.analysisSummary, tender.intakeSummary, tender.notes, tender.title, tender.description].filter(Boolean).join("\n\n");
  const detectedSector = sectorProbeText.trim().length > 20 ? inferSector(sectorProbeText) : null;
  const sourceSev = statusToSeverity(fallbackOnly ? (analysisSource.risk === "HIGH" || untrustedStatus ? "HIGH" : "MEDIUM") : "GOOD");
  const sourceRiskClass = `${severityBgClass(sourceSev).replace("-50", "-100")} ${severityTextClass(sourceSev)}`;
  const severityClass: Record<string, string> = {
    GOOD: fallbackOnly ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700",
    WARNING: "bg-amber-100 text-amber-700",
    POOR: "bg-red-100 text-red-700",
    UNSAFE: "bg-red-200 text-red-800",
  };
  const sectionSev = ready ? "good" as const : fallbackOnly ? "warning" as const : "poor" as const;
  const sectionClass = `${severityBorderClass(sectionSev)} ${severityBgClass(sectionSev)}`;
  const headerTone = severityTextClass(sectionSev);

  return (
    <section id="analysis-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${headerTone}`}>Analysis quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Tender analysis appears usable" : "Tender analysis needs review"}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks whether extracted requirements include mandatory criteria, scoring methodology, submission rules, file naming/order, source references, and whether analysis used AI or fallback rules.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-xl font-bold text-slate-900">{quality.score}/100</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass[quality.severity] ?? "bg-slate-100 text-slate-600"}`}>{fallbackOnly && quality.severity === "GOOD" ? "REVIEW" : quality.severity}</span>
          {quality.isRegexFallback && <p className="mt-0.5 text-[10px] text-amber-700 leading-tight">Score capped — regex fallback</p>}
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Requirements</p><p className="text-xl font-bold text-slate-900">{quality.requirementCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Mandatory</p><p className="text-xl font-bold text-slate-900">{quality.mandatoryCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Source refs</p><p className="text-xl font-bold text-slate-900">{quality.sourceReferencedCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Extracted text</p><p className="text-xl font-bold text-slate-900">{extractedChars.toLocaleString()}</p></div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.entries(quality.subScores) as [string, number][]).map(([key, val]) => {
          const label: Record<string, string> = {
            extractionQuality: "Extraction",
            requirementExtraction: "Requirements",
            metadataQuality: "Tender Details",
            submissionPlanQuality: "Submission",
            matchingReadiness: "Matching",
            sourceGrounding: "Grounding",
          };
          const color = severityTextClass(fallbackOnly ? "warning" : scoreToSeverity(val, { good: 70, warn: 40 }));
          return (
            <div key={key} className="rounded-lg bg-white/70 px-2 py-1.5 text-center">
              <p className="text-[10px] text-slate-500">{label[key] ?? key}</p>
              <p className={`text-sm font-bold ${color}`}>{val}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-white/70 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">Analysis source:</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceRiskClass}`}>{analysisSource.label}</span>
          {tender.analysisExtractionStatus && (() => {
            const statusLabels: Record<string, { label: string; cls: string }> = {
              FULL_EXTRACTION_AI_ANALYZED:        { label: "Full extraction", cls: "bg-green-100 text-green-700" },
              PARTIAL_EXTRACTION_AI_ANALYZED:     { label: "Partial extraction", cls: "bg-amber-100 text-amber-700" },
              OCR_REQUIRED:                       { label: "OCR required", cls: "bg-amber-100 text-amber-700" },
              EXTRACTION_WEAK_REVIEW_REQUIRED:    { label: "Weak — review required", cls: "bg-red-100 text-red-700" },
              REGEX_FALLBACK_FROM_WEAK_EXTRACTION:{ label: "Regex fallback (weak)", cls: "bg-red-100 text-red-700" },
              EXTRACTION_CORRUPTED_AI_SKIPPED:    { label: "Extraction corrupted", cls: "bg-red-100 text-red-700" },
              AI_ANALYZED:                        { label: "AI analyzed", cls: "bg-green-100 text-green-700" },
              AI_ANALYSIS_PARTIAL:                { label: "AI (partial)", cls: "bg-amber-100 text-amber-700" },
            };
            const s = statusLabels[tender.analysisExtractionStatus] ?? { label: tender.analysisExtractionStatus, cls: "bg-slate-100 text-slate-600" };
            return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
          })()}
        </div>
        <p className="mt-1 text-slate-600">{analysisSource.detail}</p>
        {analysisSource.risk === "HIGH" && (
          <p className="mt-2 text-red-700">High risk: untrusted extraction can miss exact forms, evaluation scoring, file names, submission instructions, and expert/project requirements. Re-check extraction quality and AI provider health, then re-run Engine.</p>
        )}
        {fallbackOnly && analysisSource.risk !== "HIGH" && (
          <p className="mt-2 text-amber-700">Fallback or partial analysis is for draft review only. Do not treat this as final-export ready until extraction and AI analysis are reliable.</p>
        )}
      </div>

      {detectedSector && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">Detected sector:</p>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{detectedSector}</span>
          </div>
          <p className={`mt-1 text-xs ${fallbackOnly ? "text-amber-700" : "text-slate-500"}`}>
            {fallbackOnly
              ? "Sector inferred from untrusted analysis. Confirm manually before generation."
              : "Inferred from tender summary. If incorrect, update the tender title/description — sector detection influences proposal methodology framing."}
          </p>
        </div>
      )}

      {quality.metadataIssues.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Tender Details issues ({quality.metadataIssues.length})</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
            {quality.metadataIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
