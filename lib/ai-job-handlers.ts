// Canonical AI job-handler registry.
//
// EXTRACT_TEXT is owned by the revision-bound extraction service. AI Analyze
// and Run Engine remain two explicit user actions; only work after the manual
// Engine job continues automatically.

export * from "./ai-job-handlers-legacy";

import { recordStep, type JobType } from "./ai-jobs";
import {
  getHandler as getLegacyHandler,
  isTerminalHandlerResult,
  type JobHandler,
} from "./ai-job-handlers-legacy";
import { runTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { prepareCompanyVaultForEngine } from "./engine/prepare-company-vault";
import { buildAndVerifyBuildPlan } from "./engine/automatic-build-plan";
import { reconcileAutomaticRequirementCoverage } from "./engine/reconcile-automatic-requirement-coverage";
import { computeEngineSourceRevision } from "./engine/engine-source-revision";
import { prisma } from "./prisma";

async function assertCurrentEngineSourceRevision(input: {
  jobId: string;
  tenderId: string;
  userId: string;
  companyId: string;
  expectedRevision: string;
  checkpoint: "before" | "after";
}) {
  const current = await computeEngineSourceRevision(prisma, {
    tenderId: input.tenderId,
    userId: input.userId,
    companyId: input.companyId,
  });
  if (!current || current.sourceRevision !== input.expectedRevision) {
    await recordStep(input.jobId, {
      stepName: `engine.source-revision.${input.checkpoint}.stale`,
      message: "Engine source inputs changed; the stale job cannot promote authoritative output.",
      status: "FAILED",
    });
    throw new Error("ENGINE_SOURCE_REVISION_STALE");
  }

  await recordStep(input.jobId, {
    stepName: `engine.source-revision.${input.checkpoint}.current`,
    message: `Engine source revision ${current.sourceRevision.slice(0, 12)} verified current`,
    status: "SUCCEEDED",
  });
  return current;
}

export function getHandler(jobType: JobType): JobHandler | null {
  if (jobType === "EXTRACT_TEXT") {
    return runTenderFileExtractionJob as JobHandler;
  }

  const legacyHandler = getLegacyHandler(jobType);

  if (jobType === "AI_ANALYZE" && legacyHandler) {
    return async (ctx) => {
      const result = await legacyHandler(ctx);

      // AI Analyze must never enqueue or invoke Engine. Successful promotion
      // terminates at a durable manual-action boundary. Any historical
      // autoContinue value is ignored rather than treated as authority.
      if (
        ctx.tenderId
        && isTerminalHandlerResult(result)
        && result.terminalStatus === "SUCCEEDED"
      ) {
        await recordStep(ctx.jobId, {
          stepName: "manual-engine-required",
          message: "AI Analyze completed for the current source revision. An authorized user must select Run Engine to continue.",
          status: "SUCCEEDED",
        });
        return {
          ...result,
          output: {
            ...result.output,
            nextAction: "RUN_ENGINE",
            nextActionLabel: "Run Engine",
            automaticEngineStarted: false,
          },
        };
      }

      return result;
    };
  }

  if (jobType === "ENGINE_RUN" && legacyHandler) {
    return async (ctx) => {
      if (!ctx.tenderId) return legacyHandler(ctx);

      const expectedRevision = typeof ctx.input.sourceRevision === "string"
        ? ctx.input.sourceRevision.trim()
        : "";
      if (!expectedRevision) {
        await recordStep(ctx.jobId, {
          stepName: "engine.source-revision.missing",
          message: "Engine job is not bound to a persisted source revision.",
          status: "FAILED",
        });
        throw new Error("ENGINE_SOURCE_REVISION_REQUIRED");
      }

      // Refresh Company Vault verification at actual execution time. This is
      // automatic work after the user explicitly selected Run Engine.
      const preflight = await prepareCompanyVaultForEngine(ctx.userId);
      if (!preflight) throw new Error("Company Vault profile required before Engine execution");

      await assertCurrentEngineSourceRevision({
        jobId: ctx.jobId,
        tenderId: ctx.tenderId,
        userId: ctx.userId,
        companyId: preflight.companyId,
        expectedRevision,
        checkpoint: "before",
      });

      const result = await legacyHandler(ctx);

      // Requirement source repair and Vault evidence linking are automatic
      // downstream stages of the manual Engine action.
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.automatic",
        message: "Grounding requirements and linking source-verified Company Vault evidence",
        status: "RUNNING",
      });
      const coverageBeforePlan = await reconcileAutomaticRequirementCoverage(
        prisma,
        ctx.tenderId,
        ctx.userId,
      );
      if (!coverageBeforePlan.ok) {
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.blocked",
          message: coverageBeforePlan.code ?? "Automatic requirement coverage failed",
          status: "FAILED",
        });
        throw new Error(
          `Automatic requirement coverage blocked (${coverageBeforePlan.code ?? "UNKNOWN"})`,
        );
      }
      if (coverageBeforePlan.remainingUngrounded.length > 0) {
        const titles = coverageBeforePlan.remainingUngrounded
          .slice(0, 4)
          .map((item) => item.title)
          .join("; ");
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.source-blocked",
          message: `${coverageBeforePlan.remainingUngrounded.length} mandatory/critical requirement(s) remain without provable active-file source coordinates: ${titles}`,
          status: "FAILED",
        });
        throw new Error(
          `Automatic source grounding incomplete for ${coverageBeforePlan.remainingUngrounded.length} mandatory/critical requirement(s)`,
        );
      }
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.linked",
        message: `Automatic requirement coverage persisted ${coverageBeforePlan.desiredLinks} current link(s); ${coverageBeforePlan.remainingWithoutEligibleEvidence.length} true evidence gap(s) remain`,
        status: "SUCCEEDED",
      });

      await recordStep(ctx.jobId, {
        stepName: "build-plan.automatic",
        message: "Deriving and source-verifying the submission Build Plan",
        status: "RUNNING",
      });
      const buildPlan = await buildAndVerifyBuildPlan(prisma, ctx.tenderId, ctx.userId, {
        reuseCurrent: false,
      });
      if (!buildPlan.ok) {
        await recordStep(ctx.jobId, {
          stepName: "build-plan.blocked",
          message: `${buildPlan.code}: ${buildPlan.message}`,
          status: "FAILED",
        });
        throw new Error(
          `Automatic Build Plan verification blocked (${buildPlan.code}): ${[
            buildPlan.message,
            ...(buildPlan.blockers ?? []),
          ].join(" ")}`,
        );
      }
      await recordStep(ctx.jobId, {
        stepName: "build-plan.complete",
        message: `Build Plan revision ${buildPlan.revision} automatically source-verified`,
        status: "SUCCEEDED",
      });

      const coverageAfterPlan = await reconcileAutomaticRequirementCoverage(
        prisma,
        ctx.tenderId,
        ctx.userId,
      );
      if (!coverageAfterPlan.ok || coverageAfterPlan.remainingUngrounded.length > 0) {
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.post-plan-blocked",
          message: coverageAfterPlan.ok
            ? `${coverageAfterPlan.remainingUngrounded.length} requirement source trace(s) became invalid during Build Plan creation`
            : coverageAfterPlan.code ?? "Post-plan coverage reconciliation failed",
          status: "FAILED",
        });
        throw new Error("Post-plan automatic requirement coverage reconciliation failed");
      }
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.complete",
        message: `Requirement coverage synchronized with Build Plan revision ${buildPlan.revision}`,
        status: "SUCCEEDED",
      });

      await assertCurrentEngineSourceRevision({
        jobId: ctx.jobId,
        tenderId: ctx.tenderId,
        userId: ctx.userId,
        companyId: preflight.companyId,
        expectedRevision,
        checkpoint: "after",
      });

      return {
        ...result,
        sourceRevision: expectedRevision,
        automaticRequirementCoverage: {
          groundedRequirements: coverageAfterPlan.groundedRequirements,
          persistedLinks: coverageAfterPlan.desiredLinks,
          trueEvidenceGaps: coverageAfterPlan.remainingWithoutEligibleEvidence.length,
          sourceRepair: {
            checked: coverageAfterPlan.sourceRepair.checkedCount,
            repaired: coverageAfterPlan.sourceRepair.repairedCount,
            remaining: coverageAfterPlan.sourceRepair.remainingCount,
          },
        },
        automaticBuildPlan: {
          status: buildPlan.status,
          revision: buildPlan.revision,
          contentHash: buildPlan.contentHash,
          confirmationMode: buildPlan.confirmationMode,
          authorizesGeneration: true,
        },
      };
    };
  }

  return legacyHandler;
}
