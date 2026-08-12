// Bid Strategy API endpoint (PR #249) — beyond-spec feature.
//
// GET /api/tenders/[id]/bid-strategy
//
// Returns the deterministic Bid Strategy assessment for the tender:
//   • winProbability (0–100)
//   • recommendation (BID_HARD / BID_CAREFULLY / DECLINE)
//   • bidPosture (SOLO / JV_RECOMMENDED / SUBCONTRACT_REQUIRED / DECLINE)
//   • topRisks, topAdvantages, dimensionScores, rationale
//
// No AI calls. No external services. <100ms typical response time —
// runs on every load of the tender workspace as a "should we even
// be in this race" indicator before the bid team commits effort.

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { computeBidStrategy } from "../../../../../lib/engine/bid-strategy";
import { countTraceable } from "../../../../../lib/engine/requirement-source-traceability";
import { computeWinProbability } from "../../../../../lib/engine/win-probability";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import {
  VAULT_REVIEW_CONSUMER_SELECT,
  canUseVaultRecord,
} from "../../../../../lib/vault-review-provenance";
import { loadDurableCompanySupportRecords } from "../../../../../lib/prisma-schema-compatibility";
import { manualGateGuidance } from "../../../../../lib/ui/manual-gate-guidance";

// Confidence ceiling applied to bid-strategy win probability when the tender
// analysis came from regex/deterministic fallback. The strategy is computed
// from requirements/matches the fallback extractor may have gotten wrong, so
// the headline number must not read as a confident recommendation.
const FALLBACK_CONFIDENCE_CEILING = 50;
const ZERO_EVIDENCE_CONFIDENCE_CEILING = 45;

function isFallbackLikeAnalysisSource(value: string | null | undefined): boolean {
  const upper = String(value ?? "").toUpperCase();
  return upper.includes("REGEX") || upper.includes("DETERMINISTIC") || upper === "UNKNOWN";
}

function isUnapprovedFallbackOrUnknown(value: string | null | undefined): boolean {
  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only and MUST
  // NEVER authorize bid strategy (or any release action). Treat it the same
  // as unapproved regex fallback — only genuine "AI" authorizes release.
  const upper = String(value ?? "").toUpperCase();
  return upper === "UNKNOWN" || upper.includes("REGEX_FALLBACK") || upper.includes("DETERMINISTIC_FALLBACK");
}

function extractedPageTotal(files: Array<{ totalPages: number | null }>): number {
  return files.reduce((sum, file) => sum + (file.totalPages ?? 0), 0);
}

function hasExtractionUnsafeStatus(status: string | null | undefined, analysisExtractionStatus: string | null | undefined): boolean {
  const combined = `${status ?? ""} ${analysisExtractionStatus ?? ""}`.toUpperCase();
  return /EXTRACTION_CORRUPTED|OCR_REQUIRED|EXTRACTION_WEAK_REVIEW_REQUIRED|REGEX_FALLBACK_FROM_WEAK_EXTRACTION/.test(combined);
}

