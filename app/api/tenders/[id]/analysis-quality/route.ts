import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessTenderAnalysisQuality } from "../../../../../lib/analysis-quality";
import { assessMatchingQuality } from "../../../../../lib/matching-quality";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { detectAnalysisSourceWithApproval, type AnalysisSource } from "../../../../../lib/engine/analysis-source";

export const dynamic = "force-dynamic";

type AnalysisSourceRisk = "LOW" | "MEDIUM" | "HIGH";

function analysisSourceFromResolved(source: AnalysisSource, notes?: string | null): { label: string; risk: AnalysisSourceRisk; detail: string } {
  const text = notes ?? "";
  const line = text.split(/\n+/).find((item) => item.toLowerCase().startsWith("analysis source:"));
  const detail = line ? line.replace(/^Analysis source:\s*/i, "") : "No persisted analysis-source line was found. Re-run Engine if the tender was analyzed before source tracking was added.";
  if (source === "AI") return { label: "AI", risk: "LOW", detail };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return { label: "Regex fallback (approved)", risk: "MEDIUM", detail };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Regex fallback", risk: "HIGH", detail };
  return { label: "Unknown", risk: "MEDIUM", detail };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  // Load full tender shape so we can pass metadata + matching state into
  // the analysis-quality assessor. Without these the score climbs to
  // 100/100 even when matching is 0 and clientName is corrupted — the
  // exact production bug from the May 16 screenshot where this panel
  // said "Tender analysis appears usable" while the Bid Control Verdict
  // and Generation Readiness panels both said the analysis was poor.
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id, userId },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Pass vault counts so matching-readiness sub-score correctly shows
  // VAULT_AWAITS_ENGINE state (−18 per type) rather than NO_VAULT
  // state (−35 per type) when reviewed evidence exists but engine
  // hasn't been run on this tender yet.
  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const [{ extractedTextLength, totalPageCount }] = await prisma.$queryRaw<Array<{ extractedTextLength: number; totalPageCount: number }>>`
    SELECT
      COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedTextLength",
      COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
    FROM "TenderFile"
    WHERE "tenderId" = ${id}
  `;

  const resolvedAnalysisSource = await detectAnalysisSourceWithApproval(prisma, id, tender).catch(() => "UNKNOWN" as const);

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    // Gap 4 — metadata + matching state. These params already exist on the
    // function (added in PR #368); the dedicated route just wasn't passing
    // them, so this panel rendered the legacy "requirements-only" score
    // and disagreed with every other panel that consumes the readiness gate.
    clientName: tender.clientName,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength,
    totalPageCount,
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project.trustLevel === "REVIEWED").length,
    analysisSource: resolvedAnalysisSource,
  });

  const analysisSource = analysisSourceFromResolved(resolvedAnalysisSource, tender.notes);
  const sourceWarnings = analysisSource.risk === "HIGH"
    ? ["Analysis used regex fallback because AI providers failed or were exhausted. Regex fallback can miss official forms, evaluation scoring, exact file names, submission instructions, and expert/project requirements."]
    : [];
  const sourceRecommendations = analysisSource.risk === "HIGH"
    ? ["Fix AI provider health or wait for rate limits to reset, then re-run Engine before relying on this tender analysis for final submission."]
    : [];

  return NextResponse.json({
    tenderId: id,
    readyForMatching: quality.severity !== "POOR" && quality.severity !== "UNSAFE" && analysisSource.risk !== "HIGH",
    analysisSource,
    quality: {
      ...quality,
      warnings: [...sourceWarnings, ...quality.warnings],
      recommendations: [...sourceRecommendations, ...quality.recommendations],
    },
  });
}
