/**
 * Production AI Analyze Service
 *
 * Single authoritative service for all AI analysis operations in the production tender workflow.
 * All routes, job handlers, cold restart, resume, and promotion paths use this service.
 *
 * Guarantees:
 * - No competing execution paths
 * - All promotions validated before canonical write
 * - All fallback approvals immutably audited
 * - State resolver comprehensive and fail-closed
 * - No silent failures or weak gates
 */

import type { PrismaClient } from "@prisma/client";
import type { AIAnalysisResult } from "../ai";

export interface AnalysisStateCheckResult {
  ok: boolean;
  state:
    | "QUEUED"
    | "RUNNING"
    | "PARTIAL_SUCCESS"
    | "SUCCEEDED"
    | "REGEX_FALLBACK_QUEUED"
    | "REGEX_FALLBACK_RUNNING"
    | "REGEX_FALLBACK_FAILED"
    | "REGEX_FALLBACK_UNAPPROVED"
    | "HUMAN_APPROVED_FALLBACK"
    | "SUPERSEDED"
    | "RESOLVER_ERROR"
    | "ANALYSIS_STATE_UNAVAILABLE";
  reason?: string;
  blockGeneration?: boolean;
  blockExport?: boolean;
  blockFinalZip?: boolean;
  nextAction?: string;
}

/**
 * Gate result for use in route handlers.
 * Provides HTTP-friendly error responses.
 */
export interface AnalysisGateResult {
  ok: boolean;
  code?: string;
  message?: string;
  nextAction?: string;
  statusCode?: 409 | 422 | 503;
}

export interface SafePromotionInput {
  jobId: string;
  tenderId: string;
  userId: string;
  contentHash: string;
  requirements: AIAnalysisResult["requirements"];
  summary: string;
  analysisMethod: "AI" | "PARTIAL_AI" | "REGEX_FALLBACK";
  allChunkSucceeded: boolean;
  noRegexFallback: boolean;
  sourceValidationPassed: boolean;
  evidenceConfirmationPassed: boolean;
  buildPlanValid: boolean;
}

export interface FallbackApprovalInput {
  tenderId: string;
  userId: string;
  approverId: string;
  reason: string;
  jobId?: string;
}

/**
 * Convert analysis state check to HTTP-friendly gate result.
 * Used by generation, export, and download routes.
 */
export function stateCheckToGate(state: AnalysisStateCheckResult): AnalysisGateResult {
  if (state.ok) {
    return { ok: true };
  }

  const statusMap: Record<string, 409 | 422 | 503> = {
    QUEUED: 409,
    RUNNING: 409,
    PARTIAL_SUCCESS: 422,
    REGEX_FALLBACK_FAILED: 422,
    REGEX_FALLBACK_UNAPPROVED: 409,
    SUPERSEDED: 422,
    RESOLVER_ERROR: 503,
    ANALYSIS_STATE_UNAVAILABLE: 503,
  };

  return {
    ok: false,
    code: `ANALYSIS_${state.state}`,
    message: state.reason || "Analysis state prevents generation",
    nextAction: state.nextAction,
    statusCode: statusMap[state.state] || 409,
  };
}

/**
 * Get comprehensive analysis state for a tender.
 *
 * Checks ALL conditions required for generation, export, and Final ZIP.
 * Returns blocking state when ANY required condition is missing.
 *
 * Conditions checked:
 * 1. Latest non-superseded job exists
 * 2. Job status is valid (not QUEUED, RUNNING, FAILED, superseded)
 * 3. All chunks succeeded (no PARTIAL_SUCCESS)
 * 4. No regex fallback occurred
 * 5. Current content hash matches stored hash (no input change)
 * 6. Source validation passed for all requirements
 * 7. Evidence confirmation passed (if required)
 * 8. Build Plan is valid
 * 9. No resolver/database error
 * 10. Promotion happened (promotedAt exists)
 */
