import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { assessMatchingQuality } from "../lib/matching-quality";

function analysisSourceFromNotes(notes?: string | null) {
  const text = notes ?? "";
  const line = text.split(/\n+/).find((item) => item.toLowerCase().startsWith("analysis source:"));
  if (!line) return { label: "Unknown", risk: "MEDIUM", detail: "No persisted analysis-source line was found. Re-run Engine after this update if needed." };
  if (/analysis source:\s*ai/i.test(line)) return { label: "AI", risk: "LOW", detail: line.replace(/^Analysis source:\s*/i, "") };
  if (/regex fallback/i.test(line)) return { label: "Regex fallback", risk: "HIGH", detail: line.replace(/^Analysis source:\s*/i, "") };
  return { label: "Unknown", risk: "MEDIUM", detail: line };
}

export async function AnalysisQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  // Load full tender shape so we can pass metadata + matching state into
  // the analysis-quality assessor. Without these the score climbs to
  // 100/100 even when matching is 0 and clientName is corrupted — the
  // exact production bug from the May 16 screenshot where this panel
  // said "Tender analysis appears usable" while the Bid Control Verdict
  // and Generation Readiness panels both said the analysis was poor.
  // PR #371 fixed the dedicated API route but missed this server-component
  // path which calls assessTenderAnalysisQuality directly.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      files: { select: { extractedText: true, originalFileName: true } },
      expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
      projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
    },
  });
  if (!tender) return null;

  const extractedChars = tender.files.reduce((sum, file) => sum + (file.extractedText?.length ?? 0), 0);

  // Derive matching score first so the analysis-quality score below
  // reflects matching state. The matching call here intentionally omits
  // vault counts — even with vault evidence, analysis quality should
  // recognise that NO tender-specific matches exist yet (matching=0
  // means the engine hasn't produced rows tied to this tender).
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
  });

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
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert?.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project?.trustLevel === "REVIEWED").length,
  });

  const analysisSource = analysisSourceFromNotes(tender.notes);
  const ready = quality.severity !== "POOR" && analysisSource.risk !== "HIGH";
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
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Score</p><p className="text-xl font-bold text-slate-900">{quality.score}/100</p></div>
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
