import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { inferSector } from "../lib/engine/proposal-intelligence";
import { getEffectiveTenderFacts } from "../lib/engine/effective-tender-facts";
import { getTenderReleaseSnapshot, type SnapshotAnalysisState } from "../lib/engine/tender-release-snapshot";
import { assessCanonicalTenderSourceReadiness } from "../lib/tender/canonical-source-files";

export function resolveCanonicalAnalysisPresentation(analysis: SnapshotAnalysisState | null | undefined) {
  const current = Boolean(
    analysis?.state === "AI_SUCCEEDED"
    && analysis.contentHashMatch
    && analysis.canonicalJobId,
  );
  if (current) {
    return {
      current,
      rawSource: "AI" as const,
      source: { label: "AI", risk: "LOW" as const, detail: "Current promoted AI analysis matches the canonical tender source." },
    };
  }
  if (analysis?.state === "HUMAN_APPROVED_FALLBACK") {
    return {
      current,
      rawSource: "HUMAN_APPROVED_REGEX_FALLBACK" as const,
      source: { label: "Regex fallback", risk: "MEDIUM" as const, detail: "Draft-only fallback; not final-export authority." },
    };
  }
  if (analysis?.state === "REGEX_FALLBACK_UNAPPROVED") {
    return {
      current,
      rawSource: "REGEX_FALLBACK_AI_ERROR" as const,
      source: { label: "Regex fallback", risk: "HIGH" as const, detail: "AI providers failed and regex extraction was used." },
    };
  }
  return {
    current,
    rawSource: "UNKNOWN" as const,
    source: { label: "Not current", risk: "MEDIUM" as const, detail: "Run AI Analyze manually after canonical extraction is ready." },
  };
}

function isUntrustedStatus(status?: string | null) {
  return [
    "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    "EXTRACTION_CORRUPTED_AI_SKIPPED",
    "OCR_REQUIRED",
    "EXTRACTION_WEAK_REVIEW_REQUIRED",
    "AI_ANALYSIS_PARTIAL",
    "PARTIAL_EXTRACTION_AI_ANALYZED",
  ].includes(status ?? "");
}

export async function AnalysisQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const [tender, snapshot] = await Promise.all([
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        files: {
          select: {
            id: true,
            fileName: true,
            originalFileName: true,
            deletionStatus: true,
            contentSha256: true,
            integrityStatus: true,
            extractionScore: true,
            extractionMethod: true,
            totalPages: true,
            extractedPages: true,
            failedPages: true,
            extractedText: true,
            createdAt: true,
          },
        },
      },
    }),
    getTenderReleaseSnapshot(prisma, tenderId, userId).catch(() => null),
  ]);
  if (!tender) return null;

  const sourceReadiness = assessCanonicalTenderSourceReadiness(tender.files);
  const canonicalFiles = sourceReadiness.canonicalFiles;
  const extractedChars = canonicalFiles.reduce((total, file) => total + (file.extractedText?.length ?? 0), 0);
  const totalPageCount = canonicalFiles.reduce((total, file) => total + (file.totalPages ?? 0), 0);

  const effectiveFacts = await getEffectiveTenderFacts(prisma, tenderId, userId).catch(() => null);
  const canonicalAnalysis = resolveCanonicalAnalysisPresentation(snapshot?.analysis);
  const { current: analysisCurrent, rawSource, source } = canonicalAnalysis;

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: effectiveFacts?.evaluationMethodology ?? tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    clientName: effectiveFacts?.clientOrProcuringEntity ?? tender.procuringEntityName ?? tender.clientName,
    referenceNumber: effectiveFacts?.referenceNumber ?? tender.reference,
    country: effectiveFacts?.country ?? tender.country,
    clientContactName: tender.clientContactName,
    extractedTextLength: extractedChars,
    totalPageCount,
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
  });

  const canonicalExtractionReady = sourceReadiness.analysisReady;
  const fallbackOnly = quality.isRegexFallback || !analysisCurrent || isUntrustedStatus(tender.analysisExtractionStatus);
  const ready = analysisCurrent
    && canonicalExtractionReady
    && !fallbackOnly
    && quality.severity !== "POOR"
    && quality.severity !== "UNSAFE";
  const displayedScore = ready ? quality.score : Math.min(quality.score, 69);
  const tone = ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50";
  const badge = ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800";
  const sectorProbe = [tender.analysisSummary, tender.intakeSummary, tender.notes, tender.title, tender.description]
    .filter(Boolean)
    .join("\n\n");
  const detectedSector = sectorProbe.trim().length > 20 ? inferSector(sectorProbe) : null;
  const subScores = Object.entries(quality.subScores)
    .filter(([key]) => key !== "matchingReadiness") as [string, number][];

  return (
    <section id="analysis-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${tone}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-emerald-700" : "text-amber-800"}`}>Analysis quality</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">
        {ready ? "Tender analysis is current and usable" : "Tender analysis is stale, incomplete, or blocked"}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        This score covers canonical extraction, requirements, tender details, submission instructions, and source grounding. Evidence matching remains separate.
      </p>

      {sourceReadiness.duplicateFileCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {sourceReadiness.duplicateFileCount} duplicate or alternate source representation(s) were excluded from this score.
        </p>
      ) : null}

      {!analysisCurrent ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-sm text-amber-900">
          Previous analysis does not match the current canonical source revision. Run AI Analyze again before Run Engine.
          {snapshot?.analysis.blocker ? <p className="mt-1 text-xs text-amber-800">{snapshot.analysis.blocker}</p> : null}
        </div>
      ) : null}

      {!canonicalExtractionReady ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-sm text-amber-900">
          {sourceReadiness.blockers[0] ?? "Canonical source extraction is not ready."}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-slate-500">Analysis score</p>
          <p className="text-xl font-bold text-slate-900">{displayedScore}/100</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge}`}>{ready ? "CURRENT" : "REVIEW"}</span>
        </div>
        <Metric label="Requirements" value={quality.requirementCount} />
        <Metric label="Mandatory" value={quality.mandatoryCount} />
        <Metric label="Source refs" value={quality.sourceReferencedCount} />
        <Metric label="Canonical text" value={extractedChars.toLocaleString()} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {subScores.map(([key, value]) => (
          <div key={key} className="rounded-lg bg-white/80 px-2 py-1.5 text-center">
            <p className="text-[10px] text-slate-500">{({
              extractionQuality: "Extraction",
              requirementExtraction: "Requirements",
              metadataQuality: "Tender Details",
              submissionPlanQuality: "Submission",
              sourceGrounding: "Grounding",
            } as Record<string, string>)[key] ?? key}</p>
            <p className={`text-sm font-bold ${value >= 70 && ready ? "text-emerald-700" : value >= 40 ? "text-amber-800" : "text-red-700"}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-white bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">Analysis source:</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${source.risk === "LOW" && analysisCurrent ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{source.label}</span>
          {detectedSector ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{detectedSector}</span> : null}
        </div>
        <p className="mt-1 text-slate-600">{source.detail}</p>
        <p className="mt-2 text-xs text-slate-500">AI Analyze and Run Engine are manual actions. Automatic processing starts only after Run Engine succeeds.</p>
      </div>

      {quality.metadataIssues.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-800">Tender Details issues ({quality.metadataIssues.length})</p>
            <Link href={`/dashboard/tenders/${tenderId}#tender-edit-form`} className="text-xs font-semibold text-amber-800 underline">Review Tender Details</Link>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
            {quality.metadataIssues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      ) : null}

      {quality.warnings.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-bold text-slate-900">{value}</p></div>;
}