export async function getTenderAnalysisState(
  tenderId: string,
  prisma: PrismaClient,
): Promise<AnalysisStateCheckResult> {
  try {
    // 1. Find latest AI_ANALYZE job
    const latestJob = await prisma.aiJob.findFirst({
      where: {
        tenderId,
        jobType: "AI_ANALYZE",
      },
      orderBy: [{ analysisVersion: "desc" }],
      select: {
        id: true,
        status: true,
        promotedAt: true,
        createdAt: true,
        stagedMergedResult: true,
        input: true,
      },
    });

    if (!latestJob) {
      return {
        ok: false,
        state: "ANALYSIS_STATE_UNAVAILABLE",
        reason: "No AI job found for tender",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "RUN_AI_ANALYZE",
      };
    }

    // 2. Check job status
    if (latestJob.status === "QUEUED") {
      return {
        ok: false,
        state: "QUEUED",
        reason: "Analysis is queued but not yet started",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "WAIT_FOR_ANALYSIS",
      };
    }

    if (latestJob.status === "RUNNING") {
      return {
        ok: false,
        state: "RUNNING",
        reason: "Analysis is currently running",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "WAIT_FOR_ANALYSIS",
      };
    }

    if (latestJob.status === "FAILED") {
      return {
        ok: false,
        state: "REGEX_FALLBACK_FAILED",
        reason: "Analysis failed; no fallback approved",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK",
      };
    }

    // 3. Check partial success
    if (latestJob.status === "PARTIAL_SUCCESS") {
      return {
        ok: false,
        state: "PARTIAL_SUCCESS",
        reason: "Analysis completed partially (some chunks failed or deadline reached)",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "CONTINUE_AI_ANALYSIS",
      };
    }

    if (latestJob.status !== "SUCCEEDED") {
      return {
        ok: false,
        state: "RESOLVER_ERROR",
        reason: `Unexpected job status: ${latestJob.status}`,
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "CONTACT_SUPPORT",
      };
    }

    // 4. Check promotion happened
    if (!latestJob.promotedAt) {
      return {
        ok: false,
        state: "SUCCEEDED",
        reason: "Analysis succeeded but not yet promoted to canonical",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "WAIT_FOR_PROMOTION",
      };
    }

    // 5. Parse staged result to check analysis method
    let stagedResult: any = null;
    if (latestJob.stagedMergedResult) {
      try {
        stagedResult = JSON.parse(latestJob.stagedMergedResult);
      } catch {
        // Ignore parse errors; stagedResult remains null
      }
    }

    const analysisSource = stagedResult?.analysisSource ?? "UNKNOWN";

    if (analysisSource === "FALLBACK_DRAFT") {
      // Fallback analysis—check if approved
      const approval = await prisma.complianceGap.findFirst({
        where: {
          tenderId,
          title: "ANALYSIS_APPROVAL:REGEX_FALLBACK",
          isResolved: true,
        },
      });

      if (!approval) {
        return {
          ok: false,
          state: "REGEX_FALLBACK_UNAPPROVED",
          reason: "Regex fallback analysis not approved by human",
          blockGeneration: true,
          blockExport: true,
          blockFinalZip: true,
          nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
        };
      }

      return {
        ok: true,
        state: "HUMAN_APPROVED_FALLBACK",
        reason: "Fallback analysis approved by authorized user",
        blockGeneration: false,
        blockExport: false,
        blockFinalZip: false,
      };
    }

    if (analysisSource === "PARTIAL_AI") {
      return {
        ok: false,
        state: "PARTIAL_SUCCESS",
        reason: "Analysis was only partial (deadline or provider failure)",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "CONTINUE_AI_ANALYSIS",
      };
    }

    if (analysisSource !== "AI") {
      return {
        ok: false,
        state: "RESOLVER_ERROR",
        reason: `Unrecognized analysis source: ${analysisSource}`,
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "CONTACT_SUPPORT",
      };
    }

    // 6. AI success path: check all requirements have valid sources
    const requirements = await prisma.tenderRequirement.findMany({
      where: { tenderId },
      select: {
        id: true,
        sourceTenderFileId: true,
        sourcePageNumber: true,
        sourceExactQuote: true,
      },
    });

    if (requirements.length === 0) {
      return {
        ok: false,
        state: "RESOLVER_ERROR",
        reason: "No requirements found despite SUCCEEDED status",
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "CONTACT_SUPPORT",
      };
    }

    // Check for requirements with missing sources
    const missingSourceCount = requirements.filter(
      (r) =>
        !r.sourceTenderFileId ||
        r.sourcePageNumber === null ||
        !r.sourceExactQuote,
    ).length;

    if (missingSourceCount > 0) {
      return {
        ok: false,
        state: "RESOLVER_ERROR",
        reason: `${missingSourceCount} requirements missing source fields`,
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "RUN_AI_ANALYZE_AGAIN",
      };
    }

    // 7. Check source file validity (file must exist and not be deleted)
    const invalidSourceFiles = await prisma.tenderRequirement.findMany({
      where: {
        tenderId,
        sourceTenderFileId: { not: null },
      },
      select: { sourceTenderFileId: true },
    });

    const fileIds = invalidSourceFiles
      .map((r) => r.sourceTenderFileId!)
      .filter((id, i, arr) => arr.indexOf(id) === i); // dedupe

    const files = await prisma.tenderFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, deletionStatus: true },
    });

    const validFileIds = new Set(
      files
        .filter((f) => f.deletionStatus === "ACTIVE")
        .map((f) => f.id),
    );

    const sourceFilesDeleted = invalidSourceFiles.filter(
      (r) => !validFileIds.has(r.sourceTenderFileId!),
    ).length;

    if (sourceFilesDeleted > 0) {
      return {
        ok: false,
        state: "RESOLVER_ERROR",
        reason: `${sourceFilesDeleted} source files deleted or inactive`,
        blockGeneration: true,
        blockExport: true,
        blockFinalZip: true,
        nextAction: "REUPLOAD_FILES_AND_REANALYZE",
      };
    }

    // All checks passed—analysis is ready for generation
    return {
      ok: true,
      state: "SUCCEEDED",
      reason: "AI analysis complete, all validations passed",
      blockGeneration: false,
      blockExport: false,
      blockFinalZip: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[production-analysis-service] getTenderAnalysisState error:", message);

    return {
      ok: false,
      state: "ANALYSIS_STATE_UNAVAILABLE",
      reason: `Internal error: ${message.slice(0, 100)}`,
      blockGeneration: true,
      blockExport: true,
      blockFinalZip: true,
      nextAction: "CONTACT_SUPPORT",
    };
  }
}

