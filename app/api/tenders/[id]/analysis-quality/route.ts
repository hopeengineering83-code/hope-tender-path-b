import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessTenderAnalysisQuality } from "../../../../../lib/analysis-quality";
import { assessMatchingQuality } from "../../../../../lib/matching-quality";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { detectAnalysisSourceWithApproval, type AnalysisSource } from "../../../../../lib/engine/analysis-source";
import { resolveTenderAnalysisState } from "../../../../../lib/engine/analysis-state-resolver";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../../../../../lib/vault-review-provenance";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

function panelError(message: string, status: number, diagnosticId: string, extra: {
  code: string;
  retryable: boolean;
  staleDataPossible: boolean;
  tenderId?: string;
}) {
  return NextResponse.json({
    error: message,
    panel: "analysis-quality",
    endpoint: "/api/tenders/[id]/analysis-quality",
    diagnosticId,
    ...extra,
  }, { status });
}

type AnalysisSourceRisk = "LOW" | "MEDIUM" | "HIGH";

function analysisSourceFromResolved(source: AnalysisSource, notes?: string | null): { label: string; risk: AnalysisSourceRisk; detail: string } {
  const text = notes ?? "";
  const line = text.split(/\n+/).find((item) => item.toLowerCase().startsWith("analysis source:"));
  const detail = line ? line.replace(/^Analysis source:\s*/i, "") : "No persisted analysis-source line was found. Re-run Engine if the tender was analyzed before source tracking was added.";
  if (source === "AI") return { label: "AI", risk: "LOW", detail };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return {
    label: "Regex fallback (approved — audit-only)",
    risk: "HIGH",
    detail: detail + " | Human approval is AUDIT-ONLY and does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP. Re-run AI Analyze with healthy providers to obtain a genuine AI analysis."
  };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Regex fallback", risk: "HIGH", detail };
  return { label: "Unknown", risk: "MEDIUM", detail };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    await prismaReady;
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
          expertMatches: { include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } },
          projectMatches: { include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } },
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

    // PostgreSQL SUM aggregate always returns exactly one row (NULL coalesced
    // to 0 when no TenderFile rows exist). The ?? fallback covers any edge
    // case where the driver returns an empty array. Genuine query failures
    // must propagate to the outer catch — no .catch() here.
    const fileMetricsRows = await prisma.$queryRaw<Array<{ extractedTextLength: number; totalPageCount: number }>>`
      SELECT
        COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedTextLength",
        COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
      FROM "TenderFile"
      WHERE "tenderId" = ${id}
    `;
    const { extractedTextLength, totalPageCount } = fileMetricsRows[0] ?? { extractedTextLength: 0, totalPageCount: 0 };

    const resolvedAnalysisSource = await detectAnalysisSourceWithApproval(prisma, id, tender).catch(() => "UNKNOWN" as const);
    // Canonical state for the WORDING only — this panel must not tell an owner
    // that generation will proceed on an analysis the gate has already refused.
    const analysisStateDetail = await resolveTenderAnalysisState(prisma, id, userId).catch(() => null);

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
      clientName: tender.clientName || tender.procuringEntityName,
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
      selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && canUseVaultRecord(m.expert as ReviewRecordState, "GENERATION")).length,
      selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && canUseVaultRecord(m.project as ReviewRecordState, "GENERATION")).length,
      analysisSource: resolvedAnalysisSource,
      analysisState: analysisStateDetail?.state ?? null,
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
  } catch (error) {
    const diagnosticId = randomUUID();
    logger.error("[analysis-quality]", {
      route: "/api/tenders/[id]/analysis-quality",
      tenderId: id,
      diagnosticId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return panelError("Analysis quality panel failed to load.", 500, diagnosticId, {
      code: "ANALYSIS_QUALITY_RUNTIME_ERROR",
      retryable: true,
      staleDataPossible: false,
      tenderId: id,
    });
  }
}
