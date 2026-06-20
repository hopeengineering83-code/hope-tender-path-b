import { PrismaClient } from "@prisma/client";
import { buildSubmissionPlanWithDerivedFallback, deriveSubmissionPlanStatus } from "../submission-plan";
import { resolveTenderAnalysisState } from "./tender-analysis-resolver";
import { canExportWithAnalysisState, type AnalysisState } from "../analysis-state-resolver";

export type PlanTruthStatus =
  | "NO_PLAN"
  | "DERIVED_DRAFT"
  | "USER_REVIEW_REQUIRED"
  | "CANONICAL_APPROVED"
  | "STALE";

export async function resolvePlanTruth(
  prisma: PrismaClient,
  tenderId: string
): Promise<{
  status: PlanTruthStatus;
  isVerified: boolean;
  totalRequired: number;
  totalGenerated: number;
  reason: string;
}> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      generatedDocuments: true,
      requirements: true,
    }
  });

  if (!tender) throw new Error("Tender not found");

  const analysisInfo = await resolveTenderAnalysisState(prisma, tenderId);
  const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
  const status = deriveSubmissionPlanStatus(tender, plan);

  const isVerified = status === "CANONICAL_APPROVED";
  const analysisTrusted = canExportWithAnalysisState(analysisInfo.state as AnalysisState);

  let reason = "Plan status: " + status;
  if (!analysisTrusted && !isVerified) {
    reason = "Verified plan requires trusted AI analysis or approved fallback.";
  }

  return {
    status: status as PlanTruthStatus,
    isVerified,
    totalRequired: plan.files.filter(f => f.required).length,
    totalGenerated: tender.generatedDocuments.filter(d => d.generationStatus === "GENERATED").length,
    reason
  };
}
