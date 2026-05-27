import { prisma, prismaReady } from "../prisma";
import { checkFullExportReadiness, type ExportReadyDocument } from "./export-readiness";
import { filterFinalExportCandidateDocuments } from "./document-output-state";
import { detectSubmissionPackageMode } from "./submission-package-mode";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, submissionPlanFileCount } from "./submission-plan";

export type PlanStatus = "NO_PLAN_NO_DOCS"|"NO_PLAN_WITH_ACTIVE_DOCS"|"PLAN_MATCHED"|"PLAN_MISSING_DOCS"|"PLAN_EXTRA_DOCS"|"PLAN_ORDER_MISMATCH"|"PLAN_NAME_MISMATCH";

export async function getFinalSubmissionReadiness(tenderId: string) {
  await prismaReady;
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
      files: { select: { originalFileName: true, extractedText: true, classification: true } },
    },
  });
  if (!tender) return null;

  const workspaceDocuments = tender.generatedDocuments.length;
  const finalCandidates = filterFinalExportCandidateDocuments(tender.generatedDocuments as any[]) as ExportReadyDocument[];
  const excludedInternalRows = workspaceDocuments - finalCandidates.length;
  const readiness = await checkFullExportReadiness({ tenderId, docs: finalCandidates, requireFileContent: true });

  const missingContentCount = finalCandidates.filter((d) => !d.fileContent && !d.storagePath).length;
  const envelopeBreakdown = finalCandidates.reduce((acc, d) => {
    const k = /financial|boq|price|commercial/i.test(`${d.documentType ?? ""} ${d.name}`) ? "FINANCIAL" : /admin|eligibility|bid\s*bond|declaration|form/i.test(`${d.documentType ?? ""} ${d.name}`) ? "ADMIN" : "TECHNICAL";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 } as Record<string, number>);

  const plan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements: tender.requirements,
  });
  const missingPlanFiles = findMissingGeneratedDocuments(plan, finalCandidates as any[]);
  const extraPlanFiles = findExtraGeneratedDocuments(plan, finalCandidates as any[]);
  const requiredPlanCount = submissionPlanFileCount(plan);
  let planStatus: PlanStatus = "PLAN_MATCHED";
  if (requiredPlanCount === 0 && finalCandidates.length === 0) planStatus = "NO_PLAN_NO_DOCS";
  else if (requiredPlanCount === 0 && finalCandidates.length > 0) planStatus = "NO_PLAN_WITH_ACTIVE_DOCS";
  else if (missingPlanFiles.length > 0) planStatus = "PLAN_MISSING_DOCS";
  else if (extraPlanFiles.length > 0) planStatus = "PLAN_EXTRA_DOCS";

  const packageMode = detectSubmissionPackageMode({
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    notes: tender.notes,
    requirements: tender.requirements,
    files: tender.files,
  });

  return {
    ok: readiness.ok,
    documentBlockers: readiness.failures,
    tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
    advisoryWarnings: readiness.advisoryWarnings ?? [],
    summary: {
      totalBlockers: readiness.failures.length + (readiness.tenderLevelBlockers?.length ?? 0),
      documentBlockers: readiness.failures.length,
      tenderLevelBlockers: readiness.tenderLevelBlockers?.length ?? 0,
      advisoryWarnings: readiness.advisoryWarnings?.length ?? 0,
      finalExportCandidates: finalCandidates.length,
      workspaceDocuments,
      excludedInternalRows,
      missingContentCount,
      envelopeBreakdown,
      planStatus,
      strictTwoEnvelope: packageMode.mode === "SEPARATE_TECHNICAL_FINANCIAL",
    },
  };
}