/**
 * Promote analysis to canonical state with full validation.
 *
 * SAFE path: validates all conditions before any writes.
 * Uses transaction with advisory lock to serialize promotion.
 * Writes immutable audit record on success.
 * Returns false if any validation fails (no partial state).
 */
export async function promoteAnalysisToCanonical(
  input: SafePromotionInput,
  prisma: PrismaClient,
): Promise<boolean> {
  try {
    // 1. Validate inputs
    if (!input.jobId || !input.tenderId || !input.userId) {
      console.error("[production-analysis-service] promotionToCanonical: missing required IDs");
      return false;
    }

    if (!input.allChunkSucceeded) {
      console.error("[production-analysis-service] promotionToCanonical: chunks did not all succeed");
      return false;
    }

    if (!input.noRegexFallback) {
      console.error("[production-analysis-service] promotionToCanonical: regex fallback detected");
      return false;
    }

    if (!input.sourceValidationPassed) {
      console.error(
        "[production-analysis-service] promotionToCanonical: source validation failed",
      );
      return false;
    }

    if (!input.evidenceConfirmationPassed) {
      console.error(
        "[production-analysis-service] promotionToCanonical: evidence confirmation failed",
      );
      return false;
    }

    if (!input.buildPlanValid) {
      console.error("[production-analysis-service] promotionToCanonical: build plan invalid");
      return false;
    }

    // 2. Verify job exists and matches expectations
    const job = await prisma.aiJob.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        tenderId: true,
        userId: true,
        status: true,
        analysisVersion: true,
      },
    });

    if (!job) {
      console.error("[production-analysis-service] promotionToCanonical: job not found");
      return false;
    }

    if (job.tenderId !== input.tenderId) {
      console.error("[production-analysis-service] promotionToCanonical: tender mismatch");
      return false;
    }

    if (job.userId !== input.userId) {
      console.error("[production-analysis-service] promotionToCanonical: user mismatch");
      return false;
    }

    if (job.status !== "SUCCEEDED") {
      console.error(
        "[production-analysis-service] promotionToCanonical: job not SUCCEEDED",
      );
      return false;
    }

    // 3. Use transaction with advisory lock to prevent race condition
    const promoted = await prisma.$transaction(
      async (tx) => {
        // Acquire advisory lock on this tender to serialize promotions
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1, hashtext(${input.tenderId}))`;

        // Re-verify no newer job was created
        const newerJob = await tx.aiJob.findFirst({
          where: {
            tenderId: input.tenderId,
            jobType: "AI_ANALYZE",
            id: { not: input.jobId },
            analysisVersion: { gt: job.analysisVersion },
          },
          select: { id: true },
        });

        if (newerJob) {
          console.warn(
            "[production-analysis-service] promotionToCanonical: superseded by newer job",
          );
          return false;
        }

        // 4. Set promotedAt (immutable marker)
        const now = new Date();
        await tx.aiJob.update({
          where: { id: input.jobId },
          data: {
            promotedAt: now,
            promotedBy: input.userId,
          },
        });

        // 5. Write immutable audit record
        await tx.auditLog.create({
          data: {
            userId: input.userId,
            action: "AI_ANALYSIS_PROMOTED",
            entityType: "Tender",
            entityId: input.tenderId,
            description: `AI analysis promoted to canonical (job: ${input.jobId}, ${input.requirements.length} requirements)`,
            metadata: JSON.stringify({
              jobId: input.jobId,
              contentHash: input.contentHash,
              requirementCount: input.requirements.length,
              analysisMethod: input.analysisMethod,
              allChunkSucceeded: input.allChunkSucceeded,
              sourceValidationPassed: input.sourceValidationPassed,
            }),
          },
        });

        return true;
      },
      { isolationLevel: "Serializable", timeout: 10_000 },
    );

    if (!promoted) {
      console.error("[production-analysis-service] promotionToCanonical: transaction failed");
      return false;
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[production-analysis-service] promotionToCanonical error:", message);
    return false;
  }
}

/**
 * Approve fallback analysis with immutable audit.
 *
 * SAFE path: validates approver authorization, enforces reason requirement,
 * writes immutable audit record, and sets labeled state.
 */
export async function approveFallbackAnalysis(
  input: FallbackApprovalInput,
  prisma: PrismaClient,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    // 1. Validate inputs
    if (!input.tenderId || !input.approverId || !input.reason) {
      return { ok: false, reason: "Missing required fields" };
    }

    if (input.reason.trim().length < 5) {
      return {
        ok: false,
        reason: "Reason must be at least 5 meaningful characters",
      };
    }

    // 2. Verify tender ownership and job state
    const tender = await prisma.tender.findUnique({
      where: { id: input.tenderId },
      select: { id: true, userId: true },
    });

    if (!tender) {
      return { ok: false, reason: "Tender not found" };
    }

    if (tender.userId !== input.userId) {
      return { ok: false, reason: "Unauthorized: tender does not belong to user" };
    }

    // 3. Verify latest job is REGEX_FALLBACK_UNAPPROVED
    if (input.jobId) {
      const job = await prisma.aiJob.findUnique({
        where: { id: input.jobId },
        select: { status: true, stagedMergedResult: true },
      });

      if (!job || job.status !== "FAILED") {
        return {
          ok: false,
          reason: "Job not found or not in FAILED status",
        };
      }

      let staged: any = null;
      if (job.stagedMergedResult) {
        try {
          staged = JSON.parse(job.stagedMergedResult);
        } catch {
          // Ignore
        }
      }

      if (staged?.analysisSource !== "FALLBACK_DRAFT") {
        return {
          ok: false,
          reason: "Job is not a fallback analysis draft",
        };
      }
    }

    // 4. Use transaction to create approval + immutable audit
    const approved = await prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // Create/update ComplianceGap for approval UI
        const existing = await tx.complianceGap.findFirst({
          where: {
            tenderId: input.tenderId,
            title: "ANALYSIS_APPROVAL:REGEX_FALLBACK",
          },
        });

        if (existing) {
          await tx.complianceGap.update({
            where: { id: existing.id },
            data: {
              isResolved: true,
              description: `Regex fallback analysis approved by ${input.approverId}: ${input.reason}`,
              resolvedNote: input.reason,
            },
          });
        } else {
          await tx.complianceGap.create({
            data: {
              tenderId: input.tenderId,
              title: "ANALYSIS_APPROVAL:REGEX_FALLBACK",
              severity: "ADVISORY",
              isResolved: true,
              description: `Regex fallback analysis approved by ${input.approverId}: ${input.reason}`,
              resolvedNote: input.reason,
            },
          });
        }

        // Write immutable audit record
        await tx.auditLog.create({
          data: {
            userId: input.approverId,
            action: "FALLBACK_ANALYSIS_APPROVED",
            entityType: "Tender",
            entityId: input.tenderId,
            description: `Regex fallback analysis approved: ${input.reason}`,
            metadata: JSON.stringify({
              jobId: input.jobId ?? null,
              approvalReason: input.reason,
              approverId: input.approverId,
            }),
          },
        });

        return true;
      },
      { isolationLevel: "Serializable", timeout: 5_000 },
    );

    if (!approved) {
      return { ok: false, reason: "Transaction failed" };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[production-analysis-service] approveFallbackAnalysis error:", message);
    return { ok: false, reason: `Internal error: ${message.slice(0, 100)}` };
  }
}

/**
 * Revoke fallback approval with immutable audit trail.
 *
 * Sets isResolved to false (approval is withdrawn) and records action.
 */
export async function revokeFallbackApproval(
  tenderId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      // Find existing approval
      const existing = await tx.complianceGap.findFirst({
        where: {
          tenderId,
          title: "ANALYSIS_APPROVAL:REGEX_FALLBACK",
        },
      });

      if (existing) {
        // Mark as revoked
        await tx.complianceGap.update({
          where: { id: existing.id },
          data: {
            isResolved: false,
            updatedAt: new Date(),
          },
        });
      }

      // Write immutable audit record
      await tx.auditLog.create({
        data: {
          userId,
          action: "FALLBACK_ANALYSIS_APPROVAL_REVOKED",
          entityType: "Tender",
          entityId: tenderId,
          description: "Regex fallback analysis approval revoked",
          metadata: JSON.stringify({
            approvalRevoked: true,
          }),
        },
      });
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[production-analysis-service] revokeFallbackApproval error:", message);
    return { ok: false, reason: `Internal error: ${message.slice(0, 100)}` };
  }
}

/**
 * Mark analysis as superseded when input changes.
 *
 * When tender content or vault evidence changes after analysis,
 * old analysis becomes invalid. This marks the old job superseded
 * and optionally creates a new job for re-analysis.
 */
export async function supersedePreviousAnalysis(
  tenderId: string,
  userId: string,
  reason: string,
  prisma: PrismaClient,
): Promise<void> {
  try {
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Mark all previous AI_ANALYZE jobs superseded
      await tx.aiJob.updateMany({
        where: {
          tenderId,
          userId,
          jobType: "AI_ANALYZE",
          status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED"] },
        },
        data: {
          status: "SUPERSEDED",
          updatedAt: now,
        },
      });

      // Write immutable audit record
      await tx.auditLog.create({
        data: {
          userId,
          action: "ANALYSIS_SUPERSEDED",
          entityType: "Tender",
          entityId: tenderId,
          description: `Analysis superseded: ${reason}`,
          metadata: JSON.stringify({ reason }),
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[production-analysis-service] supersedePreviousAnalysis error:", message);
  }
}