function computeMandatoryEvidenceCoverage(requirements: Array<{
  priority: string;
  complianceMatrixRows?: Array<{ supportLevel: string | null }> | null;
}>): { releaseRatio: number; progressRatio: number; partial: number } {
  const mandatory = requirements.filter((r) => String(r.priority ?? "").toUpperCase() === "MANDATORY");
  if (mandatory.length === 0) return { releaseRatio: 0, progressRatio: 0, partial: 0 };
  const covered = mandatory.filter((r) =>
    (r.complianceMatrixRows ?? []).some((row) => {
      const level = String(row.supportLevel ?? "").toUpperCase();
      return level === "FULL" || level === "SUBSTANTIAL";
    }),
  ).length;
  const partial = mandatory.filter((r) =>
    (r.complianceMatrixRows ?? []).some((row) => String(row.supportLevel ?? "").toUpperCase() === "PARTIAL")
      && !(r.complianceMatrixRows ?? []).some((row) => ["FULL", "SUBSTANTIAL"].includes(String(row.supportLevel ?? "").toUpperCase())),
  ).length;
  return { releaseRatio: covered / mandatory.length, progressRatio: (covered + partial * 0.5) / mandatory.length, partial };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  const canRead = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role);
  if (!canRead) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  const [tender, company, pastTenders] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: {
          select: {
            title: true,
            description: true,
            requirementType: true,
            priority: true,
            requiredQuantity: true,
            exactFileName: true,
            sourceConfidence: true,
            sourceTenderFileId: true,
            sourcePageNumber: true,
            sourceExactQuote: true,
            sectionReference: true,
            complianceMatrixRows: { select: { supportLevel: true } },
          },
        },
        files: {
          select: { id: true, totalPages: true, extractionScore: true, extractedPages: true, failedPages: true, ocrPages: true },
        },
        complianceGaps: { select: { severity: true, isResolved: true, title: true } },
        expertMatches: {
          where: { isSelected: true },
          select: {
            score: true,
            isSelected: true,
            expert: { select: { fullName: true, trustLevel: true, disciplines: true, sectors: true, yearsExperience: true } },
          },
        },
        projectMatches: {
          where: { isSelected: true },
          select: {
            score: true,
            isSelected: true,
            project: { select: { name: true, trustLevel: true, sector: true, serviceAreas: true, contractValue: true } },
          },
        },
      },
    }),
    prisma.company.findUnique({
      where: { userId: actor.id },
      select: {
        id: true,
        name: true,
        sectors: true,
        serviceLines: true,
        licenseGrade: true,
        country: true,
        headcount: true,
      },
    }),
    // Historical bid outcomes — all past tenders with a resolved outcome
    prisma.tender.findMany({
      where: { userId: actor.id, bidOutcome: { in: ["WON", "LOST"] } },
      select: { bidOutcome: true, category: true },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const [expertRecords, projectRecords, supportRecords] = await Promise.all([
    prisma.expert.findMany({
      where: { companyId: company.id, deletedAt: null, isActive: true },
      select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT,
    }),
    prisma.project.findMany({
      where: { companyId: company.id, deletedAt: null },
      select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT,
    }),
    loadDurableCompanySupportRecords(prisma, company.id),
  ]);
  const companyEvidenceCounts = {
    experts: expertRecords.filter((record) => canUseVaultRecord(record, "GENERATION")).length,
    projects: projectRecords.filter((record) => canUseVaultRecord(record, "GENERATION")).length,
    legalRecords: supportRecords.legalRecords.length,
    financialRecords: supportRecords.financialRecords.length,
  };

  const historicalTotal = pastTenders.length;
  const historicalWins = pastTenders.filter((t) => t.bidOutcome === "WON").length;
  // Use the same durable, hash-bound authority shown by Analysis Quality and
  // enforced by release gates. Legacy notes can describe an old AI run but
  // cannot prove that the promoted result belongs to the current source set.
  const releaseSnapshot = await getTenderReleaseSnapshot(prisma, id, actor.id).catch(() => null);
  const analysisSource = releaseSnapshot?.analysis.state === "AI_SUCCEEDED"
    && releaseSnapshot.analysis.contentHashMatch
    && releaseSnapshot.analysis.canonicalJobId
    ? "AI" as const
    : "UNKNOWN" as const;

  // ── Bid Strategy extraction gate ─────────────────────────────────────────
  // Block bid strategy when extraction or analysis is unreliable. Bid strategy
  // is computed from requirements that may be wrong if the tender file was not
  // properly extracted, so we must not present a confident recommendation in
  // that case. Return 200 (not 4xx) so the UI can render a graceful message.
  const extractionStatus = (tender as { analysisExtractionStatus?: string | null }).analysisExtractionStatus;
  const extractionBlocked =
    !isExtractionAcceptableForGeneration(tender.files) ||
    extractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
    extractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
  if (extractionBlocked) {
    // Gap A: the guidance is chosen by the first unmet condition, and every
    // string it can emit respects both manual gates. Extraction is genuinely
    // automatic; AI Analyze and Run Engine are not, and no response here may
    // imply an upload starts either of them.
    const guidance = manualGateGuidance({ extractionReliable: false, analysisCurrent: false });
    return NextResponse.json({
      strategy: null,
      blocked: true,
      reason: "BID_STRATEGY_UNAVAILABLE_EXTRACTION_WEAK",
      nextAction: guidance.nextAction,
      message: `Bid strategy unavailable — extraction is unreliable, so extracted requirements cannot be trusted. ${guidance.message}`,
    }, { status: 200 });
  }

  const evidenceCoverage = computeMandatoryEvidenceCoverage(tender.requirements);
  const evidenceCoverageRatio = evidenceCoverage.releaseRatio;
  const totalPages = extractedPageTotal(tender.files);
  const mandatoryCount = tender.requirements.filter((req) => String(req.priority ?? "").toUpperCase() === "MANDATORY").length;
  // Canonical predicate. This previously counted only requirements whose
  // AI-supplied `sourceConfidence` was > 0, which is not a source anchor at all:
  // mapToDraft stores `sourceTenderFileId ? (req.sourceConfidence ?? 0) : 0`, so
  // a requirement with a real active file, a proven page and a verbatim quote
  // still scores 0 whenever the model omitted the field. That made this route
  // report "Extracted requirements have no source traceability" on the very same
  // tender where the workflow panel showed 4/4 mandatory requirements traced and
  // the analysis panel showed Grounding 100.
  const sourceRefCount = countTraceable(tender.requirements);
  const requiredDocsKnown = Boolean(
    (tender.exactFileNaming ?? "").trim() ||
      (tender.exactFileOrder ?? "").trim() ||
      tender.requirements.some((req) => Boolean(req.exactFileName)),
  );
  const unsafeBlockers: string[] = [];
  if (hasExtractionUnsafeStatus(tender.status, tender.analysisExtractionStatus)) {
    unsafeBlockers.push("Extraction is corrupted, OCR-required, or weak; bid strategy is unavailable until extraction is readable.");
  }
  if (isUnapprovedFallbackOrUnknown(analysisSource)) {
    unsafeBlockers.push("AI Analyze is missing, unapproved regex/deterministic fallback, or unknown; re-run AI Analyze before using bid strategy.");
  }
  if (tender.requirements.length === 0) unsafeBlockers.push("No tender requirements have been extracted yet.");
  if (totalPages > 5 && tender.requirements.length < 3) {
    unsafeBlockers.push("Large/multi-page tender has fewer than 3 extracted requirements; analysis is likely incomplete.");
  }
  if (totalPages > 5 && mandatoryCount === 0) {
    unsafeBlockers.push("Large/multi-page tender has zero mandatory requirements extracted.");
  }
  if (tender.requirements.length > 0 && sourceRefCount === 0) unsafeBlockers.push("Extracted requirements have no source traceability.");
  // Metadata gaps are warnings, not blockers, for bid strategy.
  // The core tender task is requirement extraction and draft-proposal readiness.
  // Final submission gates (Tool A) enforce strict metadata completeness.
  const metadataWarnings: string[] = [];
  if (totalPages > 5 && !tender.deadline) metadataWarnings.push("Deadline is missing from extracted/manual metadata.");
  if (totalPages > 5 && !tender.submissionMethod) metadataWarnings.push("Submission method is missing from extracted/manual metadata.");
  if (totalPages > 5 && !tender.evaluationMethodology) metadataWarnings.push("Evaluation criteria/methodology are missing from analysis.");
  if (totalPages > 5 && !requiredDocsKnown) unsafeBlockers.push("Required documents/forms are not known from explicit or derived plan inputs.");

  if (unsafeBlockers.length > 0) {
    // Same guidance source as the blocked branch above. `error` is the string
    // the panel renders when the response is not ok, so it carries the
    // truthful next step rather than leaving the client to invent one.
    const guidance = manualGateGuidance({
      extractionReliable: !hasExtractionUnsafeStatus(tender.status, tender.analysisExtractionStatus),
      analysisCurrent: !isUnapprovedFallbackOrUnknown(analysisSource),
      engineRunForCurrentRevision: false,
    });
    return NextResponse.json(
      {
        unavailable: true,
        error: `Bid strategy unavailable — extraction or analysis is not reliable enough to score. ${guidance.message}`,
        code: "BID_STRATEGY_UNAVAILABLE_ANALYSIS_UNRELIABLE",
        nextAction: guidance.nextAction,
        blockers: unsafeBlockers,
        analysisSource,
        extractionStatus: tender.analysisExtractionStatus ?? null,
        requirementCount: tender.requirements.length,
        mandatoryCount,
        sourceRefCount,
      },
      { status: 422 },
    );
  }

  const strategy = computeBidStrategy({
    tender: {
      id: tender.id,
      title: tender.title,
      category: tender.category,
      requirements: tender.requirements,
      complianceGaps: tender.complianceGaps,
      expertMatches: tender.expertMatches,
      projectMatches: tender.projectMatches,
      evaluationMethodology: tender.evaluationMethodology,
      submissionMethod: tender.submissionMethod,
      analysisSource,
      evidenceCoverageRatio,
      evidenceProgressRatio: evidenceCoverage.progressRatio,
    },
    company: {
      name: company.name,
      sectors: company.sectors,
      serviceLines: company.serviceLines,
      licenseGrade: company.licenseGrade,
      country: company.country,
      headcount: company.headcount,
      expertCount: companyEvidenceCounts.experts,
      projectCount: companyEvidenceCounts.projects,
      legalRecordCount: companyEvidenceCounts.legalRecords,
      financialRecordCount: companyEvidenceCounts.financialRecords,
      historicalWins,
      historicalTotal,
    },
  });

  // Keep bid strategy consistent with source/evidence truth at the endpoint too.
  // This protects older callers/tests if the pure strategy engine is invoked
  // without the new context fields.
  const fallbackSource = isFallbackLikeAnalysisSource(analysisSource);
  const zeroEvidence = evidenceCoverageRatio === 0;
  const evidenceLimited = evidenceCoverageRatio < 0.8;
  const confidenceCeiling = fallbackSource
    ? Math.min(FALLBACK_CONFIDENCE_CEILING, zeroEvidence ? ZERO_EVIDENCE_CONFIDENCE_CEILING : FALLBACK_CONFIDENCE_CEILING)
    : zeroEvidence
      ? ZERO_EVIDENCE_CONFIDENCE_CEILING
      : null;

  let confidenceCapped = evidenceLimited;
  if (confidenceCeiling !== null && strategy.winProbability > confidenceCeiling) {
    strategy.winProbability = confidenceCeiling;
    confidenceCapped = true;
    if (strategy.recommendation === "BID_HARD") strategy.recommendation = "BID_CAREFULLY";
  }

  const confidenceNotes: string[] = [];
  if (fallbackSource) {
    confidenceNotes.push("Bid strategy confidence is capped because the tender analysis used regex/deterministic fallback or an unknown source. Re-run AI Analyze for full-confidence strategy.");
  }
  if (zeroEvidence) {
    confidenceNotes.push("Bid strategy confidence is capped because mandatory evidence coverage is 0%. Add or strengthen eligible source-backed evidence before relying on the win probability.");
  } else if (evidenceLimited) {
    confidenceNotes.push(`Evidence confidence is limited: ${Math.round(evidenceCoverageRatio * 100)}% of mandatory requirements are release-qualified; ${evidenceCoverage.partial} have partial evidence. Competitive fit may still be strong, but strengthen eligible source-backed evidence before committing.`);
  }
  const confidenceNote = confidenceNotes.length > 0 ? confidenceNotes.join(" ") : null;

  // Win-probability 4-axis breakdown (evidence match / team strength /
  // compliance posture / historical outcomes) — surfaced in the panel as
  // actionable per-axis scores with explanatory notes.
  const winProbability = computeWinProbability({
    primarySector: tender.category ?? "General",
    tenderBudget: (tender as { budget?: number | null }).budget ?? null,
    tenderCategory: tender.category ?? null,
    analysisSource,
    projects: tender.projectMatches.map((m) => ({
      sectors: m.project.sector ? JSON.stringify([m.project.sector]) : null,
      contractValue: m.project.contractValue ?? null,
    })),
    experts: tender.expertMatches.map((m) => ({
      disciplines: (m.expert as { disciplines?: string | null }).disciplines,
      sectors: (m.expert as { sectors?: string | null }).sectors,
      yearsExperience: (m.expert as { yearsExperience?: number | null }).yearsExperience,
    })),
    complianceGaps: tender.complianceGaps.filter((g) => !g.isResolved),
    bidOutcomes: pastTenders.map((t) => ({ won: t.bidOutcome === "WON", primarySector: t.category ?? null })),
  });

  return NextResponse.json({
    strategy,
    winProbabilityBreakdown: winProbability,
    historicalBidStats: { total: historicalTotal, wins: historicalWins },
    analysisSource,
    evidenceCoverageRatio,
    confidenceCapped,
    confidenceNote,
  });
}
