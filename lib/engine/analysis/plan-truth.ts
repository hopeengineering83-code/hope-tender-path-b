import { PrismaClient } from "@prisma/client";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "../build-plan";
import { deriveSubmissionPlanStatus } from "../submission-plan";
import { resolveTenderAnalysisState } from "../analysis-state-resolver";

export type PlanTruthStatus =
  | "NO_PLAN"
  | "DERIVED_DRAFT"
  | "USER_REVIEW_REQUIRED"
  | "CANONICAL_APPROVED"
  | "STALE";

export async function resolvePlanTruth(
  prisma: PrismaClient,
  tenderId: string,
  userId?: string
): Promise<{
  status: PlanTruthStatus;
  isVerified: boolean;
  totalRequired: number;
  totalGenerated: number;
  reason: string;
}> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, ...(userId ? { userId } : {}) },
    include: {
      generatedDocuments: true,
      requirements: true,
    }
  });

  if (!tender) throw new Error("Tender not found");

  const analysisInfo = await resolveTenderAnalysisState(prisma, tenderId, userId);
  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId ?? "");
  const planItems: BuildPlanItem[] = confirmedPlan.ok ? confirmedPlan.items : [];
  const plan = { files: planItems, warnings: confirmedPlan.ok ? [] : [confirmedPlan.blocker] } as any;
  const status = deriveSubmissionPlanStatus(tender, plan);

  const isVerified = status === "CANONICAL_APPROVED";
  const analysisTrusted = analysisInfo.state === "AI_SUCCEEDED" || analysisInfo.state === "HUMAN_APPROVED_FALLBACK";

  let reason = "Plan status: " + status;
  if (!analysisTrusted && !isVerified) {
    reason = "Verified plan requires trusted AI analysis or approved fallback.";
  }

  return {
    status: status as PlanTruthStatus,
    isVerified,
    totalRequired: plan.files.filter((f: any) => f.required).length,
    totalGenerated: tender.generatedDocuments.filter(d => d.generationStatus === "GENERATED").length,
    reason
  };
}
