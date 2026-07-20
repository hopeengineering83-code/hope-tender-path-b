// Tender Health Score Panel — server component.
//
// Shows a 0-100 composite health score derived from:
//   extraction quality · AI analysis quality · metadata completeness ·
//   requirement coverage · submission plan · document readiness · export gates
//
// This is the single "trust this bid package" indicator before export.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { CanonicalStatusBadge, CanonicalStatusIcon } from "./canonical-status-badge";
import { ArrowRightIcon } from "./icons";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import type { CanonicalModuleKey } from "../lib/engine/canonical-readiness-state";
import { clientLogger } from "@/lib/ui/client-logger";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";
import { getCurrentConfirmedBuildPlan } from "../lib/engine/build-plan";
import { PanelErrorFallback } from "./panel-error-fallback";

type Dimension = {
  label: string;
  score: number;
  max: number;
  detail: string;
  status: "PASS" | "WARN" | "FAIL";
  actionLabel?: string;
  actionHref?: string;
};

function scoreBar(score: number, max: number) {
  const pct = max === 0 ? 0 : Math.round((score / max) * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600 w-12 text-right">{score}/{max}</span>
    </div>
  );
}

const DIMENSION_MODULE: Record<string, CanonicalModuleKey> = {
  Extraction: "extraction",
  "AI Analysis": "analysis",
  "Tender Details": "metadata",
  Requirements: "requirements",
  "Submission Plan": "submissionPlan",
  Documents: "documents",
  Compliance: "compliance",
};

