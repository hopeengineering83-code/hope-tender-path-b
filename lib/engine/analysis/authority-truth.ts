import { PrismaClient } from "@prisma/client";
import { runAuthorityReview, AuthorityReviewResult } from "../authority-review";
import { resolveTenderAnalysisState } from "../analysis-state-resolver";
import { buildSubmissionPlanWithDerivedFallback, deriveSubmissionPlanStatus } from "../submission-plan";

export type AuthorityTruthStatus =
  | "NOT_ASSESSED"
  | "PREREQUISITES_MISSING"
  | "REVIEW_IN_PROGRESS"
  | "AUTHORITY_READY"
  | "BLOCKED";

/**
 * Resolve the authority truth for a tender. Consumes the CANONICAL analysis
 * state resolver — does not independently decide AI analysis state.
 *
 * @param prisma - Prisma client
 * @param tenderId - Tender ID
 * @param userId - Actor's user ID (for tenant isolation in the canonical resolver)
 */
export async function resolveAuthorityTruth(
  prisma: PrismaClient,
  tenderId: string,
  userId: string
): Promise<{
  status: AuthorityTruthStatus;
  score: number;
  result: AuthorityReviewResult | null;
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

  // Consume the CANONICAL analysis state — do not independently decide.
  const analysisInfo = await resolveTenderAnalysisState(tenderId, userId);
  const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
  const planStatus = deriveSubmissionPlanStatus(tender, plan);

  const hasDocs = tender.generatedDocuments.length > 0;
  const planVerified = planStatus === "CANONICAL_APPROVED";
  // analysisTrusted is derived from the canonical state — only AI_SUCCEEDED
  // and HUMAN_APPROVED_FALLBACK are trusted for authority review.
  const analysisTrusted = analysisInfo.state === "AI_SUCCEEDED" || analysisInfo.state === "HUMAN_APPROVED_FALLBACK";

  if (!hasDocs && !planVerified) {
    return {
      status: "NOT_ASSESSED",
      score: 0,
      result: null,
      reason: "Authority review not assessed — no generated documents and no verified submission plan exist."
    };
  }

  if (!analysisTrusted || !planVerified) {
    return {
      status: "PREREQUISITES_MISSING",
      score: 0,
      result: null,
      reason: "Authority review requires trusted analysis and a verified submission plan."
    };
  }

  const reviewResult = runAuthorityReview(
    tender.generatedDocuments as any,
    plan.files as any,
    [] // required sections from plan could be mapped here
  );

  return {
    status: reviewResult.status as any,
    score: reviewResult.overallScore,
    result: reviewResult,
    reason: reviewResult.recommendedFixes.join(" ") || "Authority review complete."
  };
}
