import Link from "next/link";
import { findExtraGeneratedDocuments, findMissingGeneratedDocuments, submissionPlanFileCount, type SubmissionPlan, type SubmissionPlanFile } from "@/lib/engine/submission-plan";
import { computeEvidenceCoverage } from "@/lib/engine/requirement-evidence-profile";
import { CanonicalStatusBadge } from "@/components/canonical-status-badge";
import { SnapshotConsistencyBadge } from "@/components/snapshot-consistency-badge";
import type { CanonicalTenderReadiness } from "@/lib/canonical-tender-readiness";
import { CANONICAL_STATUS_CONFIG, type CanonicalModuleStatus } from "@/lib/engine/canonical-readiness-state";
import { ArrowRightIcon, ShareIcon } from "@/components/icons";

type GeneratedDocLike = {
  id?: string;
  name?: string | null;
  exactFileName?: string | null;
  documentType?: string | null;
  exactOrder?: number | null;
  format?: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent?: string | null;
};

type TenderRequirementLike = {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  requirementType: string;
  exactFileName?: string | null;
  exactOrder?: number | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

type TenderLike = {
  id: string;
  title?: string | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  pageLimit?: number | null;
  bidOutcome?: string | null;
  analysisSource?: string | null;
  notes?: string | null;
  analysisExtractionStatus?: string | null;
  requirements?: TenderRequirementLike[];
  complianceGaps?: Array<{ severity: string; isResolved: boolean }>;
  generatedDocuments?: GeneratedDocLike[];
  expertMatches?: Array<{ isSelected: boolean; score: number; expert?: { trustLevel?: string | null } }>;
  projectMatches?: Array<{ isSelected: boolean; score: number; project?: { trustLevel?: string | null } }>;
  complianceMatrix?: Array<{ id: string; requirementId?: string | null; supportLevel: string }>;
  files?: Array<{ extractedTextLength?: number | null }>;
};

type SnapshotAction = {
  key: string;
  text: string | null;
};

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function badgeClass(level: "GO" | "REVIEW" | "NO_GO") {
  if (level === "GO") return "border-green-200 bg-green-100 text-green-700";
  if (level === "REVIEW") return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-red-200 bg-red-100 text-red-700";
}

function statusValue(value?: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

function docKey(doc: GeneratedDocLike): string {
  return (doc.exactFileName || doc.name || doc.documentType || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function docScore(doc: GeneratedDocLike): number {
  return (statusValue(doc.generationStatus) === "GENERATED" ? 4 : 0)
    + (["PASSED", "VALIDATED", "APPROVED"].includes(statusValue(doc.validationStatus)) ? 2 : 0)
    + (["APPROVED", "ACCEPTED", "SIGNED_OFF", "SIGNED OFF"].includes(statusValue(doc.reviewStatus)) ? 1 : 0);
}

function visiblePackageDocs(docs: GeneratedDocLike[]): GeneratedDocLike[] {
  const byKey = new Map<string, GeneratedDocLike>();
  for (const doc of docs) {
    const key = docKey(doc);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || docScore(doc) >= docScore(current)) byKey.set(key, doc);
  }
  return Array.from(byKey.values());
}

function bidOutcomeBadgeClass(outcome: string): string {
  if (outcome === "WON") return "border-green-200 bg-green-100 text-green-700";
  if (outcome === "LOST") return "border-red-200 bg-red-100 text-red-700";
  if (outcome === "WITHDRAWN") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-100 text-amber-800";
}

export function dedupeSnapshotActions(actions: SnapshotAction[]): string[] {
  const unique = new Map<string, string>();
  for (const action of actions) {
    if (!action.text || unique.has(action.key)) continue;
    unique.set(action.key, action.text);
  }
  return Array.from(unique.values());
}

function canonicalBlockerCount(readiness?: CanonicalTenderReadiness | null): number {
  if (!readiness) return 0;
  const blockers = readiness.modules.export.blockers.length > 0
    ? readiness.modules.export.blockers
    : readiness.blockers;
  return new Set(blockers).size;
}

export function ExecutiveSnapshot({ tender, canonicalReadiness, confirmedPlanItems }: { tender: TenderLike; canonicalReadiness?: CanonicalTenderReadiness | null; confirmedPlanItems?: SubmissionPlanFile[] | null }) {
  const requirements = tender.requirements ?? [];
  const gaps = tender.complianceGaps ?? [];
  const generatedDocs = visiblePackageDocs(tender.generatedDocuments ?? []);

  // Authoritative planned-document counts come only from the current confirmed
  // Build Plan. A derived draft must never be shown as release authority.
  const submissionPlan = { files: confirmedPlanItems ?? [], warnings: [] as string[] } as SubmissionPlan;
  const missingPlannedDocs = findMissingGeneratedDocuments(submissionPlan, generatedDocs);
  const extraGeneratedDocs = findExtraGeneratedDocuments(submissionPlan, generatedDocs);
  const plannedDocCount = submissionPlanFileCount(submissionPlan);
  const dashboardDocTotal = plannedDocCount > 0 ? plannedDocCount : generatedDocs.length;
  const dashboardGeneratedCount = plannedDocCount > 0
    ? Math.max(0, plannedDocCount - missingPlannedDocs.length)
    : generatedDocs.filter((doc) => statusValue(doc.generationStatus) === "GENERATED").length;

  const expertMatches = tender.expertMatches ?? [];
  const projectMatches = tender.projectMatches ?? [];
  const matrix = tender.complianceMatrix ?? [];
  const files = tender.files ?? [];
  const exportState: CanonicalModuleStatus = canonicalReadiness?.modules.export.state ?? "NOT_RUN";
  const exportStatusConfig = CANONICAL_STATUS_CONFIG[exportState];
  const blockerCount = canonicalBlockerCount(canonicalReadiness);

  const unresolvedCritical = gaps.filter((gap) => !gap.isResolved && gap.severity === "CRITICAL").length;
  const unresolvedHigh = gaps.filter((gap) => !gap.isResolved && gap.severity === "HIGH").length;
  const selectedExperts = expertMatches.filter((match) => match.isSelected);
  const selectedProjects = projectMatches.filter((match) => match.isSelected);
  const reviewedExperts = selectedExperts.filter((match) => match.expert?.trustLevel === "REVIEWED").length;
  const reviewedProjects = selectedProjects.filter((match) => match.project?.trustLevel === "REVIEWED").length;
  const strongExperts = selectedExperts.filter((match) => match.score >= 0.9).length;
  const strongProjects = selectedProjects.filter((match) => match.score >= 0.9).length;
  const generatedCount = generatedDocs.filter((doc) => statusValue(doc.generationStatus) === "GENERATED").length;
  const validatedCount = generatedDocs.filter((doc) => ["PASSED", "VALIDATED", "APPROVED"].includes(statusValue(doc.validationStatus))).length;
  const approvedCount = generatedDocs.filter((doc) => ["APPROVED", "ACCEPTED", "SIGNED_OFF", "SIGNED OFF"].includes(statusValue(doc.reviewStatus))).length;
  const extractedFiles = files.filter((file) => (file.extractedTextLength ?? 0) > 80).length;

  // The lenient evidence score remains explanatory only. Canonical release
  // readiness, not this percentage, controls the decision badge.
  const supportedEvidence = matrix.filter((row) => ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(row.supportLevel)).length;
  const evidenceScoreLegacy = pct(supportedEvidence, matrix.length);

  const matrixByRequirement = new Map<string, Array<{ id: string; supportLevel?: string | null }>>();
  for (const row of matrix) {
    if (!row.requirementId) continue;
    const rows = matrixByRequirement.get(row.requirementId) ?? [];
    rows.push({ id: row.id, supportLevel: row.supportLevel });
    matrixByRequirement.set(row.requirementId, rows);
  }

  const evidenceCoverage = computeEvidenceCoverage(
    requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description ?? "",
      requirementType: requirement.requirementType,
      priority: requirement.priority,
      restrictions: requirement.restrictions,
      sectionReference: requirement.sectionReference,
      complianceMatrixRows: matrixByRequirement.get(requirement.id) ?? [],
    })),
  );
  const evidenceScore = evidenceCoverage.strongCoveragePercent;

  const hasPlanMismatch = missingPlannedDocs.length > 0 || extraGeneratedDocs.length > 0;
  const hasRequirements = requirements.length > 0;
  const hasSelectedEvidence = selectedExperts.length + selectedProjects.length > 0;
  const hasConfirmedEvidenceRows = matrix.length > 0;
  const hasStrongEvidenceGap = hasRequirements && evidenceCoverage.requirementsWithStrongEvidence < evidenceCoverage.totalRequirements;
  const hasNoDocsForWorkflow = hasRequirements && dashboardDocTotal === 0 && generatedDocs.length === 0;
  const hasNoGeneratedDocs = dashboardDocTotal > 0 && dashboardGeneratedCount === 0;

  const decision: "GO" | "REVIEW" | "NO_GO" = canonicalReadiness?.readyForFinalExport
    ? "GO"
    : unresolvedCritical > 0 || exportState === "BLOCKED" || exportState === "STALE"
      ? "NO_GO"
      : "REVIEW";

  const nextActions = dedupeSnapshotActions([
    { key: "critical-compliance", text: unresolvedCritical > 0 ? `Resolve ${unresolvedCritical} critical blocker(s) before final export.` : null },
    { key: "high-compliance", text: unresolvedCritical === 0 && unresolvedHigh > 0 ? `Senior review ${unresolvedHigh} high-priority item(s).` : null },
    { key: "evidence-rows", text: hasRequirements && !hasConfirmedEvidenceRows ? `Confirm reviewed vault evidence for ${requirements.length} requirement(s); selected matches alone do not count as final evidence.` : null },
    { key: "evidence-strength", text: hasRequirements && hasConfirmedEvidenceRows && hasStrongEvidenceGap ? `Strengthen evidence coverage: ${evidenceCoverage.totalRequirements - evidenceCoverage.requirementsWithStrongEvidence} requirement(s) still lack FULL/SUBSTANTIAL evidence.` : null },
    { key: "evidence-selection", text: hasRequirements && !hasSelectedEvidence ? "Run matching and select reviewed expert/project evidence before final generation." : null },
    { key: "document-generation", text: hasNoDocsForWorkflow ? "Build the submission plan and generate the required proposal documents before export." : null },
    { key: "document-generation", text: hasNoGeneratedDocs ? `Generate ${dashboardDocTotal} planned document(s); planned rows are not export-ready documents.` : null },
    { key: "document-generation", text: missingPlannedDocs.length > 0 ? `Generate or reconcile ${missingPlannedDocs.length} tender-required planned document(s).` : null },
    { key: "extra-documents", text: extraGeneratedDocs.length > 0 ? `Remove or justify ${extraGeneratedDocs.length} generated document(s) not found in the submission plan.` : null },
    { key: "expert-review", text: selectedExperts.length > reviewedExperts ? `Review ${selectedExperts.length - reviewedExperts} selected expert draft record(s) or deselect them.` : null },
    { key: "project-review", text: selectedProjects.length > reviewedProjects ? `Review ${selectedProjects.length - reviewedProjects} selected project draft record(s) or deselect them.` : null },
    { key: "document-generation", text: generatedDocs.length > 0 && generatedCount < generatedDocs.length ? `Generate ${generatedDocs.length - generatedCount} remaining visible package document(s).` : null },
    { key: "document-validation", text: generatedCount > 0 && validatedCount < generatedCount ? `Run validation for ${generatedCount - validatedCount} generated package document(s).` : null },
    { key: "document-approval", text: generatedCount > 0 && approvedCount < generatedCount ? `Approve or comment on ${generatedCount - approvedCount} generated package document(s).` : null },
    { key: "extraction", text: extractedFiles < files.length ? `Review extraction for ${files.length - extractedFiles} tender file(s) with weak/no text.` : null },
    { key: "plan-warning", text: submissionPlan.warnings.length > 0 ? submissionPlan.warnings[0] : null },
  ]);

  const clearForHumanReview = canonicalReadiness?.readyForFinalExport === true
    && nextActions.length === 0
    && !(hasRequirements && !hasConfirmedEvidenceRows)
    && !(hasRequirements && !hasSelectedEvidence)
    && !hasPlanMismatch;

  return (
    <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Executive Tender Command Center</p>
          <h2 className="mt-1 line-clamp-3 break-words text-xl font-bold text-slate-900">Senior proposal decision snapshot</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            One proposal-management view for canonical final-package readiness, critical gaps, evidence coverage, selected experts/projects, submission-plan documents, validation, review status, and extraction health.
          </p>
          <SnapshotConsistencyBadge tenderId={tender.id} verdict="export" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tender.bidOutcome && (
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${bidOutcomeBadgeClass(tender.bidOutcome)}`}>
              Bid: {tender.bidOutcome}
            </span>
          )}
          <CanonicalStatusBadge status={exportState} label={`Final package ${exportStatusConfig.label}`} />
          <span className={`rounded-full border px-4 py-2 text-sm font-bold ${badgeClass(decision)}`}>{decision}</span>
          <Link
            href={`/dashboard/tenders/${tender.id}/command-center`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Full Command Center <ArrowRightIcon />
          </Link>
          <Link
            href={`/dashboard/tenders/${tender.id}/report`}
            target="_blank"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF Report <ShareIcon />
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className={`rounded-xl border p-4 ${exportStatusConfig.bgClass} ${exportStatusConfig.borderClass}`}>
          <p className="text-xs text-slate-500">Final package status</p>
          <p className={`mt-1 text-xl font-bold ${exportStatusConfig.textClass}`}>{exportStatusConfig.label}</p>
          <p className="text-xs text-slate-500">
            {canonicalReadiness?.readyForFinalExport
              ? "Canonical export gates pass"
              : blockerCount > 0
                ? `${blockerCount} canonical blocker${blockerCount === 1 ? "" : "s"}`
                : canonicalReadiness
                  ? canonicalReadiness.modules.export.reason
                  : "Canonical readiness unavailable"}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4" title={`Strong evidence coverage: ${evidenceCoverage.requirementsWithStrongEvidence}/${evidenceCoverage.totalRequirements} requirement(s) linked to FULL or SUBSTANTIAL evidence. Lenient (any link, including PARTIAL): ${evidenceScoreLegacy}%.`}>
          <p className="text-xs text-slate-400">Evidence coverage</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{evidenceScore}%</p>
          <p className="text-xs text-slate-500">{evidenceCoverage.requirementsWithStrongEvidence}/{evidenceCoverage.totalRequirements} strong</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-400">Critical / High</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{unresolvedCritical}/{unresolvedHigh}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-400">Selected experts ≥90%</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{strongExperts}</p>
          <p className="text-xs text-slate-500">{reviewedExperts}/{selectedExperts.length} reviewed selected</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-400">Selected projects ≥90%</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{strongProjects}</p>
          <p className="text-xs text-slate-500">{reviewedProjects}/{selectedProjects.length} reviewed selected</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-400">Docs</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{dashboardGeneratedCount}/{dashboardDocTotal}</p>
          <p className="text-xs text-slate-500">{validatedCount} valid · {approvedCount} approved</p>
        </div>
      </div>

      {plannedDocCount > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">Submission plan reconciliation</p>
          <p className="mt-1">Planned tender-required files: <strong>{plannedDocCount}</strong> · Missing: <strong>{missingPlannedDocs.length}</strong> · Extra generated: <strong>{extraGeneratedDocs.length}</strong></p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr,1fr]">
        <div className="rounded-xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-900">Next best actions</p>
          {nextActions.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              {nextActions.slice(0, 6).map((action) => <li key={action}>{action}</li>)}
            </ol>
          ) : clearForHumanReview ? (
            <p className="mt-2 text-sm text-green-700">Canonical final-package gates pass. Complete the human release decision before submitting.</p>
          ) : (
            <p className="mt-2 text-sm text-amber-800">Readiness is not final. Open the Full Command Center and resolve canonical export blockers before submission.</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-900">Tender intelligence</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
            <span>Requirements</span><strong className="text-right text-slate-900">{requirements.length}</strong>
            <span>Evidence rows</span><strong className="text-right text-slate-900">{matrix.length}</strong>
            <span>Extracted files</span><strong className="text-right text-slate-900">{extractedFiles}/{files.length}</strong>
            <span>Selected evidence</span><strong className="text-right text-slate-900">{selectedExperts.length + selectedProjects.length}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