export async function TenderHealthScorePanel({ tenderId, canonicalReadiness, analysisStale = false, mandatoryComplianceRowsCount, mandatoryRequirementCount }: { tenderId: string; canonicalReadiness?: CanonicalTenderReadiness | null; analysisStale?: boolean; mandatoryComplianceRowsCount?: number; mandatoryRequirementCount?: number }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      status: true,
      analysisSummary: true,
      analysisExtractionStatus: true,
      metadataContaminated: true,
      readinessScore: true,
      clientName: true,
      procuringEntityName: true,
      country: true,
      clientContactName: true,
      clientContactEmail: true,
      submissionAddress: true,
      submissionEmails: true,
      submissionMethod: true,
      deadline: true,
      currency: true,
      exactFileNaming: true,
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true },
      },
      files: {
        select: {
          extractedText: true,
          originalFileName: true,
          fileName: true,
          extractionScore: true,
          totalPages: true,
          extractedPages: true,
          ocrPages: true,
          failedPages: true,
        },
      },
      requirements: {
        select: {
          id: true,
          priority: true,
          sourceConfidence: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
        },
      },
      complianceGaps: {
        where: { isResolved: false },
        select: { severity: true },
      },
    },
  }).catch(() => null);

  if (!tender) return null;

  const finalPackage = await getFinalPackageReadinessModel(prisma, tenderId, userId);
  const confirmedBuildPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId).catch(() => ({ ok: false as const, blocker: "No confirmed Build Plan exists." }));

  const dimensions: Dimension[] = [];

  // ── 1. Extraction quality (20 pts) ───────────────────────────────────────
  const hasFiles = tender.files.length > 0;
  if (!hasFiles) {
    dimensions.push({ label: "Extraction", score: 0, max: 20, detail: "No tender files uploaded", status: "FAIL", actionLabel: "Upload files", actionHref: `#tender-files` });
  } else {
    const fileScores = tender.files.map((f) => {
      const q = assessExtractionQuality(f.extractedText, f.originalFileName || f.fileName);
      const corrupted = f.extractedText ? isExtractionCorrupted(f.extractedText) : false;
      return { score: Math.min(f.extractionScore ?? q.score, q.score), corrupted };
    });
    const avg = Math.round(fileScores.reduce((s, f) => s + f.score, 0) / fileScores.length);
    const anyCorrupted = fileScores.some((f) => f.corrupted);
    const dimScore = anyCorrupted ? 0 : Math.round((avg / 100) * 20);
    const extStatus: Dimension["status"] = anyCorrupted ? "FAIL" : avg >= 70 ? "PASS" : avg >= 45 ? "WARN" : "FAIL";
    dimensions.push({
      label: "Extraction",
      score: dimScore,
      max: 20,
      detail: anyCorrupted ? "Extraction corrupted" : `Avg score ${avg}/100`,
      status: extStatus,
      ...(extStatus !== "PASS" ? { actionLabel: "Re-extract / Upload clearer scan", actionHref: "#tender-files" } : {}),
    });
  }

  // ── 2. AI Analysis (15 pts) ──────────────────────────────────────────────
  // Per spec: AI Analysis dimension cannot be green when analysis is stale.
  const hasAnalysis = Boolean(tender.analysisSummary);
  const analysisStatus = tender.analysisExtractionStatus ?? "";
  // If analysis is stale, score 0 regardless of extraction status — a stale
  // analysis is NOT trusted and must not show green.
  const analysisScore = analysisStale ? 0
    : !hasAnalysis ? 0
    : analysisStatus === "FULL_EXTRACTION_AI_ANALYZED" ? 15
    : analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED" ? 10
    : analysisStatus.includes("CORRUPTED") ? 0
    : 7;
  const analysisStatusLabel: Dimension["status"] = analysisScore >= 12 ? "PASS" : analysisScore >= 7 ? "WARN" : "FAIL";
  dimensions.push({
    label: "AI Analysis",
    score: analysisScore,
    max: 15,
    detail: analysisStale ? "Stale — re-run required" : !hasAnalysis ? "Not run" : analysisStatus || "Analyzed",
    status: analysisStatusLabel,
    ...(analysisStatusLabel !== "PASS" ? { actionLabel: analysisStale ? "Re-run AI Analyze" : "Run AI Analyze", actionHref: "#ai-analyze-section" } : {}),
  });

  // ── 3. Metadata completeness (15 pts) ────────────────────────────────────
  const meta = assessTenderMetadataCompleteness({
    clientName: (tender.clientName || tender.procuringEntityName) ?? null,
    country: tender.country ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    deadline: tender.deadline ?? null,
    currency: tender.currency ?? null,
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
    requirementCount: tender.requirements.length,
  }, tender.metadataOverrides);
  const metaScore = meta.blockingForExport || tender.metadataContaminated ? 0
    : Math.round(meta.overallRatio * 15);
  const metaStatusLabel: Dimension["status"] = metaScore >= 12 ? "PASS" : metaScore >= 8 ? "WARN" : "FAIL";
  const missingCriticalNames = meta.missingCritical.map((f) => f.field);
  const notApplicableNames = meta.notApplicableFields.map((f) => f.field);
  const metaDetail = missingCriticalNames.length > 0
    ? `Missing: ${missingCriticalNames.slice(0, 3).join(", ")}${missingCriticalNames.length > 3 ? " …" : ""}`
    : tender.metadataContaminated ? "Contaminated client name"
    : notApplicableNames.length > 0 ? `${Math.round(meta.overallRatio * 100)}% filled; ignored/not applicable: ${notApplicableNames.slice(0, 2).join(", ")}${notApplicableNames.length > 2 ? " …" : ""}`
    : `${Math.round(meta.overallRatio * 100)}% filled`;
  dimensions.push({
    label: "Tender Details",
    score: metaScore,
    max: 15,
    detail: metaDetail,
    status: metaStatusLabel,
    ...(metaStatusLabel !== "PASS" ? { actionLabel: "Edit Tender Details", actionHref: "#tender-edit-form" } : {}),
  });

  // ── 4. Requirements (15 pts) ─────────────────────────────────────────────
  const analysisIsTrusted = analysisStatus === "FULL_EXTRACTION_AI_ANALYZED" || analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED";
  const reqScore = !hasAnalysis ? 0
    : !analysisIsTrusted ? 0
    : finalPackage.requirements.total === 0 ? 0
    : finalPackage.requirements.mandatory === 0 ? 10
    : Math.round(finalPackage.requirements.coverageRatio * 15);
  const reqStatusLabel: Dimension["status"] = finalPackage.requirements.blockers.length > 0 ? "FAIL" : reqScore >= 12 ? "PASS" : reqScore >= 7 ? "WARN" : "FAIL";
  const firstReqBlocker = finalPackage.requirements.blockers[0];
  const reqDetail = !hasAnalysis ? "Analysis not run"
    : !analysisIsTrusted ? "Analysis untrusted — re-run AI Analyze"
    : finalPackage.requirements.total === 0 ? "None extracted"
    : firstReqBlocker ? `${finalPackage.requirements.mandatoryTraced}/${finalPackage.requirements.mandatory} mandatory traced — ${firstReqBlocker.title}`
    : `${finalPackage.requirements.mandatoryTraced}/${finalPackage.requirements.mandatory} mandatory/critical trusted traced`;
  dimensions.push({
    label: "Requirements",
    score: reqScore,
    max: 15,
    detail: reqDetail,
    status: reqStatusLabel,
    ...(reqStatusLabel !== "PASS" ? { actionLabel: "Run AI Analyze to extract", actionHref: "#ai-analyze-section" } : {}),
  });

  // ── 5. Submission plan (10 pts) ──────────────────────────────────────────
  // A non-empty `documents.planned` alone is NOT sufficient — that array is
  // populated from a legacy derived-fallback plan whenever no CONFIRMED Build
  // Plan exists (see deriveRequiredPackageDocuments in
  // final-package-readiness-model.ts), which previously made this dimension
  // show 10/10 PASS even while the Workflow Control Center correctly reported
  // "No Build Plan exists" for the same tender. Require an actually-confirmed
  // Build Plan (the same authority the workflow gate and generation gate use)
  // so this score can never disagree with them.
  const plannedDocs = finalPackage.documents.planned;
  const requiredDocs = finalPackage.documents.required;
  const hasPlan = confirmedBuildPlan.ok && plannedDocs.length > 0;
  dimensions.push({
    label: "Submission Plan",
    score: hasPlan ? 10 : 0,
    max: 10,
    detail: hasPlan ? `${requiredDocs.length}/${plannedDocs.length} required/planned package docs` : confirmedBuildPlan.blocker ?? "Not built",
    status: hasPlan ? "PASS" : "FAIL",
    ...(!hasPlan ? { actionLabel: "Build submission plan", actionHref: "#submission-plan-reconciliation" } : {}),
  });

  // ── 6. Document readiness (15 pts) ──────────────────────────────────────
  const activeDocs = finalPackage.documents.generated;
  const exportReadyDocs = finalPackage.documents.exportReady;
  const missingDocs = finalPackage.documents.missingRequired;
  const docBlockers = finalPackage.documents.blockers;
  const docScore = requiredDocs.length === 0 ? 0
    : Math.round((exportReadyDocs.length / Math.max(requiredDocs.length, 1)) * 15);
  const docStatusLabel: Dimension["status"] = missingDocs.length > 0 || docBlockers.length > 0 ? "FAIL" : docScore >= 12 ? "PASS" : docScore >= 7 ? "WARN" : "FAIL";
  const firstDocBlocker = docBlockers[0];
  const docDetail = requiredDocs.length === 0 ? "No package plan documents"
    : firstDocBlocker ? `${exportReadyDocs.length}/${requiredDocs.length} export-ready — ${firstDocBlocker.documentName ?? firstDocBlocker.title}`
    : `${exportReadyDocs.length}/${requiredDocs.length} export-ready`;
  dimensions.push({
    label: "Documents",
    score: docScore,
    max: 15,
    detail: docDetail,
    status: docStatusLabel,
    ...(docStatusLabel !== "PASS" ? { actionLabel: activeDocs.length === 0 || missingDocs.length > 0 ? "Generate documents" : "View documents", actionHref: "#generated-documents" } : {}),
  });

  // ── 7. Compliance gaps (10 pts) ──────────────────────────────────────────
  // Per spec: Compliance dimension cannot be 10/10 when compliance rows = 0.
  // The old code only counted open compliance GAP rows, not compliance MATRIX
  // rows linked to mandatory requirements. A tender with zero gaps but zero
  // matrix rows scored 10/10 PASS — directly contradicting the canonical
  // decision's MANDATORY_NO_COMPLIANCE_ROWS blocker.
  const criticalGaps = tender.complianceGaps.filter((g) => g.severity === "CRITICAL").length;
  const totalGaps = tender.complianceGaps.length;
  // If mandatory requirements exist but compliance matrix rows = 0, this is
  // a hard fail — the MANDATORY_NO_COMPLIANCE_ROWS blocker is active.
  const hasNoComplianceRows = typeof mandatoryComplianceRowsCount === "number"
    && typeof mandatoryRequirementCount === "number"
    && mandatoryRequirementCount > 0
    && mandatoryComplianceRowsCount === 0;
  const gapScore = criticalGaps > 0 || hasNoComplianceRows ? 0 : totalGaps === 0 ? 10 : 5;
  const complianceDetail = hasNoComplianceRows
    ? "No compliance matrix rows — run Engine to create evidence links"
    : criticalGaps > 0 ? `${criticalGaps} critical gap(s)` : totalGaps === 0 ? "No open gaps" : `${totalGaps} non-critical gap(s)`;
  dimensions.push({
    label: "Compliance",
    score: gapScore,
    max: 10,
    detail: complianceDetail,
    status: criticalGaps > 0 || hasNoComplianceRows ? "FAIL" : totalGaps === 0 ? "PASS" : "WARN",
  });

  const totalScore = dimensions.reduce((s, d) => s + d.score, 0);
  const maxScore = dimensions.reduce((s, d) => s + d.max, 0);
  const healthPct = Math.round((totalScore / maxScore) * 100);

  const healthColor = healthPct >= 80 ? "text-emerald-700" : healthPct >= 50 ? "text-amber-700" : "text-red-700";
  const healthBg = healthPct >= 80 ? "border-emerald-200 bg-emerald-50" : healthPct >= 50 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const healthLabel = healthPct >= 80 ? "Strong" : healthPct >= 60 ? "Acceptable" : healthPct >= 40 ? "Needs Work" : "Critical Issues";
  const healthState = canonicalReadiness?.modules.generation.state ?? canonicalReadiness?.modules.export.state ?? "NOT_RUN";
  // When canonical release is blocked, override the health label so the UI
  // never says "Acceptable" while generation/export is blocked.
  const releaseBlocked = healthState === "BLOCKED" || healthState === "STALE" || healthState === "NOT_RUN";
  const displayLabel = releaseBlocked ? "Advisory only — release blocked" : healthLabel;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${healthBg}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tender Health Score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-extrabold ${healthColor}`}>{healthPct}</span>
            <span className="text-lg text-slate-400">/100</span>
            <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${healthColor} bg-white border`}>{displayLabel}</span>
            <CanonicalStatusBadge status={healthState} size="sm" />
          </div>
          <p className="mt-1 text-sm text-slate-600">Composite score across {dimensions.length} quality dimensions. Canonical icon/state comes from the shared readiness payload; numeric score cannot override blockers.</p>
          {/* Additive honest-UI overlay: authoritative release-snapshot
              generation verdict + revision, read-only (a 0–100 score is not a
              boolean verdict, so no mismatch warning is asserted here). */}
          <SnapshotConsistencyBadge tenderId={tenderId} verdict="generation" />
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Raw points</p>
          <p className="text-xl font-bold text-slate-900">{totalScore}<span className="text-sm text-slate-400">/{maxScore}</span></p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dimensions.map((d) => (
          <div key={d.label} className={`rounded-xl border bg-white/80 p-3 ${d.status === "FAIL" ? "border-red-200" : d.status === "WARN" ? "border-amber-200" : "border-slate-200"}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-slate-700">{canonicalReadiness?.modules[DIMENSION_MODULE[d.label]] ? <CanonicalStatusIcon status={canonicalReadiness.modules[DIMENSION_MODULE[d.label]].state} /> : null} {d.label}</p>
            </div>
            {scoreBar(d.score, d.max)}
            <p className="mt-1 text-[10px] text-slate-500 truncate" title={d.detail}>{d.detail}</p>
            {d.actionLabel && d.actionHref && (
              <a href={d.actionHref} className={`mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium underline ${d.status === "FAIL" ? "text-red-600 hover:text-red-800" : "text-amber-600 hover:text-amber-800"}`}>
                {d.actionLabel} <ArrowRightIcon />
              </a>
            )}
          </div>
        ))}
      </div>

      {dimensions.some((d) => d.status === "FAIL") && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          <strong>Failing dimensions block export.</strong> Use the links above to address each FAIL item before attempting final export.
        </div>
      )}
    </section>
  );
  } catch (err) {
    clientLogger.error("[TenderHealthScorePanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="Tenderhealthscorepanel" />
  }
}
