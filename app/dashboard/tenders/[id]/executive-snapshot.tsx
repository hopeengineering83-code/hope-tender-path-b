import Link from "next/link";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, submissionPlanFileCount } from "@/lib/engine/submission-plan";
import { computeEvidenceCoverage } from "@/lib/engine/requirement-evidence-profile";

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
  readinessScore?: number | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  pageLimit?: number | null;
  bidOutcome?: string | null;
  requirements?: TenderRequirementLike[];
  complianceGaps?: Array<{ severity: string; isResolved: boolean }>;
  generatedDocuments?: GeneratedDocLike[];
  expertMatches?: Array<{ isSelected: boolean; score: number; expert?: { trustLevel?: string | null } }>;
  projectMatches?: Array<{ isSelected: boolean; score: number; project?: { trustLevel?: string | null } }>;
  complianceMatrix?: Array<{ id: string; requirementId?: string | null; supportLevel: string }>;
  files?: Array<{ extractedText?: string | null }>;
};

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function badgeClass(level: "GO" | "REVIEW" | "NO_GO") {
  if (level === "GO") return "bg-green-100 text-green-700 border-green-200";
  if (level === "REVIEW") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
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
  if (outcome === "WON") return "bg-green-100 text-green-700 border-green-200";
  if (outcome === "LOST") return "bg-red-100 text-red-700 border-red-200";
  if (outcome === "WITHDRAWN") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

export function ExecutiveSnapshot({ tender }: { tender: TenderLike }) {
  const requirements = tender.requirements ?? [];
  const gaps = tender.complianceGaps ?? [];
  const generatedDocs = visiblePackageDocs(tender.generatedDocuments ?? []);
  const submissionPlan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements,
  });
  const missingPlannedDocs = findMissingGeneratedDocuments(submissionPlan, generatedDocs);
  const extraGeneratedDocs = findExtraGeneratedDocuments(submissionPlan, generatedDocs);
  const plannedDocCount = submissionPlanFileCount(submissionPlan);
  const dashboardDocTotal = plannedDocCount > 0 ? plannedDocCount : generatedDocs.length;
  const dashboardGeneratedCount = plannedDocCount > 0 ? Math.max(0, plannedDocCount - missingPlannedDocs.length) : generatedDocs.filter((d) => statusValue(d.generationStatus) === "GENERATED").length;
  const expertMatches = tender.expertMatches ?? [];
  const projectMatches = tender.projectMatches ?? [];
  const matrix = tender.complianceMatrix ?? [];
  const files = tender.files ?? [];

  const unresolvedCritical = gaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;
  const unresolvedHigh = gaps.filter((g) => !g.isResolved && g.severity === "HIGH").length;
  const selectedExperts = expertMatches.filter((m) => m.isSelected);
  const selectedProjects = projectMatches.filter((m) => m.isSelected);
  const reviewedExperts = selectedExperts.filter((m) => m.expert?.trustLevel === "REVIEWED").length;
  const reviewedProjects = selectedProjects.filter((m) => m.project?.trustLevel === "REVIEWED").length;
  const strongExperts = expertMatches.filter((m) => m.score >= 0.9).length;
  const strongProjects = projectMatches.filter((m) => m.score >= 0.9).length;
  const generatedCount = generatedDocs.filter((d) => statusValue(d.generationStatus) === "GENERATED").length;
  const validatedCount = generatedDocs.filter((d) => ["PASSED", "VALIDATED", "APPROVED"].includes(statusValue(d.validationStatus))).length;
  const approvedCount = generatedDocs.filter((d) => ["APPROVED", "ACCEPTED", "SIGNED_OFF", "SIGNED OFF"].includes(statusValue(d.reviewStatus))).length;
  const extractedFiles = files.filter((f) => (f.extractedText ?? "").length > 80).length;

  // Legacy evidence score — lenient counting (PARTIAL counts), kept for
  // backward-compat with the readiness score the engine writes to
  // tender.readinessScore.
  const supportedEvidence = matrix.filter((m) => ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(m.supportLevel)).length;
  const evidenceScoreLegacy = pct(supportedEvidence, matrix.length);

  // Canonical evidence coverage (Gap 14 helper) — only requirements
  // linked to FULL or SUBSTANTIAL evidence count toward "strong" coverage.
  // Group matrix rows by requirementId and feed into the canonical helper.
  const matrixByRequirement = new Map<string, Array<{ id: string; supportLevel?: string | null }>>();
  for (const row of matrix) {
    if (!row.requirementId) continue;
    const arr = matrixByRequirement.get(row.requirementId) ?? [];
    arr.push({ id: row.id, supportLevel: row.supportLevel });
    matrixByRequirement.set(row.requirementId, arr);
  }
  const evidenceCoverage = computeEvidenceCoverage(
    requirements.map((req) => ({
      id: req.id,
      title: req.title,
      description: req.description ?? "",
      requirementType: req.requirementType,
      priority: req.priority,
      restrictions: req.restrictions,
      sectionReference: req.sectionReference,
      complianceMatrixRows: matrixByRequirement.get(req.id) ?? [],
    })),
  );
  const evidenceScore = evidenceCoverage.strongCoveragePercent;
  // Legacy DB readiness is displayed as workflow progress only. It must not
  // drive the GO/REVIEW decision because it can drift from canonical gates.
  const workflowProgress = tender.readinessScore ?? evidenceScore;
  const canonicalDecisionScore = evidenceScore;

  const hasPlanMismatch = missingPlannedDocs.length > 0 || extraGeneratedDocs.length > 0;
  const hasRequirements = requirements.length > 0;
  const hasSelectedEvidence = selectedExperts.length + selectedProjects.length > 0;
  const hasConfirmedEvidenceRows = matrix.length > 0;
  const hasStrongEvidenceGap = hasRequirements && evidenceCoverage.requirementsWithStrongEvidence < evidenceCoverage.totalRequirements;
  const hasNoDocsForWorkflow = hasRequirements && dashboardDocTotal === 0 && generatedDocs.length === 0;
  const hasNoGeneratedDocs = dashboardDocTotal > 0 && dashboardGeneratedCount === 0;

  const decision: "GO" | "REVIEW" | "NO_GO" = unresolvedCritical > 0
    ? "NO_GO"
    : canonicalDecisionScore >= 85
      && unresolvedHigh === 0
      && dashboardGeneratedCount > 0
      && !hasPlanMismatch
      && !hasStrongEvidenceGap
        ? "GO"
        : "REVIEW";

  const nextActions = [
    unresolvedCritical > 0 ? `Resolve ${unresolvedCritical} critical blocker(s) before final export.` : null,
    unresolvedCritical === 0 && unresolvedHigh > 0 ? `Senior review ${unresolvedHigh} high-priority item(s).` : null,
    hasRequirements && !hasConfirmedEvidenceRows ? `Confirm reviewed vault evidence for ${requirements.length} requirement(s); selected matches alone do not count as final evidence.` : null,
    hasRequirements && hasConfirmedEvidenceRows && hasStrongEvidenceGap ? `Strengthen evidence coverage: ${evidenceCoverage.totalRequirements - evidenceCoverage.requirementsWithStrongEvidence} requirement(s) still lack FULL/SUBSTANTIAL evidence.` : null,
    hasRequirements && !hasSelectedEvidence ? "Run matching and select reviewed expert/project evidence before final generation." : null,
    hasNoDocsForWorkflow ? "Build the submission plan and generate the required proposal documents before export." : null,
    hasNoGeneratedDocs ? `Generate ${dashboardDocTotal} planned document(s); planned rows are not export-ready documents.` : null,
    missingPlannedDocs.length > 0 ? `Generate or reconcile ${missingPlannedDocs.length} tender-required planned document(s).` : null,
    extraGeneratedDocs.length > 0 ? `Remove or justify ${extraGeneratedDocs.length} generated document(s) not found in the submission plan.` : null,
    selectedExperts.length > reviewedExperts ? `Review ${selectedExperts.length - reviewedExperts} selected expert draft record(s) or deselect them.` : null,
    selectedProjects.length > reviewedProjects ? `Review ${selectedProjects.length - reviewedProjects} selected project draft record(s) or deselect them.` : null,
    generatedDocs.length > 0 && generatedCount < generatedDocs.length ? `Generate ${generatedDocs.length - generatedCount} remaining visible package document(s).` : null,
    generatedCount > 0 && validatedCount < generatedCount ? `Run validation for ${generatedCount - validatedCount} generated package document(s).` : null,
    generatedCount > 0 && approvedCount < generatedCount ? `Approve or comment on ${generatedCount - approvedCount} generated package document(s).` : null,
    extractedFiles < files.length ? `Review extraction for ${files.length - extractedFiles} tender file(s) with weak/no text.` : null,
    submissionPlan.warnings.length > 0 ? submissionPlan.warnings[0] : null,
  ].filter(Boolean) as string[];

  const clearForHumanReview = decision === "GO" && nextActions.length === 0;

  return (
    <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Executive Tender Command Center</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Senior proposal decision snapshot</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            One proposal-management view for readiness, critical gaps, evidence coverage, selected experts/projects, submission-plan documents, validation, review status, and extraction health.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tender.bidOutcome && (
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${bidOutcomeBadgeClass(tender.bidOutcome)}`}>
              Bid: {tender.bidOutcome}
            </span>
          )}
          <span className={`rounded-full border px-4 py-2 text-sm font-bold ${badgeClass(decision)}`}>{decision}</span>
          <Link
            href={`/dashboard/tenders/${tender.id}/command-center`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Full Command Center →
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl bg-slate-50 p-4" title="Workflow progress score from tender DB — not the canonical final submission readiness. Use the Canonical Readiness panel for export gating."><p className="text-xs text-slate-400">Workflow Progress</p><p className="mt-1 text-2xl font-bold text-slate-900">{workflowProgress}%</p><p className="text-[10px] text-slate-400">(workflow, not final)</p></div>
        <div className="rounded-xl bg-slate-50 p-4" title={`Strong evidence coverage: ${evidenceCoverage.requirementsWithStrongEvidence}/${evidenceCoverage.totalRequirements} requirement(s) linked to FULL or SUBSTANTIAL evidence. Lenient (any link, including PARTIAL): ${evidenceScoreLegacy}%.`}><p className="text-xs text-slate-400">Evidence coverage</p><p className="mt-1 text-2xl font-bold text-slate-900">{evidenceScore}%</p><p className="text-xs text-slate-500">{evidenceCoverage.requirementsWithStrongEvidence}/{evidenceCoverage.totalRequirements} strong</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Critical / High</p><p className="mt-1 text-2xl font-bold text-slate-900">{unresolvedCritical}/{unresolvedHigh}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Experts ≥90%</p><p className="mt-1 text-2xl font-bold text-slate-900">{strongExperts}</p><p className="text-xs text-slate-500">{reviewedExperts}/{selectedExperts.length} reviewed selected</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Projects ≥90%</p><p className="mt-1 text-2xl font-bold text-slate-900">{strongProjects}</p><p className="text-xs text-slate-500">{reviewedProjects}/{selectedProjects.length} reviewed selected</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Docs</p><p className="mt-1 text-2xl font-bold text-slate-900">{dashboardGeneratedCount}/{dashboardDocTotal}</p><p className="text-xs text-slate-500">{validatedCount} valid · {approvedCount} approved</p></div>
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
            <p className="mt-2 text-sm text-green-700">No major blockers detected. Proceed to final human review and export package.</p>
          ) : (
            <p className="mt-2 text-sm text-amber-700">Readiness is not final. Open the Full Command Center and resolve canonical readiness/export blockers before final submission.</p>
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
